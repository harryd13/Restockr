import { upsertWeeklyCentralPurchaseLog, upsertWeeklyDistributionLog } from "./weekly-summary.service.js";

function serviceError(status, message, details = {}) {
  return Object.assign(new Error(message), { status, details });
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  return quantity;
}

export function createDistributionService(repository, { uuidv4, getClient, getCurrentDateInIST }) {
  const collections = {
    centralInventory: repository.centralInventory,
    distributionRuns: repository.distributionRuns,
    distributionItems: repository.distributionItems,
    distributionReceipts: repository.distributionReceipts,
    distributionReconciliations: repository.distributionReconciliations,
    inventoryCommitmentLogs: repository.inventoryCommitmentLogs,
    purchaseLogs: repository.purchaseLogs,
    weeklyRequests: repository.weeklyRequests,
    unfulfilledLogs: repository.unfulfilledLogs,
    expenseTickets: repository.expenseTickets,
    expenseTicketLogs: repository.expenseTicketLogs,
    weeklyPurchaseOrderLogs: repository.weeklyPurchaseOrderLogs,
    weeklyCentralPurchaseLogs: repository.weeklyCentralPurchaseLogs,
    weeklyDistributionLogs: repository.weeklyDistributionLogs,
    items: repository.items
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
        if (!["SUBMITTED", "AWAITING_RECEIPT"].includes(request.status)) throw serviceError(400, "Request is not awaiting receipt verification");

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
          const inventoryRow = await collection("centralInventory").findOne({ itemId: item.itemId }, { session });
          const receiptDefaultQty = Number(item.requestedQty || 0);
          const initialInventoryQty = Number(inventoryRow?.onHand || 0);
          const overDeliveredQty = Math.max(0, deliveredQty - receiptDefaultQty);
          const combinedReceivedQty = 0;
          const reconciliationConflict = overDeliveredQty > 0;
          const procurementUnavailable = deliveredQty === 0 && receiptDefaultQty === 0;
          const mismatchReason = reconciliationConflict
            ? "Branch received more than expected"
            : procurementUnavailable
              ? item.mismatchReason || "Wasn't available for procurement"
              : "";
          const reasonCode = reconciliationConflict
            ? "DELIVERED_ABOVE_EXPECTED"
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
                branchReportedQty: verifiedItem.deliveredQty,
                deliveredQty: verifiedItem.deliveredQty,
                inventoryCommitState: "PENDING",
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
              reason: "Branch received more than expected"
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
            branchReportedQty: item.deliveredQty,
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
          { id: requestId, status: { $in: ["SUBMITTED", "AWAITING_RECEIPT"] } },
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

  async function closeRun(runId, payload = {}, user) {
    const bodyItems = payload.items;
    const expectedVersion = Number(payload.version);
    if (!Array.isArray(bodyItems)) throw serviceError(400, "items array is required");
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw serviceError(400, "A valid distribution version is required");

    const submitted = new Map();
    for (const row of bodyItems) {
      const deliveredQty = normalizeQuantity(row.deliveredQty);
      if (!row.id || deliveredQty === null) throw serviceError(400, "Every item requires a non-negative reviewed quantity");
      if (submitted.has(row.id)) throw serviceError(400, "Each distribution item can only be reviewed once");
      submitted.set(row.id, { deliveredQty, mismatchReason: String(row.mismatchReason || "").trim() });
    }

    const session = getClient().startSession();
    let response;
    try {
      await session.withTransaction(async () => {
        const run = await collection("distributionRuns").findOne({ id: runId }, { session });
        if (!run) throw serviceError(404, "Distribution run not found");
        if (run.status === "FINALIZED") {
          const commitment = await collection("inventoryCommitmentLogs").findOne({ distributionRunId: runId }, { session });
          response = { ok: true, replayed: true, status: "FINALIZED", mismatchCount: Number(run.mismatchCount || 0), commitmentId: commitment?.id || "" };
          return;
        }
        if (run.status !== "RECEIVED_PENDING_REVIEW") throw serviceError(400, "Branch receipt must be verified before closing");
        if (Number(run.version || 0) !== expectedVersion) {
          throw serviceError(409, "Distribution was updated elsewhere. Reload and review it again.");
        }

        const distributionItems = await collection("distributionItems").find({ runId }, { session }).toArray();
        if (!distributionItems.length) throw serviceError(400, "No distribution items found");
        if (submitted.size !== distributionItems.length || distributionItems.some((item) => !submitted.has(item.id))) {
          throw serviceError(400, "Every distribution item must be reviewed");
        }

        for (const item of distributionItems) {
          const actualPurchaseQty = Number(item.actualPurchaseQty ?? item.orderedQty ?? 0);
          if (actualPurchaseQty <= 0) continue;
          if (!["EXPENSE_RECORDED", "PENDING_TICKET_OPEN", "PENDING_TICKET_CLOSED"].includes(item.paymentStatus)) {
            throw serviceError(400, `${item.itemName}: select Paid or Pending before closing distribution`);
          }
          if (!String(item.paymentMethod || "").trim()) {
            throw serviceError(400, `${item.itemName}: payment method is required before closing distribution`);
          }
          if (Number(item.estimatedUnitPrice ?? item.unitPrice ?? 0) <= 0) {
            throw serviceError(400, `${item.itemName}: final purchase price is required before closing distribution`);
          }
        }

        const nowIso = new Date().toISOString();
        const reviewedItems = [];
        const commitmentItems = [];
        for (const item of distributionItems) {
          const review = submitted.get(item.id);
          const branchReportedQty = Number(item.branchReportedQty ?? item.deliveredQty ?? item.approvedQty ?? 0);
          const adjusted = review.deliveredQty !== branchReportedQty;
          const mismatch = !!item.reconciliationConflict || review.deliveredQty !== Number(item.requestedQty || 0) || adjusted;
          if (mismatch && !review.mismatchReason) throw serviceError(400, "A reason is required for every mismatch or admin quantity change");

          const reservedQty = Number(item.centralReservedQty || 0);
          const actualPurchaseQty = Number(item.actualPurchaseQty ?? item.orderedQty ?? 0);
          const accountedSupplyQty = reservedQty + actualPurchaseQty;
          if (Math.max(branchReportedQty, review.deliveredQty) > accountedSupplyQty) {
            throw serviceError(400, `${item.itemName}: branch received more than central stock plus the actual purchased quantity. Correct the purchased quantity before closing.`);
          }
          const centralCommittedQty = Math.min(reservedQty, review.deliveredQty);
          const centralReleasedQty = Math.max(0, reservedQty - centralCommittedQty);
          const purchasedDeliveredQty = Math.min(actualPurchaseQty, Math.max(0, review.deliveredQty - centralCommittedQty));
          const purchasedSurplusQty = Math.max(0, actualPurchaseQty - purchasedDeliveredQty);
          const purchaseUnitPrice = Number(item.estimatedUnitPrice ?? item.unitPrice ?? 0);
          const unaccountedDeliveredQty = Math.max(0, review.deliveredQty - centralCommittedQty - purchasedDeliveredQty);
          const legacyAlreadyApplied = item.inventoryCommitState !== "PENDING";
          let inventoryUnitCostAfter = null;
          let inventoryValueAfter = null;
          if (!legacyAlreadyApplied && (reservedQty > 0 || purchasedSurplusQty > 0)) {
            const inventory = await collection("centralInventory").findOne({ itemId: item.itemId }, { session });
            const masterItem = inventory?.unitCost == null
              ? await collection("items").findOne({ id: item.itemId }, { session })
              : null;
            if (reservedQty > 0 && (!inventory || Number(inventory.onHand || 0) < centralCommittedQty || Number(inventory.reserved || 0) < reservedQty)) {
              throw serviceError(409, `Reserved inventory for ${item.itemName} changed. Reallocate stock before closing.`);
            }
            const existingOnHand = Number(inventory?.onHand || 0);
            const existingReserved = Number(inventory?.reserved || 0);
            const existingUnitCost = Number(inventory?.unitCost ?? masterItem?.defaultPrice ?? 0);
            const remainingExistingQty = Math.max(0, existingOnHand - centralCommittedQty);
            const nextOnHand = remainingExistingQty + purchasedSurplusQty;
            const nextInventoryValue = Number((remainingExistingQty * existingUnitCost + purchasedSurplusQty * purchaseUnitPrice).toFixed(2));
            const nextUnitCost = nextOnHand > 0 ? Number((nextInventoryValue / nextOnHand).toFixed(4)) : existingUnitCost;
            inventoryUnitCostAfter = nextUnitCost;
            inventoryValueAfter = nextInventoryValue;
            const inventoryFilter = inventory
              ? { itemId: item.itemId, onHand: existingOnHand, reserved: existingReserved }
              : { itemId: item.itemId };
            const inventoryResult = await collection("centralInventory").updateOne(
              inventoryFilter,
              {
                $inc: { onHand: purchasedSurplusQty - centralCommittedQty, reserved: -reservedQty },
                $set: { unitCost: nextUnitCost, updatedAt: nowIso },
                $setOnInsert: { itemId: item.itemId }
              },
              { upsert: reservedQty === 0, session }
            );
            if (inventoryResult.modifiedCount + inventoryResult.upsertedCount !== 1) throw serviceError(409, `Inventory for ${item.itemName} changed while closing. Reload and try again.`);

            await collection("distributionReconciliations").updateOne(
              { weekStartDate: run.weekStartDate, itemId: item.itemId },
              {
                $setOnInsert: { id: uuidv4(), weekStartDate: run.weekStartDate, itemId: item.itemId, initialInventoryQty: Number(inventory?.onHand || 0), createdAt: nowIso },
                $inc: { combinedReceivedQty: centralCommittedQty, combinedCommittedQty: centralCommittedQty, combinedReleasedQty: centralReleasedQty, version: 1 },
                $set: { updatedAt: nowIso, status: "COMMITTED" }
              },
              { upsert: true, session }
            );
          }

          commitmentItems.push({
            distributionItemId: item.id,
            itemId: item.itemId,
            itemName: item.itemName,
            finalDeliveredQty: review.deliveredQty,
            reservedQty,
            centralCommittedQty,
            centralReleasedQty,
            purchasedDeliveredQty,
            actualPurchaseQty,
            purchasedSurplusQty,
            purchaseUnitPrice,
            inventoryUnitCostAfter,
            inventoryValueAfter,
            unaccountedDeliveredQty,
            legacyAlreadyApplied
          });

          const reviewed = {
            ...item,
            branchReportedQty,
            deliveredQty: review.deliveredQty,
            approvedQty: review.deliveredQty,
            mismatchReason: mismatch ? review.mismatchReason : "",
            adminAdjusted: adjusted,
            centralCommittedQty,
            centralReleasedQty,
            purchasedDeliveredQty,
            purchasedSurplusQty,
            unaccountedDeliveredQty,
            inventoryCommitState: "COMMITTED",
            status: review.deliveredQty > 0 ? item.paymentStatus === "PENDING_TICKET_OPEN" ? "PAYMENT_PENDING" : "AVAILABLE" : "UNAVAILABLE",
            reviewedAt: nowIso,
            reviewedBy: user?.id || ""
          };
          await collection("distributionItems").updateOne(
            { id: item.id, runId },
            { $set: { branchReportedQty, deliveredQty: reviewed.deliveredQty, approvedQty: reviewed.approvedQty, mismatchReason: reviewed.mismatchReason, adminAdjusted: adjusted, centralCommittedQty, centralReleasedQty, purchasedDeliveredQty, purchasedSurplusQty, unaccountedDeliveredQty, inventoryCommitState: "COMMITTED", inventoryCommittedAt: nowIso, status: reviewed.status, reviewedAt: nowIso, reviewedBy: reviewed.reviewedBy } },
            { session }
          );
          reviewedItems.push(reviewed);
        }

        const mismatches = reviewedItems.filter((item) => item.reconciliationConflict || item.adminAdjusted || Number(item.requestedQty || 0) !== item.deliveredQty);
        await collection("unfulfilledLogs").deleteMany({ distributionRunId: runId }, { session });
        if (mismatches.length) {
          await collection("unfulfilledLogs").insertMany(mismatches.map((item) => ({
          id: uuidv4(),
          distributionRunId: runId,
          weekStartDate: run.weekStartDate,
          requestId: run.requestId,
          branchId: run.branchId,
          itemId: item.itemId,
          itemName: item.itemName,
          categoryName: item.categoryName,
          requestedQty: Number(item.requestedQty || 0),
          fulfilledQty: item.deliveredQty,
          deliveredQty: item.deliveredQty,
          variance: item.deliveredQty - Number(item.requestedQty || 0),
          reasonCode: item.reasonCode || "",
          reconciliationConflict: !!item.reconciliationConflict,
          initialInventoryQty: Number(item.initialInventoryQty || 0),
          combinedReceivedQty: Number(item.combinedReceivedQty || 0),
          overDeliveredQty: Number(item.overDeliveredQty || 0),
          branchReportedQty: item.branchReportedQty,
          adminAdjusted: item.adminAdjusted,
          reason: item.mismatchReason,
          createdAt: nowIso
          })), { session });
        }

        const commitmentLog = {
          id: uuidv4(),
          distributionRunId: runId,
          requestId: run.requestId,
          branchId: run.branchId,
          weekStartDate: run.weekStartDate,
          status: "COMMITTED",
          committedAt: nowIso,
          committedBy: user?.id || "",
          totalCentralCommittedQty: commitmentItems.reduce((sum, item) => sum + item.centralCommittedQty, 0),
          totalCentralReleasedQty: commitmentItems.reduce((sum, item) => sum + item.centralReleasedQty, 0),
          totalPurchasedDeliveredQty: commitmentItems.reduce((sum, item) => sum + item.purchasedDeliveredQty, 0),
          totalPurchasedSurplusQty: commitmentItems.reduce((sum, item) => sum + item.purchasedSurplusQty, 0),
          totalUnaccountedDeliveredQty: commitmentItems.reduce((sum, item) => sum + item.unaccountedDeliveredQty, 0),
          items: commitmentItems
        };
        await collection("inventoryCommitmentLogs").insertOne(commitmentLog, { session });

        const receipt = await collection("distributionReceipts").findOne({ runId }, { session });
        if (receipt) {
          const itemMap = new Map(reviewedItems.map((item) => [item.itemId, item]));
          const receiptItems = (receipt.items || []).map((row) => {
            const item = itemMap.get(row.itemId);
            return item ? { ...row, branchReportedQty: item.branchReportedQty, deliveredQty: item.deliveredQty, approvedQty: item.deliveredQty, mismatchReason: item.mismatchReason, adminAdjusted: item.adminAdjusted, centralCommittedQty: item.centralCommittedQty, centralReleasedQty: item.centralReleasedQty, purchasedDeliveredQty: item.purchasedDeliveredQty, purchasedSurplusQty: item.purchasedSurplusQty, unaccountedDeliveredQty: item.unaccountedDeliveredQty } : row;
          });
          await collection("distributionReceipts").updateOne({ id: receipt.id }, { $set: { items: receiptItems, status: "FINALIZED", reviewedAt: nowIso, reviewedBy: user?.id || "" } }, { session });
        }

        const purchaseLog = await collection("purchaseLogs").findOne({ distributionRunId: runId }, { session });
        if (purchaseLog) {
          const itemMap = new Map(reviewedItems.map((item) => [item.itemId, item]));
      const branches = (purchaseLog.branches || []).map((branch) => ({
        ...branch,
        items: (branch.items || []).map((item) => ({
          ...item,
              branchReportedQty: itemMap.get(item.itemId)?.branchReportedQty,
              deliveredQty: itemMap.get(item.itemId)?.deliveredQty ?? item.deliveredQty,
              approvedQty: itemMap.get(item.itemId)?.deliveredQty ?? item.approvedQty,
              adminAdjusted: !!itemMap.get(item.itemId)?.adminAdjusted,
              centralCommittedQty: itemMap.get(item.itemId)?.centralCommittedQty || 0,
              centralReleasedQty: itemMap.get(item.itemId)?.centralReleasedQty || 0,
              purchasedDeliveredQty: itemMap.get(item.itemId)?.purchasedDeliveredQty || 0,
              purchasedSurplusQty: itemMap.get(item.itemId)?.purchasedSurplusQty || 0,
              mismatchReason: itemMap.get(item.itemId)?.mismatchReason || ""
        }))
      }));
      await collection("purchaseLogs").updateOne(
        { id: purchaseLog.id },
            { $set: { branches, status: "FINALIZED", closedAt: nowIso, closedBy: user?.id || "" } },
            { session }
      );
        }

        const distributionSummaryItems = reviewedItems.map((item) => ({
          itemId: item.itemId,
          itemName: item.itemName,
          requestedQty: Number(item.requestedQty || 0),
          finalDeliveredQty: Number(item.deliveredQty || 0),
          centralCommittedQty: Number(item.centralCommittedQty || 0),
          actualPurchaseQty: Number(item.actualPurchaseQty ?? item.orderedQty ?? 0),
          purchasedDeliveredQty: Number(item.purchasedDeliveredQty || 0),
          purchasedSurplusQty: Number(item.purchasedSurplusQty || 0),
          finalUnitPrice: Number(item.estimatedUnitPrice ?? item.unitPrice ?? 0),
          purchasedDistributedValue: Number((Number(item.purchasedDeliveredQty || 0) * Number(item.estimatedUnitPrice ?? item.unitPrice ?? 0)).toFixed(2)),
          mismatchReason: item.mismatchReason || ""
        }));
        await upsertWeeklyDistributionLog(collection("weeklyDistributionLogs"), run.weekStartDate, {
          branchId: run.branchId,
          requestId: run.requestId,
          requestCreatedAt: run.createdAt || "",
          distributionRunId: run.id,
          status: "FINALIZED",
          finalizedAt: nowIso,
          requestedQty: distributionSummaryItems.reduce((sum, item) => sum + item.requestedQty, 0),
          finalDeliveredQty: distributionSummaryItems.reduce((sum, item) => sum + item.finalDeliveredQty, 0),
          centralCommittedQty: distributionSummaryItems.reduce((sum, item) => sum + item.centralCommittedQty, 0),
          purchasedDeliveredQty: distributionSummaryItems.reduce((sum, item) => sum + item.purchasedDeliveredQty, 0),
          purchasedSurplusQty: distributionSummaryItems.reduce((sum, item) => sum + item.purchasedSurplusQty, 0),
          purchasedDistributedValue: distributionSummaryItems.reduce((sum, item) => sum + item.purchasedDistributedValue, 0),
          items: distributionSummaryItems
        }, { session });

        const [orderLog, paymentLogs, pendingTicket] = await Promise.all([
          collection("weeklyPurchaseOrderLogs").findOne({ id: run.orderLogId }, { session }),
          collection("expenseTicketLogs").find({ distributionRunId: run.id, status: { $ne: "DELETED" } }, { session }).toArray(),
          collection("expenseTickets").findOne({ distributionRunId: run.id, sourceType: "WEEKLY_PURCHASE" }, { session })
        ]);
        const orderedMap = new Map((orderLog?.items || []).map((item) => [item.itemId, item]));
        const centralItems = reviewedItems.map((item) => {
          const actualPurchaseQty = Number(item.actualPurchaseQty ?? item.orderedQty ?? 0);
          const finalUnitPrice = Number(item.estimatedUnitPrice ?? item.unitPrice ?? 0);
          return { itemId: item.itemId, itemName: item.itemName, orderedQty: Number(item.orderedQty || 0), actualPurchaseQty, orderedEstimatedUnitPrice: Number(orderedMap.get(item.itemId)?.estimatedUnitPrice ?? finalUnitPrice), finalUnitPrice, purchaseAmount: Number((actualPurchaseQty * finalUnitPrice).toFixed(2)), paymentStatus: item.paymentStatus, paymentMethod: item.paymentMethod || "" };
        });
        const paidAmount = Number(paymentLogs.reduce((sum, log) => sum + Number(log.amount || 0), 0).toFixed(2));
        await upsertWeeklyCentralPurchaseLog(collection("weeklyCentralPurchaseLogs"), run.weekStartDate, {
          branchId: run.branchId, requestId: run.requestId, purchaseRunId: run.combinedRunId, distributionRunId: run.id, orderLogId: run.orderLogId,
          status: pendingTicket?.status === "PENDING" ? "PAYMENT_PENDING" : "FINALIZED", distributionStatus: "FINALIZED", orderedAt: orderLog?.orderedAt || "", finalizedAt: nowIso,
          orderedQty: centralItems.reduce((sum, item) => sum + item.orderedQty, 0), purchasedQty: centralItems.reduce((sum, item) => sum + item.actualPurchaseQty, 0), purchaseAmount: centralItems.reduce((sum, item) => sum + item.purchaseAmount, 0),
          paidAmount, pendingAmount: pendingTicket?.status === "PENDING" ? Number(pendingTicket.amount || 0) : 0,
          cashPaid: paymentLogs.filter((log) => log.paymentMethod === "Cash").reduce((sum, log) => sum + Number(log.amount || 0), 0),
          upiPaid: paymentLogs.filter((log) => log.paymentMethod === "UPI").reduce((sum, log) => sum + Number(log.amount || 0), 0), items: centralItems
        }, { session });

        await collection("weeklyRequests").updateOne(
      { id: run.requestId, status: "RECEIVED_PENDING_REVIEW" },
          { $set: { status: "DISTRIBUTED", updatedAt: nowIso } },
          { session }
    );
        const closeResult = await collection("distributionRuns").updateOne(
          { id: runId, status: "RECEIVED_PENDING_REVIEW", version: expectedVersion },
          { $set: { status: "FINALIZED", finalizedAt: nowIso, finalizedBy: user?.id || "", mismatchCount: mismatches.length, inventoryCommitmentId: commitmentLog.id, inventoryCommittedAt: nowIso }, $inc: { version: 1 } },
          { session }
    );
        if (closeResult.modifiedCount !== 1) throw serviceError(409, "Distribution was updated elsewhere. Reload and try again.");
        response = { ok: true, status: "FINALIZED", mismatchCount: mismatches.length, commitmentId: commitmentLog.id };
      });
      return response;
    } finally {
      await session.endSession();
    }
  }

  async function updatePayments(runId, user, payload = {}) {
    const bodyItems = payload.items;
    const expectedVersion = Number(payload.version);
    const idempotencyKey = String(payload.idempotencyKey || "").trim();
    if (!Array.isArray(bodyItems)) throw serviceError(400, "items array is required");
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw serviceError(400, "A valid distribution version is required");
    if (!idempotencyKey) throw serviceError(400, "idempotencyKey is required");

    const session = getClient().startSession();
    let response;
    try {
      await session.withTransaction(async () => {
        const existingBatchLogs = await collection("expenseTicketLogs").find({
          sourceType: "WEEKLY_PURCHASE_PAYMENT",
          paymentBatchId: idempotencyKey
        }, { session }).toArray();
        const existingCorrectionLog = await collection("expenseTicketLogs").findOne({
          distributionRunId: runId,
          "corrections.idempotencyKey": idempotencyKey
        }, { session });
        if (existingBatchLogs.length || existingCorrectionLog) {
          if (existingBatchLogs.some((log) => log.distributionRunId !== runId)) {
            throw serviceError(409, "Idempotency key has already been used for another distribution");
          }
          const replayRun = await collection("distributionRuns").findOne({ id: runId }, { session });
          const replayItems = await collection("distributionItems").find({ runId }, { session }).toArray();
          response = { run: replayRun, items: replayItems, expenseLogs: existingBatchLogs, replayed: true };
          return;
        }
        const run = await collection("distributionRuns").findOne({ id: runId }, { session });
        if (!run) throw serviceError(404, "Distribution run not found");
        if (!["DRAFT", "AWAITING_RECEIPT", "RECEIVED_PENDING_REVIEW"].includes(run.status)) {
          throw serviceError(400, "Purchase and payment controls are locked after distribution closes");
        }
        if (Number(run.version || 0) !== expectedVersion) {
          throw serviceError(409, "Distribution changed elsewhere. Reload and try again.", { currentVersion: Number(run.version || 0) });
        }

        const distributionItems = await collection("distributionItems").find({ runId }, { session }).toArray();
        const incomingById = new Map();
        for (const incoming of bodyItems) {
          if (!incoming?.id || incomingById.has(incoming.id)) {
            throw serviceError(400, "Each distribution item must appear exactly once");
          }
          incomingById.set(incoming.id, incoming);
        }
        if (incomingById.size !== distributionItems.length || distributionItems.some((item) => !incomingById.has(item.id))) {
          throw serviceError(400, "Every distribution item must be included");
        }

        const allowedStatuses = new Set(["NOT_RECORDED", "PAID", "PENDING", "EXPENSE_RECORDED"]);
        const allowedMethods = new Set(["", "Cash", "UPI"]);
        const nowIso = new Date().toISOString();
        const newlyPaidByMethod = new Map();
        const pendingSourceId = String(run.combinedRunId || run.orderLogId || run.id);
        const existingPendingTicket = await collection("expenseTickets").findOne({
          sourceType: "WEEKLY_PURCHASE",
          sourceId: pendingSourceId
        }, { session });
        const settlementLogs = existingPendingTicket
          ? await collection("expenseTicketLogs").find({ ticketId: existingPendingTicket.id, sourceType: "PENDING_SETTLEMENT" }, { session }).toArray()
          : [];
        if (settlementLogs.length) {
          throw serviceError(409, "This branch payment ticket is already being settled. Continue managing it from Tickets.");
        }
        for (const item of distributionItems) {
          const incoming = incomingById.get(item.id);
          const currentPurchaseQty = Number(item.actualPurchaseQty ?? item.orderedQty ?? 0);
          const purchasedQty = Number(incoming.actualPurchaseQty ?? currentPurchaseQty);
          const currentUnitPrice = Number(item.estimatedUnitPrice ?? item.unitPrice ?? 0);
          const updatedUnitPrice = Number(incoming.estimatedUnitPrice ?? currentUnitPrice);
          if (!Number.isFinite(purchasedQty) || purchasedQty < 0) throw serviceError(400, `${item.itemName}: actual purchase quantity must be zero or greater`);
          let paymentStatus = String(incoming.paymentStatus || "NOT_RECORDED").trim().toUpperCase();
          let paymentMethod = String(incoming.paymentMethod || "").trim();
          if (purchasedQty <= 0) {
            paymentStatus = "NOT_APPLICABLE";
            paymentMethod = "";
          } else {
            if (!Number.isFinite(updatedUnitPrice) || updatedUnitPrice < 0) {
              throw serviceError(400, `${item.itemName}: price must be zero or greater`);
            }
            if (item.paymentStatus === "PENDING_TICKET_CLOSED" && !item.expenseLogId) {
              if (updatedUnitPrice !== currentUnitPrice || purchasedQty !== currentPurchaseQty) {
                throw serviceError(409, `${item.itemName}: its pending ticket is already settled; create a payment adjustment before changing this row`);
              }
              continue;
            }
            if (item.paymentStatus === "EXPENSE_RECORDED" || item.expenseLogId) {
              if (updatedUnitPrice <= 0) throw serviceError(400, `${item.itemName}: final purchase price must be greater than zero`);
              if (updatedUnitPrice === currentUnitPrice && purchasedQty === currentPurchaseQty) continue;
              const expenseLog = await collection("expenseTicketLogs").findOne({ id: item.expenseLogId, distributionRunId: runId }, { session });
              if (!expenseLog) throw serviceError(409, `${item.itemName}: recorded expense could not be found`);
              if (!(expenseLog.items || []).some((entry) => entry.itemId === item.itemId)) {
                throw serviceError(409, `${item.itemName}: recorded expense item could not be found`);
              }
              const correctedItems = (expenseLog.items || []).map((entry) => (
                entry.itemId === item.itemId
                  ? { ...entry, qty: purchasedQty, unitPrice: updatedUnitPrice }
                  : entry
              ));
              const correctedAmount = Number(correctedItems.reduce((sum, entry) => sum + Number(entry.qty || 0) * Number(entry.unitPrice || 0), 0).toFixed(2));
              await collection("expenseTicketLogs").updateOne(
                { id: expenseLog.id, distributionRunId: runId },
                {
                  $set: { items: correctedItems, amount: correctedAmount, correctedAt: nowIso, correctedBy: user?.id || "" },
                  $push: { corrections: { idempotencyKey, itemId: item.itemId, previousQty: currentPurchaseQty, correctedQty: purchasedQty, previousUnitPrice: currentUnitPrice, correctedUnitPrice: updatedUnitPrice, correctedAt: nowIso, correctedBy: user?.id || "" } }
                },
                { session }
              );
              await collection("distributionItems").updateOne(
                { id: item.id, runId },
                { $set: { actualPurchaseQty: purchasedQty, estimatedUnitPrice: updatedUnitPrice, unitPrice: updatedUnitPrice, priceUpdatedAt: nowIso, priceUpdatedBy: user?.id || "", paymentUpdatedAt: nowIso, paymentUpdatedBy: user?.id || "" } },
                { session }
              );
              item.actualPurchaseQty = purchasedQty;
              item.estimatedUnitPrice = updatedUnitPrice;
              item.unitPrice = updatedUnitPrice;
              item.paymentStatus = "EXPENSE_RECORDED";
              continue;
            }
            if (!allowedStatuses.has(paymentStatus)) throw serviceError(400, `${item.itemName}: invalid payment status`);
            if (paymentStatus === "EXPENSE_RECORDED") throw serviceError(400, `${item.itemName}: expense record does not exist`);
            if (!allowedMethods.has(paymentMethod)) throw serviceError(400, `${item.itemName}: invalid payment method`);
            if (paymentStatus === "NOT_RECORDED") paymentMethod = "";
            if (paymentStatus === "PAID" && !paymentMethod) {
              throw serviceError(400, `${item.itemName}: payment method is required when marked Paid`);
            }
            item.estimatedUnitPrice = updatedUnitPrice;
            item.unitPrice = updatedUnitPrice;
            item.actualPurchaseQty = purchasedQty;
            item.expectedQty = Number(item.requestedQty || 0);
            item.receiptDefaultQty = Number(item.requestedQty || 0);
            if (paymentStatus === "PAID") {
              const amount = Number((purchasedQty * updatedUnitPrice).toFixed(2));
              if (amount <= 0) throw serviceError(400, `${item.itemName}: a positive estimated MRP is required when marked Paid`);
              if (!newlyPaidByMethod.has(paymentMethod)) newlyPaidByMethod.set(paymentMethod, []);
              newlyPaidByMethod.get(paymentMethod).push({ item, amount });
              continue;
            }
          }
          await collection("distributionItems").updateOne(
            { id: item.id, runId },
            { $set: { paymentStatus, paymentMethod, actualPurchaseQty: purchasedQty, expectedQty: Number(item.requestedQty || 0), receiptDefaultQty: Number(item.requestedQty || 0), estimatedUnitPrice: updatedUnitPrice, unitPrice: updatedUnitPrice, priceUpdatedAt: nowIso, priceUpdatedBy: user?.id || "", paymentUpdatedAt: nowIso, paymentUpdatedBy: user?.id || "" } },
            { session }
          );
          item.paymentStatus = paymentStatus;
          item.paymentMethod = paymentMethod;
          item.actualPurchaseQty = purchasedQty;
          item.expectedQty = Number(item.requestedQty || 0);
          item.receiptDefaultQty = Number(item.requestedQty || 0);
          item.paymentUpdatedAt = nowIso;
          item.paymentUpdatedBy = user?.id || "";
        }

        const expenseLogs = [];
        for (const [paymentMethod, paidRows] of newlyPaidByMethod.entries()) {
          const methodKey = paymentMethod.toLowerCase();
          const expenseLog = {
            id: uuidv4(),
            ticketId: "",
            branchId: run.branchId,
            category: "Purchase",
            assignee: user?.id || "",
            paymentMethod,
            amount: Number(paidRows.reduce((sum, row) => sum + row.amount, 0).toFixed(2)),
            date: getCurrentDateInIST(),
            items: paidRows.map(({ item }) => ({
              itemId: item.itemId,
              name: item.itemName,
              qty: Number(item.actualPurchaseQty ?? item.orderedQty ?? 0),
              unitPrice: Number(item.estimatedUnitPrice ?? item.unitPrice ?? 0)
            })),
            sourceType: "WEEKLY_PURCHASE_PAYMENT",
            sourceId: `${idempotencyKey}:${methodKey}`,
            paymentBatchId: idempotencyKey,
            weeklyRequestId: run.requestId,
            purchaseRunId: run.combinedRunId,
            distributionRunId: run.id,
            status: "LOGGED",
            paidAt: nowIso,
            createdAt: nowIso
          };
          await collection("expenseTicketLogs").insertOne(expenseLog, { session });
          for (const { item } of paidRows) {
            await collection("distributionItems").updateOne(
              { id: item.id, runId },
              { $set: {
                paymentStatus: "EXPENSE_RECORDED",
                paymentMethod,
                actualPurchaseQty: item.actualPurchaseQty,
                expectedQty: item.expectedQty,
                receiptDefaultQty: item.receiptDefaultQty,
                estimatedUnitPrice: item.estimatedUnitPrice,
                unitPrice: item.unitPrice,
                priceUpdatedAt: nowIso,
                priceUpdatedBy: user?.id || "",
                paymentUpdatedAt: nowIso,
                paymentUpdatedBy: user?.id || "",
                paymentRecordedAt: nowIso,
                expenseLogId: expenseLog.id,
                paymentBatchId: idempotencyKey
              } },
              { session }
            );
            item.paymentStatus = "EXPENSE_RECORDED";
            item.paymentMethod = paymentMethod;
            item.paymentUpdatedAt = nowIso;
            item.paymentUpdatedBy = user?.id || "";
            item.paymentRecordedAt = nowIso;
            item.expenseLogId = expenseLog.id;
            item.paymentBatchId = idempotencyKey;
          }
          expenseLogs.push(expenseLog);
        }

        const pendingRows = distributionItems.filter((item) => item.paymentStatus === "PENDING");
        let pendingTicket = existingPendingTicket;
        if (pendingRows.length) {
          const ticketItems = pendingRows.map((item) => ({
            distributionItemId: item.id,
            itemId: item.itemId,
            name: item.itemName,
            qty: Number(item.actualPurchaseQty ?? item.orderedQty ?? 0),
            unitPrice: Number(item.estimatedUnitPrice ?? item.unitPrice ?? 0)
          }));
          const amount = Number(ticketItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0).toFixed(2));
          if (amount <= 0) throw serviceError(400, "Pending purchase ticket total must be greater than zero");
          const ticketUpdate = {
            category: "Purchase",
            branchId: run.branchId,
            assignee: user?.id || "",
            paymentMethod: "",
            amount,
            date: getCurrentDateInIST(),
            attachmentName: "",
            attachmentType: "",
            attachmentData: "",
            items: ticketItems,
            employeeName: "",
            source: "Weekly Purchase",
            note: `Weekly purchase for ${run.weekStartDate || ""}`.trim(),
            sourceType: "WEEKLY_PURCHASE",
            sourceId: pendingSourceId,
            weeklyRequestId: run.requestId,
            purchaseRunId: run.combinedRunId,
            distributionRunId: run.id,
            status: "PENDING",
            updatedAt: nowIso
          };
          if (pendingTicket) {
            if (pendingTicket.status === "LOGGED") throw serviceError(409, "The branch payment ticket has already been closed");
            await collection("expenseTickets").updateOne(
              { id: pendingTicket.id },
              { $set: ticketUpdate },
              { session }
            );
            pendingTicket = { ...pendingTicket, ...ticketUpdate };
          } else {
            pendingTicket = { id: uuidv4(), ...ticketUpdate, createdAt: nowIso };
            await collection("expenseTickets").insertOne(pendingTicket, { session });
          }
          for (const item of pendingRows) {
            await collection("distributionItems").updateOne(
              { id: item.id, runId },
              { $set: { paymentStatus: "PENDING_TICKET_OPEN", pendingTicketId: pendingTicket.id } },
              { session }
            );
            item.paymentStatus = "PENDING_TICKET_OPEN";
            item.pendingTicketId = pendingTicket.id;
          }
        } else if (pendingTicket && pendingTicket.status === "PENDING") {
          await collection("expenseTickets").updateOne(
            { id: pendingTicket.id },
            { $set: { status: "CANCELLED", amount: 0, items: [], cancelledAt: nowIso, cancelledBy: user?.id || "", updatedAt: nowIso } },
            { session }
          );
          pendingTicket = { ...pendingTicket, status: "CANCELLED", amount: 0, items: [] };
        }

        const [orderLog, allPaymentLogs] = await Promise.all([
          collection("weeklyPurchaseOrderLogs").findOne({ id: run.orderLogId }, { session }),
          collection("expenseTicketLogs").find({ distributionRunId: run.id, status: { $ne: "DELETED" } }, { session }).toArray()
        ]);
        const orderedByItem = new Map((orderLog?.items || []).map((item) => [item.itemId, item]));
        const centralItems = distributionItems.map((item) => {
          const actualPurchaseQty = Number(item.actualPurchaseQty ?? item.orderedQty ?? 0);
          const finalUnitPrice = Number(item.estimatedUnitPrice ?? item.unitPrice ?? 0);
          return {
            itemId: item.itemId,
            itemName: item.itemName,
            orderedQty: Number(item.orderedQty || 0),
            actualPurchaseQty,
            orderedEstimatedUnitPrice: Number(orderedByItem.get(item.itemId)?.estimatedUnitPrice ?? finalUnitPrice),
            finalUnitPrice,
            purchaseAmount: Number((actualPurchaseQty * finalUnitPrice).toFixed(2)),
            paymentStatus: item.paymentStatus,
            paymentMethod: item.paymentMethod || ""
          };
        });
        const paidAmount = Number(allPaymentLogs.reduce((sum, log) => sum + Number(log.amount || 0), 0).toFixed(2));
        await upsertWeeklyCentralPurchaseLog(collection("weeklyCentralPurchaseLogs"), run.weekStartDate, {
          branchId: run.branchId,
          requestId: run.requestId,
          purchaseRunId: run.combinedRunId,
          distributionRunId: run.id,
          orderLogId: run.orderLogId,
          status: pendingTicket?.status === "PENDING" ? "PAYMENT_PENDING" : paidAmount > 0 ? "PAYMENT_RECORDED" : "ORDERED",
          distributionStatus: run.status,
          orderedAt: orderLog?.orderedAt || "",
          orderedQty: centralItems.reduce((sum, item) => sum + item.orderedQty, 0),
          purchasedQty: centralItems.reduce((sum, item) => sum + item.actualPurchaseQty, 0),
          purchaseAmount: centralItems.reduce((sum, item) => sum + item.purchaseAmount, 0),
          paidAmount,
          pendingAmount: pendingTicket?.status === "PENDING" ? Number(pendingTicket.amount || 0) : 0,
          cashPaid: allPaymentLogs.filter((log) => log.paymentMethod === "Cash").reduce((sum, log) => sum + Number(log.amount || 0), 0),
          upiPaid: allPaymentLogs.filter((log) => log.paymentMethod === "UPI").reduce((sum, log) => sum + Number(log.amount || 0), 0),
          items: centralItems
        }, { session });

        const result = await collection("distributionRuns").updateOne(
          { id: runId, status: run.status, version: expectedVersion },
          { $set: { paymentUpdatedAt: nowIso, paymentUpdatedBy: user?.id || "" }, $inc: { version: 1 } },
          { session }
        );
        if (result.modifiedCount !== 1) throw serviceError(409, "Distribution changed elsewhere. Reload and try again.");
        response = { run: { ...run, version: expectedVersion + 1, paymentUpdatedAt: nowIso, paymentUpdatedBy: user?.id || "" }, items: distributionItems, expenseLogs, pendingTicket, replayed: false };
      });
      return response;
    } finally {
      await session.endSession();
    }
  }

  return { verifyReceipt, closeRun, updatePayments };
}
