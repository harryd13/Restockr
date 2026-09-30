function serviceError(status, message, details = {}) {
  return Object.assign(new Error(message), { status, details });
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  return quantity;
}

export function createDistributionService(repository, { uuidv4, getClient }) {
  const collections = {
    centralInventory: repository.centralInventory,
    distributionRuns: repository.distributionRuns,
    distributionItems: repository.distributionItems,
    distributionReceipts: repository.distributionReceipts,
    distributionReconciliations: repository.distributionReconciliations,
    purchaseLogs: repository.purchaseLogs,
    weeklyRequests: repository.weeklyRequests,
    unfulfilledLogs: repository.unfulfilledLogs
  };
  const collection = (name) => collections[name]();

  async function verifyReceipt(requestId, user, payload = {}) {
    if (user?.role !== "BRANCH") throw serviceError(403, "Branch role required");
    const bodyItems = payload.items;
    const idempotencyKey = String(payload.idempotencyKey || "").trim();
    const expectedVersion = Number(payload.version);
    if (!Array.isArray(bodyItems)) throw serviceError(400, "items array is required");
    if (!idempotencyKey) throw serviceError(400, "idempotencyKey is required");
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw serviceError(400, "A valid receipt version is required");

    const receivedById = new Map();
    for (const item of bodyItems) {
      const receivedQty = normalizeQuantity(item.receivedQty);
      if (!item.itemId || receivedQty === null) {
        throw serviceError(400, "Every item requires a non-negative received quantity");
      }
      if (receivedById.has(item.itemId)) {
        throw serviceError(400, "Each distribution item can only be verified once");
      }
      receivedById.set(item.itemId, receivedQty);
    }

    const session = getClient().startSession();
    let response;
    try {
      await session.withTransaction(async () => {
        const existingReceipt = await collection("distributionReceipts").findOne({ idempotencyKey }, { session });
        if (existingReceipt) {
          if (existingReceipt.requestId !== requestId || existingReceipt.branchId !== user.branchId) {
            throw serviceError(409, "Idempotency key has already been used");
          }
          response = {
            ok: true,
            replayed: true,
            status: existingReceipt.status,
            conflicts: existingReceipt.conflicts || []
          };
          return;
        }

        const run = await collection("distributionRuns").findOne({ requestId, branchId: user.branchId }, { session });
        if (!run) throw serviceError(400, "Distribution is not ready yet");
        if (!["AWAITING_RECEIPT", "DRAFT"].includes(run.status)) {
          throw serviceError(400, "Receipt has already been verified");
        }
        if (Number(run.version || 0) !== expectedVersion) {
          throw serviceError(409, "Receipt was updated elsewhere. Reload and try again.", { currentVersion: Number(run.version || 0) });
        }

        const request = await collection("weeklyRequests").findOne({ id: requestId, branchId: user.branchId }, { session });
        if (!request) throw serviceError(404, "Request not found");
        if (request.status !== "SUBMITTED") throw serviceError(400, "Request is not awaiting receipt verification");

        const distributionItems = await collection("distributionItems").find({ runId: run.id }, { session }).toArray();
        if (!distributionItems.length) throw serviceError(400, "No distribution items found");
        if (receivedById.size !== distributionItems.length || distributionItems.some((item) => !receivedById.has(item.itemId))) {
          throw serviceError(400, "Every distribution item must be verified");
        }

        const nowIso = new Date().toISOString();
        const verifiedItems = [];
        const conflicts = [];

        for (const item of distributionItems) {
          const deliveredQty = receivedById.get(item.itemId);
          let reconciliation = await collection("distributionReconciliations").findOne(
            { weekStartDate: run.weekStartDate, itemId: item.itemId },
            { session }
          );
          if (!reconciliation) {
            const inventoryRow = await collection("centralInventory").findOne({ itemId: item.itemId }, { session });
            const initialInventoryQty = Number(inventoryRow?.onHand || 0);
            reconciliation = {
              id: uuidv4(),
              weekStartDate: run.weekStartDate,
              itemId: item.itemId,
              initialInventoryQty,
              combinedReceivedQty: 0,
              remainingQty: initialInventoryQty,
              overDeliveredQty: 0,
              status: "OPEN",
              version: 0,
              createdAt: nowIso,
              updatedAt: nowIso
            };
            await collection("distributionReconciliations").insertOne(reconciliation, { session });
          }

          const initialInventoryQty = Number(reconciliation.initialInventoryQty || 0);
          const combinedReceivedQty = Number(reconciliation.combinedReceivedQty || 0) + deliveredQty;
          const remainingQty = Math.max(0, initialInventoryQty - combinedReceivedQty);
          const overDeliveredQty = Math.max(0, combinedReceivedQty - initialInventoryQty);
          const reconciliationConflict = overDeliveredQty > 0;
          const reconciliationResult = await collection("distributionReconciliations").updateOne(
            { id: reconciliation.id, version: Number(reconciliation.version || 0) },
            {
              $set: {
                combinedReceivedQty,
                remainingQty,
                overDeliveredQty,
                status: reconciliationConflict ? "REVIEW_REQUIRED" : remainingQty === 0 ? "BALANCED" : "OPEN",
                updatedAt: nowIso
              },
              $inc: { version: 1 }
            },
            { session }
          );
          if (reconciliationResult.modifiedCount !== 1) {
            throw serviceError(409, "Inventory reconciliation changed. Please retry verification.");
          }

          const inventoryRow = await collection("centralInventory").findOne({ itemId: item.itemId }, { session });
          const currentOnHand = Number(inventoryRow?.onHand || 0);
          const nextOnHand = Math.max(0, currentOnHand - deliveredQty);
          await collection("centralInventory").updateOne(
            { itemId: item.itemId },
            { $set: { itemId: item.itemId, onHand: nextOnHand, updatedAt: nowIso } },
            { upsert: true, session }
          );

          const receiptDefaultQty = Number(item.receiptDefaultQty ?? item.approvedQty ?? 0);
          const procurementUnavailable = deliveredQty === 0 && receiptDefaultQty === 0;
          const mismatchReason = reconciliationConflict
            ? "Delivered Qty > Initial"
            : procurementUnavailable
              ? item.mismatchReason || "Wasn't available for procurement"
              : "";
          const reasonCode = reconciliationConflict
            ? "DELIVERED_ABOVE_INITIAL"
            : procurementUnavailable
              ? "PROCUREMENT_UNAVAILABLE"
              : "";

          const verifiedItem = {
            ...item,
            approvedQty: deliveredQty,
            receiptDefaultQty,
            deliveredQty,
            mismatchReason,
            reasonCode,
            reconciliationConflict,
            initialInventoryQty,
            combinedReceivedQty,
            overDeliveredQty,
            status: deliveredQty > 0 ? item.status === "PAYMENT_PENDING" ? "PAYMENT_PENDING" : "AVAILABLE" : "UNAVAILABLE"
          };
          await collection("distributionItems").updateOne(
            { id: item.id, runId: run.id },
            {
              $set: {
                approvedQty: verifiedItem.deliveredQty,
                receiptDefaultQty: verifiedItem.receiptDefaultQty,
                deliveredQty: verifiedItem.deliveredQty,
                mismatchReason: verifiedItem.mismatchReason,
                reasonCode: verifiedItem.reasonCode,
                reconciliationConflict,
                initialInventoryQty,
                combinedReceivedQty,
                overDeliveredQty,
                status: verifiedItem.status
              }
            },
            { session }
          );
          verifiedItems.push(verifiedItem);
          if (reconciliationConflict) {
            conflicts.push({
              itemId: item.itemId,
              itemName: item.itemName,
              initialInventoryQty,
              combinedReceivedQty,
              overDeliveredQty,
              reason: "Delivered Qty > Initial"
            });
          }
        }

        const logItems = verifiedItems.map((item) => {
          const lineTotal = Number(item.deliveredQty || 0) * Number(item.unitPrice || 0);
          return {
            itemId: item.itemId,
            itemName: item.itemName,
            categoryName: item.categoryName,
            requestedQty: item.requestedQty,
            approvedQty: item.deliveredQty,
            deliveredQty: item.deliveredQty,
            unitPrice: item.unitPrice,
            totalPrice: lineTotal,
            status: item.status,
            mismatchReason: item.mismatchReason,
            reasonCode: item.reasonCode,
            reconciliationConflict: item.reconciliationConflict,
            initialInventoryQty: item.initialInventoryQty,
            combinedReceivedQty: item.combinedReceivedQty,
            overDeliveredQty: item.overDeliveredQty
          };
        });
        const total = logItems.reduce((sum, item) => sum + item.totalPrice, 0);
        await collection("distributionReceipts").insertOne({
          id: uuidv4(),
          idempotencyKey,
          runId: run.id,
          requestId,
          branchId: run.branchId,
          weekStartDate: run.weekStartDate,
          version: expectedVersion + 1,
          status: "RECEIVED_PENDING_REVIEW",
          verifiedAt: nowIso,
          verifiedBy: user.id,
          items: logItems,
          conflicts
        }, { session });
        await collection("purchaseLogs").insertOne({
          id: uuidv4(),
          distributionRunId: run.id,
          requestId,
          weekStartDate: run.weekStartDate,
          createdAt: nowIso,
          verifiedAt: nowIso,
          status: "PENDING_ADMIN_REVIEW",
          total,
          conflicts,
          branches: [{ branchId: run.branchId, total, items: logItems }]
        }, { session });

        const runVersion = Number(run.version || 0);
        const runUpdate = await collection("distributionRuns").updateOne(
          run.version == null
            ? {
                id: run.id,
                status: run.status,
                $or: [{ version: { $exists: false } }, { version: null }, { version: 0 }]
              }
            : { id: run.id, status: run.status, version: runVersion },
          {
            $set: {
              status: "RECEIVED_PENDING_REVIEW",
              receivedAt: nowIso,
              verifiedBy: user.id,
              receiptIdempotencyKey: idempotencyKey,
              hasReconciliationConflict: conflicts.length > 0
            },
            $inc: { version: 1 }
          },
          { session }
        );
        if (runUpdate.modifiedCount !== 1) throw serviceError(409, "Receipt was updated elsewhere. Reload and try again.");
        await collection("weeklyRequests").updateOne(
          { id: requestId, status: "SUBMITTED" },
          { $set: { status: "RECEIVED_PENDING_REVIEW", updatedAt: nowIso } },
          { session }
        );
        response = { ok: true, status: "RECEIVED_PENDING_REVIEW", conflicts };
      });
      return response;
    } catch (error) {
      if (error?.code === 11000) {
        const existingReceipt = await collection("distributionReceipts").findOne({ idempotencyKey });
        if (existingReceipt?.requestId === requestId && existingReceipt?.branchId === user.branchId) {
          return { ok: true, replayed: true, status: existingReceipt.status, conflicts: existingReceipt.conflicts || [] };
        }
        throw serviceError(409, "Receipt verification conflicted with another update. Reload and try again.");
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async function closeRun(runId, bodyItems, user) {
    if (!Array.isArray(bodyItems)) throw serviceError(400, "items array is required");
    const run = await collection("distributionRuns").findOne({ id: runId });
    if (!run) throw serviceError(404, "Distribution run not found");
    if (run.status !== "RECEIVED_PENDING_REVIEW") {
      throw serviceError(400, "Branch receipt must be verified before closing");
    }

    const distributionItems = await collection("distributionItems").find({ runId }).toArray();
    const reasons = new Map(bodyItems.map((item) => [item.id, String(item.mismatchReason || "").trim()]));
    const mismatches = distributionItems.filter(
      (item) => item.reconciliationConflict || Number(item.requestedQty || 0) !== Number(item.deliveredQty ?? item.approvedQty ?? 0)
    );
    if (mismatches.some((item) => !reasons.get(item.id))) {
      throw serviceError(400, "A reason is required for every delivery mismatch");
    }

    const mismatchIds = new Set(mismatches.map((item) => item.id));
    for (const item of distributionItems) {
      const mismatchReason = mismatchIds.has(item.id) ? reasons.get(item.id) : "";
      await collection("distributionItems").updateOne({ id: item.id, runId }, { $set: { mismatchReason } });
      item.mismatchReason = mismatchReason;
    }

    const nowIso = new Date().toISOString();
    await collection("unfulfilledLogs").deleteMany({ distributionRunId: runId });
    if (mismatches.length) {
      await collection("unfulfilledLogs").insertMany(mismatches.map((item) => {
        const deliveredQty = Number(item.deliveredQty ?? item.approvedQty ?? 0);
        return {
          id: uuidv4(),
          distributionRunId: runId,
          weekStartDate: run.weekStartDate,
          requestId: run.requestId,
          branchId: run.branchId,
          itemId: item.itemId,
          itemName: item.itemName,
          categoryName: item.categoryName,
          requestedQty: Number(item.requestedQty || 0),
          fulfilledQty: deliveredQty,
          deliveredQty,
          variance: deliveredQty - Number(item.requestedQty || 0),
          reasonCode: item.reasonCode || "",
          reconciliationConflict: !!item.reconciliationConflict,
          initialInventoryQty: Number(item.initialInventoryQty || 0),
          combinedReceivedQty: Number(item.combinedReceivedQty || 0),
          overDeliveredQty: Number(item.overDeliveredQty || 0),
          reason: reasons.get(item.id),
          createdAt: nowIso
        };
      }));
    }

    const purchaseLog = await collection("purchaseLogs").findOne({ distributionRunId: runId });
    if (purchaseLog) {
      const itemMap = new Map(distributionItems.map((item) => [item.itemId, item]));
      const branches = (purchaseLog.branches || []).map((branch) => ({
        ...branch,
        items: (branch.items || []).map((item) => ({
          ...item,
          mismatchReason: itemMap.get(item.itemId)?.mismatchReason || ""
        }))
      }));
      await collection("purchaseLogs").updateOne(
        { id: purchaseLog.id },
        { $set: { branches, status: "FINALIZED", closedAt: nowIso, closedBy: user?.id || "" } }
      );
    }

    await collection("weeklyRequests").updateOne(
      { id: run.requestId, status: "RECEIVED_PENDING_REVIEW" },
      { $set: { status: "DISTRIBUTED", updatedAt: nowIso } }
    );
    await collection("distributionRuns").updateOne(
      { id: runId },
      { $set: { status: "FINALIZED", finalizedAt: nowIso, finalizedBy: user?.id || "" }, $inc: { version: 1 } }
    );
    return { ok: true };
  }

  return { verifyReceipt, closeRun };
}
