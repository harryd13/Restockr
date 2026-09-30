export function createCombinedPurchasesService(context) {
  const { repository, uuidv4, ensureAdmin, formatDateLocal, getCurrentDateInIST, parseStartDate, startOfWeek, getCentralInventoryMap, upsertCentralInventory } = context;
  return {
    handle1: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const runs = await repository.combinedPurchaseRuns()
      .find({ status: "DRAFT" })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(runs);
  },

    handle2: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const runId = req.query.runId;
    if (!runId) return res.status(400).json({ message: "runId is required" });
    const run = await repository.combinedPurchaseRuns().findOne({ id: runId });
    if (!run) return res.status(404).json({ message: "Combined purchase run not found" });
    const items = await repository.combinedPurchaseItems().find({ runId: run.id }).toArray();
    res.json({ run, items });
  },

    handle3: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const weekStartDate = String(req.query.week || startOfWeek()).trim();
    const runs = await repository.combinedPurchaseRuns()
      .find({ status: "DRAFT", weekStartDate })
      .sort({ createdAt: -1 })
      .toArray();
    const runIds = runs.map((r) => r.id);
    const items = runIds.length ? await repository.combinedPurchaseItems().find({ runId: { $in: runIds } }).toArray() : [];
  
    const combinedMap = new Map();
    for (const row of items) {
      const entry = combinedMap.get(row.itemId) || {
        itemId: row.itemId,
        itemName: row.itemName,
        categoryName: row.categoryName,
        requestedTotal: 0,
        approvedQty: 0,
        unitPrice: row.unitPrice || 0,
        status: "AVAILABLE"
      };
      entry.requestedTotal += Number(row.requestedTotal || 0);
      entry.approvedQty += Number(row.approvedQty || 0);
      if (row.status === "UNAVAILABLE") {
        entry.status = "UNAVAILABLE";
      } else if (row.status === "PAYMENT_PENDING" && entry.status !== "UNAVAILABLE") {
        entry.status = "PAYMENT_PENDING";
      }
      if (!entry.unitPrice) entry.unitPrice = row.unitPrice || 0;
      combinedMap.set(row.itemId, entry);
    }
  
    const combined = Array.from(combinedMap.values()).sort((a, b) => a.itemName.localeCompare(b.itemName));
    res.json({ rows: combined, runIds });
  },

    handle4: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { rows, cashAmount, onlineAmount } = req.body;
    if (!Array.isArray(rows)) return res.status(400).json({ message: "rows array is required" });
  
    const runsCol = repository.combinedPurchaseRuns();
    const itemsCol = repository.combinedPurchaseItems();
    const logsCol = repository.combinedPurchaseLogs();
    const expenseTicketsCol = repository.expenseTickets();
    const distRunsCol = repository.distributionRuns();
    const distItemsCol = repository.distributionItems();
    const reqCol = repository.weeklyRequests();
    const reqItemsCol = repository.weeklyRequestItems();
    const reconciliationsCol = repository.distributionReconciliations();
  
    const weekStartDate = String(req.query.week || startOfWeek()).trim();
    const draftRuns = await runsCol.find({ status: "DRAFT", weekStartDate }).sort({ createdAt: 1 }).toArray();
    const runIds = draftRuns.map((r) => r.id);
  
    const logItems = rows.map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      categoryName: row.categoryName,
      requestedTotal: Number(row.requestedTotal || 0),
      approvedQty: Number(row.approvedQty || 0),
      unitPrice: Number(row.unitPrice || 0),
      status: row.status === "UNAVAILABLE" ? "UNAVAILABLE" : row.status === "PAYMENT_PENDING" ? "PAYMENT_PENDING" : "AVAILABLE"
    }));
    const logTotal = logItems.reduce((sum, row) => {
      if (row.status !== "AVAILABLE") return sum;
      return sum + (row.approvedQty || 0) * (row.unitPrice || 0);
    }, 0);
    const normalizedCashAmount = Number(cashAmount || 0);
    const normalizedOnlineAmount = Number(onlineAmount || 0);
    if (!Number.isFinite(normalizedCashAmount) || normalizedCashAmount < 0) {
      return res.status(400).json({ message: "Cash amount must be a valid number" });
    }
    if (!Number.isFinite(normalizedOnlineAmount) || normalizedOnlineAmount < 0) {
      return res.status(400).json({ message: "Online amount must be a valid number" });
    }
    if (Number((normalizedCashAmount + normalizedOnlineAmount).toFixed(2)) !== Number(logTotal.toFixed(2))) {
      return res.status(400).json({ message: "Cash and online split must match total spend" });
    }
  
    await logsCol.insertOne({
      id: uuidv4(),
      combinedRunIds: runIds,
      weekStartDate,
      date: getCurrentDateInIST(),
      requestCount: draftRuns.length,
      createdAt: new Date().toISOString(),
      total: logTotal,
      cashAmount: normalizedCashAmount,
      onlineAmount: normalizedOnlineAmount,
      items: logItems
    });
  
    for (const item of logItems) {
      if ((item.status === "AVAILABLE" || item.status === "PAYMENT_PENDING") && item.approvedQty > 0) {
        await upsertCentralInventory(item.itemId, item.approvedQty);
      }
    }
  
    if (runIds.length) {
      await runsCol.updateMany({ id: { $in: runIds } }, { $set: { status: "SUBMITTED", submittedAt: new Date().toISOString() } });
    }
  
    const reqIds = draftRuns.map((r) => r.requestId).filter(Boolean);
    const reqItemsAll = reqIds.length ? await reqItemsCol.find({ requestId: { $in: reqIds } }).toArray() : [];
    const allItemIds = Array.from(new Set(reqItemsAll.map((row) => row.itemId)));
    const inventoryMap = await getCentralInventoryMap(allItemIds);
    const itemsById = new Map(logItems.map((row) => [row.itemId, row]));
    const purchasedByItem = new Map(logItems.map((row) => [
      row.itemId,
      row.status === "AVAILABLE" || row.status === "PAYMENT_PENDING" ? Number(row.approvedQty || 0) : 0
    ]));
    const nowIso = new Date().toISOString();
    for (const itemId of allItemIds) {
      const existing = await reconciliationsCol.findOne({ weekStartDate, itemId });
      const purchasedQty = purchasedByItem.get(itemId) || 0;
      if (existing) {
        if (purchasedQty > 0) {
          const initialInventoryQty = Number(existing.initialInventoryQty || 0) + purchasedQty;
          const combinedReceivedQty = Number(existing.combinedReceivedQty || 0);
          const remainingQty = Math.max(0, initialInventoryQty - combinedReceivedQty);
          const overDeliveredQty = Math.max(0, combinedReceivedQty - initialInventoryQty);
          await reconciliationsCol.updateOne(
            { id: existing.id, version: Number(existing.version || 0) },
            {
              $set: {
                initialInventoryQty,
                remainingQty,
                overDeliveredQty,
                status: overDeliveredQty > 0 ? "REVIEW_REQUIRED" : remainingQty === 0 ? "BALANCED" : "OPEN",
                updatedAt: nowIso
              },
              $inc: { version: 1 }
            }
          );
        }
      } else {
        const initialInventoryQty = Number(inventoryMap.get(itemId) || 0);
        await reconciliationsCol.insertOne({
          id: uuidv4(),
          weekStartDate,
          itemId,
          initialInventoryQty,
          combinedReceivedQty: 0,
          remainingQty: initialInventoryQty,
          overDeliveredQty: 0,
          status: "OPEN",
          version: 0,
          createdAt: nowIso,
          updatedAt: nowIso
        });
      }
    }
  
    const pendingTicketsByReq = new Map();
    for (const run of draftRuns) {
      const existingDist = await distRunsCol.findOne({ combinedRunId: run.id });
      if (existingDist) continue;
      const req = await reqCol.findOne({ id: run.requestId });
      if (!req) continue;
      const reqItems = reqItemsAll.filter((row) => row.requestId === req.id);
      const distRun = {
        id: uuidv4(),
        requestId: req.id,
        branchId: req.branchId,
        weekStartDate: req.weekStartDate,
        combinedRunId: run.id,
        status: "AWAITING_RECEIPT",
        version: 0,
        createdAt: new Date().toISOString()
      };
      await distRunsCol.insertOne(distRun);
  
      const distItems = [];
      for (const row of reqItems) {
        const purchaseItem = itemsById.get(row.itemId);
        const inventoryAvailable = Number(inventoryMap.get(row.itemId) || 0) > 0;
        const receiptDefaultQty = inventoryAvailable ? Number(row.requestedQty || 0) : 0;
        const isPending = purchaseItem?.status === "PAYMENT_PENDING";
        if (isPending && receiptDefaultQty > 0) {
          if (!pendingTicketsByReq.has(req.id)) pendingTicketsByReq.set(req.id, []);
          pendingTicketsByReq.get(req.id).push({
            name: row.itemName,
            qty: receiptDefaultQty,
            unitPrice: purchaseItem?.unitPrice || row.unitPrice || 0
          });
        }
        distItems.push({
          id: uuidv4(),
          runId: distRun.id,
          requestId: req.id,
          branchId: req.branchId,
          itemId: row.itemId,
          itemName: row.itemName,
          categoryName: row.categoryName,
          requestedQty: row.requestedQty,
          approvedQty: receiptDefaultQty,
          receiptDefaultQty,
          deliveredQty: null,
          mismatchReason: receiptDefaultQty === 0 ? "Wasn't available for procurement" : "",
          unitPrice: purchaseItem?.unitPrice || row.unitPrice || 0,
          status: receiptDefaultQty > 0 ? (isPending ? "PAYMENT_PENDING" : "AVAILABLE") : "UNAVAILABLE"
        });
      }
      if (distItems.length) {
        await distItemsCol.insertMany(distItems);
      }
    }
  
    if (pendingTicketsByReq.size) {
      const nowIso = new Date().toISOString();
      const pendingTickets = [];
      for (const [reqId, items] of pendingTicketsByReq.entries()) {
        const reqObj = await reqCol.findOne({ id: reqId });
        if (!reqObj) continue;
        const amount = items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0), 0);
        pendingTickets.push({
          id: uuidv4(),
          category: "Purchase",
          branchId: reqObj.branchId,
          assignee: "",
          paymentMethod: "",
          amount: Number(amount || 0),
          date: reqObj.weekStartDate || formatDateLocal(new Date(reqObj.createdAt || Date.now())),
          attachmentName: "",
          attachmentType: "",
          attachmentData: "",
          items: items.map((row) => ({
            name: row.name,
            qty: Number(row.qty || 0),
            unitPrice: Number(row.unitPrice || 0)
          })),
          employeeName: "",
          source: "",
          note: "",
          status: "PENDING",
          createdAt: nowIso,
          updatedAt: nowIso
        });
      }
      if (pendingTickets.length) {
        await expenseTicketsCol.insertMany(pendingTickets);
      }
    }
  
    const updatedRuns = await runsCol.find({ status: "DRAFT" }).toArray();
    res.json({ ok: true, remaining: updatedRuns.length });
  },

    handle5: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const startDate = parseStartDate(req.query.startDate);
    const filter = startDate ? { createdAt: { $gte: startDate } } : {};
    const logs = await repository.combinedPurchaseLogs()
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();
    res.json(logs);
  },

    handle6: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const { items: bodyItems } = req.body;
    const itemsCol = repository.combinedPurchaseItems();
    const run = await repository.combinedPurchaseRuns().findOne({ id });
    if (!run) return res.status(404).json({ message: "Combined purchase run not found" });
    if (run.status !== "DRAFT") return res.status(400).json({ message: "Run is not editable" });
  
    for (const item of bodyItems || []) {
      const update = {};
      if (typeof item.approvedQty === "number") update.approvedQty = item.approvedQty;
      if (typeof item.unitPrice === "number") update.unitPrice = item.unitPrice;
      if (item.status === "AVAILABLE" || item.status === "UNAVAILABLE" || item.status === "PAYMENT_PENDING") {
        update.status = item.status;
      }
      if (item.status === "UNAVAILABLE") update.approvedQty = 0;
      if (typeof item.requestedTotal === "number") update.requestedTotal = item.requestedTotal;
      if (Object.keys(update).length) {
        await itemsCol.updateOne({ id: item.id, runId: id }, { $set: update });
      }
    }
  
    const updatedItems = await itemsCol.find({ runId: id }).toArray();
    res.json(updatedItems);
  },

    handle7: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const { itemId, approvedQty, unitPrice, status } = req.body;
    if (!itemId) return res.status(400).json({ message: "itemId is required" });
    const runsCol = repository.combinedPurchaseRuns();
    const run = await runsCol.findOne({ id });
    if (!run) return res.status(404).json({ message: "Combined purchase run not found" });
    if (run.status !== "DRAFT") return res.status(400).json({ message: "Run is not editable" });
  
    const itemDoc = await repository.items().findOne({ id: itemId });
    if (!itemDoc) return res.status(400).json({ message: "Invalid itemId" });
    const categoryDoc = await repository.categories().findOne({ id: itemDoc.categoryId });
    const doc = {
      id: uuidv4(),
      runId: id,
      itemId,
      itemName: itemDoc.name,
      categoryName: categoryDoc?.name || "",
      requestedTotal: Number(approvedQty || 0),
      approvedQty: Number(approvedQty || 0),
      unitPrice: typeof unitPrice === "number" ? unitPrice : itemDoc.defaultPrice || 0,
      status: status === "UNAVAILABLE" ? "UNAVAILABLE" : status === "PAYMENT_PENDING" ? "PAYMENT_PENDING" : "AVAILABLE",
      manual: true,
      createdAt: new Date().toISOString()
    };
    await repository.combinedPurchaseItems().insertOne(doc);
    res.status(201).json(doc);
  },

    handle8: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const { cashAmount, onlineAmount } = req.body || {};
    const runsCol = repository.combinedPurchaseRuns();
    const itemsCol = repository.combinedPurchaseItems();
    const logsCol = repository.combinedPurchaseLogs();
    const run = await runsCol.findOne({ id });
    if (!run) return res.status(404).json({ message: "Combined purchase run not found" });
    if (run.status !== "DRAFT") return res.status(400).json({ message: "Run already submitted" });
  
    const items = await itemsCol.find({ runId: id }).toArray();
    if (!items.length) return res.status(400).json({ message: "No items to submit" });
  
    const logItems = items.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      categoryName: item.categoryName,
      requestedTotal: item.requestedTotal,
      approvedQty: item.approvedQty,
      unitPrice: item.unitPrice,
      status: item.status
    }));
    const logTotal = logItems.reduce((sum, row) => {
      if (row.status !== "AVAILABLE") return sum;
      return sum + (row.approvedQty || 0) * (row.unitPrice || 0);
    }, 0);
    const normalizedCashAmount = Number(cashAmount || 0);
    const normalizedOnlineAmount = Number(onlineAmount || 0);
    if (!Number.isFinite(normalizedCashAmount) || normalizedCashAmount < 0) {
      return res.status(400).json({ message: "Cash amount must be a valid number" });
    }
    if (!Number.isFinite(normalizedOnlineAmount) || normalizedOnlineAmount < 0) {
      return res.status(400).json({ message: "Online amount must be a valid number" });
    }
    if (Number((normalizedCashAmount + normalizedOnlineAmount).toFixed(2)) !== Number(logTotal.toFixed(2))) {
      return res.status(400).json({ message: "Cash and online split must match total spend" });
    }
    await logsCol.insertOne({
      id: uuidv4(),
      combinedRunId: run.id,
      requestId: run.requestId,
      branchId: run.branchId,
      weekStartDate: run.weekStartDate,
      date: getCurrentDateInIST(),
      createdAt: new Date().toISOString(),
      total: logTotal,
      cashAmount: normalizedCashAmount,
      onlineAmount: normalizedOnlineAmount,
      items: logItems
    });
  
    for (const item of items) {
      if ((item.status === "AVAILABLE" || item.status === "PAYMENT_PENDING") && Number(item.approvedQty || 0) > 0) {
        await upsertCentralInventory(item.itemId, Number(item.approvedQty || 0));
      }
    }
  
    await runsCol.updateOne({ id }, { $set: { status: "SUBMITTED", submittedAt: new Date().toISOString() } });
  
    const distRunsCol = repository.distributionRuns();
    const distItemsCol = repository.distributionItems();
    const reqCol = repository.weeklyRequests();
    const reqItemsCol = repository.weeklyRequestItems();
  
    const existingDist = await distRunsCol.findOne({ combinedRunId: run.id });
    if (!existingDist) {
      const submittedReq = await reqCol.findOne({ id: run.requestId, status: "SUBMITTED" });
      const reqItems = submittedReq ? await reqItemsCol.find({ requestId: submittedReq.id }).toArray() : [];
      const distRun = {
        id: uuidv4(),
        requestId: run.requestId,
        branchId: submittedReq?.branchId,
        weekStartDate: run.weekStartDate,
        combinedRunId: run.id,
        status: "AWAITING_RECEIPT",
        version: 0,
        createdAt: new Date().toISOString()
      };
      await distRunsCol.insertOne(distRun);
  
      const itemIds = Array.from(new Set(reqItems.map((it) => it.itemId)));
      const inventoryMap = await getCentralInventoryMap(itemIds);
      const purchaseItemMap = new Map(items.map((it) => [it.itemId, it]));
  
      const distItems = [];
      const pendingItems = [];
      if (submittedReq) {
        for (const row of reqItems) {
          const purchaseItem = purchaseItemMap.get(row.itemId);
          const inventoryAvailable = Number(inventoryMap.get(row.itemId) || 0) > 0;
          const receiptDefaultQty = inventoryAvailable ? Number(row.requestedQty || 0) : 0;
          const isPending = purchaseItem?.status === "PAYMENT_PENDING";
          if (isPending && receiptDefaultQty > 0) {
            pendingItems.push({
              name: row.itemName,
              qty: receiptDefaultQty,
              unitPrice: purchaseItem?.unitPrice || row.unitPrice || 0
            });
          }
          distItems.push({
            id: uuidv4(),
            runId: distRun.id,
            requestId: submittedReq.id,
            branchId: submittedReq.branchId,
            itemId: row.itemId,
            itemName: row.itemName,
            categoryName: row.categoryName,
            requestedQty: row.requestedQty,
            approvedQty: receiptDefaultQty,
            receiptDefaultQty,
            deliveredQty: null,
            mismatchReason: receiptDefaultQty === 0 ? "Wasn't available for procurement" : "",
            unitPrice: purchaseItem?.unitPrice || row.unitPrice || 0,
            status: receiptDefaultQty > 0 ? (isPending ? "PAYMENT_PENDING" : "AVAILABLE") : "UNAVAILABLE"
          });
        }
      }
      if (distItems.length) {
        await distItemsCol.insertMany(distItems);
      }
      if (pendingItems.length) {
        const amount = pendingItems.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0), 0);
        const nowIso = new Date().toISOString();
        await expenseTicketsCol.insertOne({
          id: uuidv4(),
          category: "Purchase",
          branchId: submittedReq?.branchId || "",
          assignee: "",
          paymentMethod: "",
          amount: Number(amount || 0),
          date: submittedReq?.weekStartDate || formatDateLocal(new Date(submittedReq?.createdAt || Date.now())),
          attachmentName: "",
          attachmentType: "",
          attachmentData: "",
          items: pendingItems.map((row) => ({
            name: row.name,
            qty: Number(row.qty || 0),
            unitPrice: Number(row.unitPrice || 0)
          })),
          employeeName: "",
          source: "",
          note: "",
          status: "PENDING",
          createdAt: nowIso,
          updatedAt: nowIso
        });
      }
    }
  
    const updatedRun = await runsCol.findOne({ id });
    res.json({ run: updatedRun });
  }
  };
}
