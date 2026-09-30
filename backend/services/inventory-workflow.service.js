export function createInventoryWorkflowService({ getDb, COLLECTIONS, uuidv4, startOfWeek }) {
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
      .sort({ createdAt: 1 })
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
    const inventoryMap = await getCentralInventoryMap(itemIds);
    const masterItems = await masterItemsCol.find({ id: { $in: itemIds } }).toArray();
    const masterMap = new Map(masterItems.map((it) => [it.id, it]));
    const categories = await categoriesCol.find({}).toArray();
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  
    const remainingMap = new Map(inventoryMap);
    const shortfallByRequest = new Map();
  
    for (const pendingReq of pendingReqs) {
      const reqItems = itemsByReqId.get(pendingReq.id) || [];
      const shortfallMap = new Map();
      for (const row of reqItems) {
        const requestedQty = Number(row.requestedQty || 0);
        const onHand = remainingMap.get(row.itemId) || 0;
        const allocated = Math.min(requestedQty, onHand);
        const shortfall = Math.max(0, requestedQty - allocated);
        if (shortfall > 0) shortfallMap.set(row.itemId, shortfall);
        remainingMap.set(row.itemId, onHand - allocated);
      }
      shortfallByRequest.set(pendingReq.id, shortfallMap);
    }
  
    for (const pendingReq of pendingReqs) {
      const run = runMap.get(pendingReq.id);
      if (!run || run.status !== "DRAFT") continue;
      const reqItems = itemsByReqId.get(pendingReq.id) || [];
      const shortfallMap = shortfallByRequest.get(pendingReq.id) || new Map();
      const autoItems = [];
      for (const [itemId, shortfall] of shortfallMap.entries()) {
        const item = masterMap.get(itemId);
        if (!item) continue;
        autoItems.push({
          id: uuidv4(),
          runId: run.id,
          itemId,
          itemName: item.name,
          categoryName: categoryMap.get(item.categoryId) || "",
          requestedTotal: shortfall,
          approvedQty: shortfall,
          unitPrice: item.defaultPrice || 0,
          status: "AVAILABLE",
          manual: false,
          createdAt: new Date().toISOString()
        });
      }
  
      await itemsCol.deleteMany({ runId: run.id, manual: { $ne: true } });
      if (autoItems.length) {
        await itemsCol.insertMany(autoItems);
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
      }
    }
  
    return runMap.get(requestId) || null;
  }
  
  
  return { getCentralInventoryMap, upsertCentralInventory, createCombinedPurchaseRunForRequest };
}
