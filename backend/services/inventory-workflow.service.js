export function createInventoryWorkflowService({ getDb, getClient, COLLECTIONS, uuidv4, startOfWeek }) {
  const db = { collection: (...args) => getDb().collection(...args) };

  async function getCentralInventoryMap(itemIds) {
    if (!itemIds.length) return new Map();
    const list = await db
      .collection(COLLECTIONS.CENTRAL_INVENTORY)
      .find({ itemId: { $in: itemIds } })
      .toArray();
    return new Map(list.map((row) => [row.itemId, Number(row.onHand || 0)]));
  }
  
  async function upsertCentralInventory(itemId, delta) {
    if (!itemId || !delta) return;
    await db.collection(COLLECTIONS.CENTRAL_INVENTORY).updateOne(
      { itemId },
      { $inc: { onHand: delta }, $set: { updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
  }

  async function reserveInventory(itemId, quantity, { session } = {}) {
    const qty = Number(quantity || 0);
    if (!itemId || qty <= 0) return 0;
    const inventory = db.collection(COLLECTIONS.CENTRAL_INVENTORY);
    const row = await inventory.findOne({ itemId }, { session });
    const onHand = Number(row?.onHand || 0);
    const reserved = Number(row?.reserved || 0);
    const allocated = Math.min(qty, Math.max(0, onHand - reserved));
    if (!allocated) return 0;
    const result = await inventory.updateOne(
      { itemId, $expr: { $gte: [{ $subtract: [{ $ifNull: ["$onHand", 0] }, { $ifNull: ["$reserved", 0] }] }, allocated] } },
      { $inc: { reserved: allocated }, $set: { updatedAt: new Date().toISOString() } },
      { session }
    );
    if (result.modifiedCount !== 1) {
      throw Object.assign(new Error("Inventory reservation changed concurrently. Please retry."), { status: 409 });
    }
    return allocated;
  }

  async function releaseInventory(itemId, quantity, { session } = {}) {
    const qty = Number(quantity || 0);
    if (!itemId || qty <= 0) return 0;
    const inventory = db.collection(COLLECTIONS.CENTRAL_INVENTORY);
    const row = await inventory.findOne({ itemId }, { session });
    const released = Math.min(qty, Number(row?.reserved || 0));
    if (!released) return 0;
    await inventory.updateOne(
      { itemId },
      { $inc: { reserved: -released }, $set: { updatedAt: new Date().toISOString() } },
      { session }
    );
    return released;
  }

  async function commitReservation(itemId, quantity, { session } = {}) {
    const qty = Number(quantity || 0);
    if (!itemId || qty <= 0) return 0;
    const inventory = db.collection(COLLECTIONS.CENTRAL_INVENTORY);
    const row = await inventory.findOne({ itemId }, { session });
    const committed = Math.min(qty, Number(row?.reserved || 0), Number(row?.onHand || 0));
    if (!committed) return 0;
    await inventory.updateOne(
      { itemId, onHand: { $gte: committed }, reserved: { $gte: committed } },
      { $inc: { onHand: -committed, reserved: -committed }, $set: { updatedAt: new Date().toISOString() } },
      { session }
    );
    return committed;
  }

  async function submitWeeklyRequestWithReservations(requestId) {
    const session = getClient().startSession();
    let submittedRequest;
    try {
      await session.withTransaction(async () => {
        const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
        const reqItemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);
        const request = await requestsCol.findOne({ id: requestId }, { session });
        if (!request || request.status !== "DRAFT") {
          throw Object.assign(new Error("Only draft can be submitted"), { status: 400 });
        }
        const items = await reqItemsCol.find({ requestId }, { session }).toArray();
        if (!items.length) throw Object.assign(new Error("Cannot submit an empty request"), { status: 400 });
        const submittedAt = new Date().toISOString();
        for (const item of items) {
          const requestedQty = Number(item.requestedQty || 0);
          const centralReservedQty = await reserveInventory(item.itemId, requestedQty, { session });
          await reqItemsCol.updateOne(
            { id: item.id, requestId },
            { $set: { centralReservedQty, purchaseRequiredQty: Math.max(0, requestedQty - centralReservedQty) } },
            { session }
          );
        }
        await requestsCol.updateOne(
          { id: requestId, status: "DRAFT" },
          { $set: { status: "SUBMITTED", submittedAt, updatedAt: submittedAt } },
          { session }
        );
        submittedRequest = { ...request, status: "SUBMITTED", submittedAt, updatedAt: submittedAt };
      });
      return submittedRequest;
    } finally {
      await session.endSession();
    }
  }
  
  async function createCombinedPurchaseRunForRequest(requestId) {
    const runsCol = db.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS);
    const itemsCol = db.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS);
    const distRunsCol = db.collection(COLLECTIONS.DISTRIBUTION_RUNS);
    const distItemsCol = db.collection(COLLECTIONS.DISTRIBUTION_ITEMS);
    const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
    const reqItemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);
    const masterItemsCol = db.collection(COLLECTIONS.ITEMS);
    const categoriesCol = db.collection(COLLECTIONS.CATEGORIES);
  
    const targetReq = await requestsCol.findOne({ id: requestId });
    const targetWeek = targetReq?.weekStartDate || startOfWeek();
    const pendingReqs = await requestsCol
      .find({ status: "SUBMITTED", weekStartDate: targetWeek })
      .sort({ submittedAt: 1, createdAt: 1 })
      .toArray();
    if (!pendingReqs.length) return null;
  
    const runMap = new Map();
    const pendingIds = pendingReqs.map((r) => r.id);
    const staleRuns = await runsCol
      .find({ status: "DRAFT", weekStartDate: targetWeek, requestId: { $nin: pendingIds } })
      .toArray();
    if (staleRuns.length) {
      const staleIds = staleRuns.map((r) => r.id);
      await itemsCol.deleteMany({ runId: { $in: staleIds }, manual: { $ne: true } });
      await runsCol.updateMany({ id: { $in: staleIds } }, { $set: { status: "ARCHIVED", updatedAt: new Date().toISOString() } });
    }
    for (const pendingReq of pendingReqs) {
      let run = await runsCol.findOne({ requestId: pendingReq.id });
      if (run && run.status !== "DRAFT") continue;
      if (!run) {
        run = {
          id: uuidv4(),
          requestId: pendingReq.id,
          branchId: pendingReq.branchId,
          weekStartDate: pendingReq.weekStartDate,
          status: "DRAFT",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await runsCol.insertOne(run);
      }
      runMap.set(pendingReq.id, run);
    }
  
    const allReqItems = pendingIds.length ? await reqItemsCol.find({ requestId: { $in: pendingIds } }).toArray() : [];
    if (!allReqItems.length) return runMap.get(requestId) || null;
  
    const itemsByReqId = new Map();
    allReqItems.forEach((row) => {
      if (!itemsByReqId.has(row.requestId)) itemsByReqId.set(row.requestId, []);
      itemsByReqId.get(row.requestId).push(row);
    });
  
    const itemIds = Array.from(new Set(allReqItems.map((r) => r.itemId)));
    const masterItems = await masterItemsCol.find({ id: { $in: itemIds } }).toArray();
    const masterMap = new Map(masterItems.map((it) => [it.id, it]));
    const categories = await categoriesCol.find({}).toArray();
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  
    const shortfallByRequest = new Map();
  
    for (const pendingReq of pendingReqs) {
      const reqItems = itemsByReqId.get(pendingReq.id) || [];
      const shortfallMap = new Map();
      for (const row of reqItems) {
        const requestedQty = Number(row.requestedQty || 0);
        const allocated = Number(row.centralReservedQty || 0);
        const shortfall = Number(row.purchaseRequiredQty ?? Math.max(0, requestedQty - allocated));
        if (shortfall > 0) shortfallMap.set(row.itemId, shortfall);
      }
      shortfallByRequest.set(pendingReq.id, shortfallMap);
    }
  
    for (const pendingReq of pendingReqs) {
      const run = runMap.get(pendingReq.id);
      if (!run || run.status !== "DRAFT") continue;
      const reqItems = itemsByReqId.get(pendingReq.id) || [];
      const reqItemByItemId = new Map(reqItems.map((item) => [item.itemId, item]));
      const shortfallMap = shortfallByRequest.get(pendingReq.id) || new Map();
      const autoItems = [];
      for (const [itemId, shortfall] of shortfallMap.entries()) {
        const item = masterMap.get(itemId);
        const requestItem = reqItemByItemId.get(itemId);
        if (!item) continue;
        autoItems.push({
          id: uuidv4(),
          runId: run.id,
          itemId,
          itemName: item.name,
          categoryName: categoryMap.get(item.categoryId) || "",
          requestedQty: Number(requestItem?.requestedQty || 0),
          centralReservedQty: Number(requestItem?.centralReservedQty || 0),
          purchaseRequiredQty: shortfall,
          requestedTotal: shortfall,
          orderQty: shortfall,
          approvedQty: shortfall,
          estimatedUnitPrice: item.defaultPrice || 0,
          unitPrice: item.defaultPrice || 0,
          includeInPdf: true,
          status: "AVAILABLE",
          manual: false,
          createdAt: new Date().toISOString()
        });
      }
  
      const existingItems = await itemsCol.find({ runId: run.id }).toArray();
      const autoItemIds = new Set(autoItems.map((item) => item.itemId));
      await itemsCol.deleteMany({ runId: run.id, manual: { $ne: true }, itemId: { $nin: Array.from(autoItemIds) } });
      for (const autoItem of autoItems) {
        const existing = existingItems.find((item) => item.itemId === autoItem.itemId);
        if (existing?.manual) {
          await itemsCol.updateOne(
            { id: existing.id, runId: run.id },
            { $set: {
              requestedQty: autoItem.requestedQty,
              centralReservedQty: autoItem.centralReservedQty,
              purchaseRequiredQty: autoItem.purchaseRequiredQty,
              requestedTotal: autoItem.requestedTotal,
              updatedAt: new Date().toISOString()
            } }
          );
        } else {
          await itemsCol.updateOne(
            { runId: run.id, itemId: autoItem.itemId },
            { $set: autoItem },
            { upsert: true }
          );
        }
      }
      await runsCol.updateOne({ id: run.id }, { $set: { updatedAt: new Date().toISOString() } });
  
      if (!autoItems.length) {
        const existingDist = await distRunsCol.findOne({ requestId: pendingReq.id });
        if (!existingDist) {
          const distRun = {
            id: uuidv4(),
            requestId: pendingReq.id,
            branchId: pendingReq.branchId,
            weekStartDate: pendingReq.weekStartDate,
            combinedRunId: run.id,
            status: "AWAITING_RECEIPT",
            version: 0,
            createdAt: new Date().toISOString()
          };
          await distRunsCol.insertOne(distRun);
  
          const distItems = reqItems.map((row) => {
            const receiptDefaultQty = Number(row.requestedQty || 0);
            return {
              id: uuidv4(),
              runId: distRun.id,
              requestId: pendingReq.id,
              branchId: pendingReq.branchId,
              itemId: row.itemId,
              itemName: row.itemName,
              categoryName: row.categoryName,
              requestedQty: row.requestedQty,
              approvedQty: receiptDefaultQty,
              centralReservedQty: receiptDefaultQty,
              receiptDefaultQty,
              deliveredQty: null,
              mismatchReason: "",
              unitPrice: row.unitPrice || 0,
              status: "AVAILABLE"
            };
          });
  
          if (distItems.length) {
            await distItemsCol.insertMany(distItems);
          }
        }
        await runsCol.updateOne(
          { id: run.id, status: "DRAFT" },
          { $set: { status: "FULFILLED_FROM_STOCK", updatedAt: new Date().toISOString() } }
        );
      }
    }
  
    return runMap.get(requestId) || null;
  }
  
  
  return {
    getCentralInventoryMap,
    upsertCentralInventory,
    reserveInventory,
    releaseInventory,
    commitReservation,
    submitWeeklyRequestWithReservations,
    createCombinedPurchaseRunForRequest
  };
}
