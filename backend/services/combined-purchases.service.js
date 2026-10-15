import { upsertWeeklyCentralPurchaseLog } from "./weekly-summary.service.js";

export function createCombinedPurchasesService(context) {
  const { repository, uuidv4, ensureAdmin, formatDateLocal, getCurrentDateInIST, parseStartDate, startOfWeek, getClient, getCentralInventoryMap, upsertCentralInventory, reserveInventory, releaseInventory } = context;

  async function buildBranchPurchase(run, { session } = {}) {
    const request = await repository.weeklyRequests().findOne({ id: run.requestId }, { session });
    if (!request) return null;
    const [requestItems, purchaseItems, branch] = await Promise.all([
      repository.weeklyRequestItems().find({ requestId: request.id }, { session }).toArray(),
      repository.combinedPurchaseItems().find({ runId: run.id }, { session }).toArray(),
      repository.branches().findOne({ id: run.branchId || request.branchId }, { session })
    ]);
    const itemIds = requestItems.map((item) => item.itemId);
    const inventoryRows = itemIds.length
      ? await repository.centralInventory().find({ itemId: { $in: itemIds } }, { session }).toArray()
      : [];
    const inventoryByItemId = new Map(inventoryRows.map((item) => [item.itemId, item]));
    const purchaseByItemId = new Map(purchaseItems.map((item) => [item.itemId, item]));
    const items = requestItems.map((item) => {
      const purchase = purchaseByItemId.get(item.itemId);
      const requestedQty = Number(item.requestedQty || 0);
      const centralReservedQty = Number(item.centralReservedQty || 0);
      const purchaseRequiredQty = Math.max(0, requestedQty - centralReservedQty);
      const inventory = inventoryByItemId.get(item.itemId);
      const availableCentralQty = Math.max(0, Number(inventory?.onHand || 0) - Number(inventory?.reserved || 0));
      return {
        id: purchase?.id || item.id,
        requestItemId: item.id,
        itemId: item.itemId,
        itemName: item.itemName,
        categoryName: item.categoryName,
        requestedQty,
        centralReservedQty,
        availableCentralQty,
        maxCentralQty: Math.min(requestedQty, centralReservedQty + availableCentralQty),
        purchaseRequiredQty,
        orderQty: Number(purchase?.orderQty ?? purchase?.approvedQty ?? purchaseRequiredQty),
        estimatedUnitPrice: Number(purchase?.estimatedUnitPrice ?? purchase?.unitPrice ?? item.unitPrice ?? 0),
        includeInPdf: purchase?.includeInPdf !== false,
        status: purchase?.status || "AVAILABLE"
      };
    });
    return {
      run: { ...run, version: Number(run.version || 0) },
      branch: branch ? { id: branch.id, name: branch.name } : { id: run.branchId || request.branchId, name: run.branchId || request.branchId },
      request: { id: request.id, status: request.status, weekStartDate: request.weekStartDate, submittedAt: request.submittedAt || request.createdAt },
      items
    };
  }

  function sendServiceError(res, error) {
    if (error?.code === 11000) return res.status(409).json({ message: "This purchase was updated concurrently. Reload and try again." });
    return res.status(error?.status || 500).json({ message: error?.message || "Unexpected error" });
  }

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
        const centralReservedQty = Number(row.centralReservedQty || 0);
        const inventoryAvailable = Number(inventoryMap.get(row.itemId) || 0) > 0;
        const purchaseAvailable = purchaseItem && purchaseItem.status !== "UNAVAILABLE";
        const receiptDefaultQty = purchaseAvailable && inventoryAvailable
          ? Number(row.requestedQty || 0)
          : centralReservedQty;
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
          centralReservedQty,
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
          const centralReservedQty = Number(row.centralReservedQty || 0);
          const inventoryAvailable = Number(inventoryMap.get(row.itemId) || 0) > 0;
          const purchaseAvailable = purchaseItem && purchaseItem.status !== "UNAVAILABLE";
          const receiptDefaultQty = purchaseAvailable && inventoryAvailable
            ? Number(row.requestedQty || 0)
            : centralReservedQty;
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
            centralReservedQty,
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
  },

    listBranchPurchases: async (req, res) => {
      if (!ensureAdmin(req, res)) return;
      try {
        const weekStartDate = String(req.query.week || startOfWeek()).trim();
        const statuses = String(req.query.status || "DRAFT").split(",").map((value) => value.trim()).filter(Boolean);
        const runs = await repository.combinedPurchaseRuns()
          .find({ weekStartDate, status: { $in: statuses } })
          .sort({ createdAt: 1 })
          .toArray();
        const sections = (await Promise.all(runs.map((run) => buildBranchPurchase(run)))).filter(Boolean);
        res.json({ weekStartDate, sections });
      } catch (error) {
        sendServiceError(res, error);
      }
    },

    getBranchPurchase: async (req, res) => {
      if (!ensureAdmin(req, res)) return;
      try {
        const run = await repository.combinedPurchaseRuns().findOne({ id: req.params.runId });
        if (!run) return res.status(404).json({ message: "Branch purchase not found" });
        const section = await buildBranchPurchase(run);
        if (!section) return res.status(404).json({ message: "Weekly request not found" });
        res.json(section);
      } catch (error) {
        sendServiceError(res, error);
      }
    },

    getVendorPdfData: async (req, res) => {
      if (!ensureAdmin(req, res)) return;
      try {
        const run = await repository.combinedPurchaseRuns().findOne({ id: req.params.runId });
        if (!run) return res.status(404).json({ message: "Branch purchase not found" });
        if (run.status !== "DRAFT") {
          return res.status(400).json({ message: "Vendor PDF is only available while the branch purchase is in draft" });
        }
        const section = await buildBranchPurchase(run);
        if (!section) return res.status(404).json({ message: "Weekly request not found" });
        const items = section.items
          .filter((item) => item.includeInPdf !== false && Number(item.orderQty || 0) > 0)
          .map((item) => ({ itemName: item.itemName, orderQty: Number(item.orderQty || 0) }));
        if (!items.length) {
          return res.status(400).json({ message: "Select at least one item with an order quantity greater than zero" });
        }
        res.json({
          purchaseRunId: run.id,
          revision: Number(run.version || 0),
          branch: section.branch,
          weekStartDate: section.request.weekStartDate,
          generatedAt: new Date().toISOString(),
          items
        });
      } catch (error) {
        sendServiceError(res, error);
      }
    },

    updateBranchPurchase: async (req, res) => {
      if (!ensureAdmin(req, res)) return;
      const bodyItems = req.body?.items;
      const expectedVersion = Number(req.body?.version);
      if (!Array.isArray(bodyItems)) return res.status(400).json({ message: "items array is required" });
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return res.status(400).json({ message: "A valid version is required" });

      const session = getClient().startSession();
      let updatedRun;
      try {
        await session.withTransaction(async () => {
          const run = await repository.combinedPurchaseRuns().findOne({ id: req.params.runId }, { session });
          if (!run) throw Object.assign(new Error("Branch purchase not found"), { status: 404 });
          if (run.status !== "DRAFT") throw Object.assign(new Error("Only draft branch purchases can be edited"), { status: 400 });
          if (Number(run.version || 0) !== expectedVersion) {
            throw Object.assign(new Error("This purchase changed elsewhere. Reload and try again."), { status: 409 });
          }

          const requestItems = await repository.weeklyRequestItems().find({ requestId: run.requestId }, { session }).toArray();
          const requestByItemId = new Map(requestItems.map((item) => [item.itemId, item]));
          const incomingByItemId = new Map();
          for (const item of bodyItems) {
            if (!item?.itemId || incomingByItemId.has(item.itemId)) {
              throw Object.assign(new Error("Each request item must appear exactly once"), { status: 400 });
            }
            incomingByItemId.set(item.itemId, item);
          }
          if (incomingByItemId.size !== requestByItemId.size || requestItems.some((item) => !incomingByItemId.has(item.itemId))) {
            throw Object.assign(new Error("Every request item must be included"), { status: 400 });
          }

          const nowIso = new Date().toISOString();
          for (const requestItem of requestItems) {
            const incoming = incomingByItemId.get(requestItem.itemId);
            const requestedQty = Number(requestItem.requestedQty || 0);
            const centralReservedQty = Number(incoming.centralReservedQty);
            const orderQty = Number(incoming.orderQty);
            const estimatedUnitPrice = Number(incoming.estimatedUnitPrice);
            if (!Number.isFinite(centralReservedQty) || centralReservedQty < 0 || centralReservedQty > requestedQty) {
              throw Object.assign(new Error(`${requestItem.itemName}: central quantity must be between 0 and ${requestedQty}`), { status: 400 });
            }
            if (!Number.isFinite(orderQty) || orderQty < 0) {
              throw Object.assign(new Error(`${requestItem.itemName}: order quantity must be zero or greater`), { status: 400 });
            }
            if (!Number.isFinite(estimatedUnitPrice) || estimatedUnitPrice < 0) {
              throw Object.assign(new Error(`${requestItem.itemName}: estimated MRP must be zero or greater`), { status: 400 });
            }

            const previousCentralQty = Number(requestItem.centralReservedQty || 0);
            const reservationDelta = centralReservedQty - previousCentralQty;
            if (reservationDelta > 0) {
              const allocated = await reserveInventory(requestItem.itemId, reservationDelta, { session });
              if (allocated !== reservationDelta) {
                throw Object.assign(new Error(`${requestItem.itemName}: only ${allocated} additional units are available centrally`), { status: 409 });
              }
            } else if (reservationDelta < 0) {
              const released = await releaseInventory(requestItem.itemId, Math.abs(reservationDelta), { session });
              if (released !== Math.abs(reservationDelta)) {
                throw Object.assign(new Error(`${requestItem.itemName}: saved reservation no longer matches central inventory`), { status: 409 });
              }
            }

            const purchaseRequiredQty = Math.max(0, requestedQty - centralReservedQty);
            await repository.weeklyRequestItems().updateOne(
              { id: requestItem.id, requestId: run.requestId },
              { $set: { centralReservedQty, purchaseRequiredQty } },
              { session }
            );
            const existingPurchase = await repository.combinedPurchaseItems().findOne({ runId: run.id, itemId: requestItem.itemId }, { session });
            const purchaseDoc = {
              runId: run.id,
              itemId: requestItem.itemId,
              itemName: requestItem.itemName,
              categoryName: requestItem.categoryName,
              requestedQty,
              centralReservedQty,
              purchaseRequiredQty,
              requestedTotal: purchaseRequiredQty,
              orderQty,
              approvedQty: orderQty,
              estimatedUnitPrice,
              unitPrice: estimatedUnitPrice,
              includeInPdf: incoming.includeInPdf !== false,
              status: existingPurchase?.status || "AVAILABLE",
              manual: true,
              updatedAt: nowIso
            };
            await repository.combinedPurchaseItems().updateOne(
              existingPurchase ? { id: existingPurchase.id, runId: run.id } : { runId: run.id, itemId: requestItem.itemId },
              { $set: purchaseDoc, $setOnInsert: { id: uuidv4(), createdAt: nowIso } },
              { upsert: true, session }
            );
          }

          const runResult = await repository.combinedPurchaseRuns().updateOne(
            { id: run.id, status: "DRAFT", $or: [{ version: expectedVersion }, ...(expectedVersion === 0 ? [{ version: { $exists: false } }] : [])] },
            { $set: { updatedAt: nowIso }, $inc: { version: 1 } },
            { session }
          );
          if (runResult.modifiedCount !== 1) {
            throw Object.assign(new Error("This purchase changed elsewhere. Reload and try again."), { status: 409 });
          }
          updatedRun = { ...run, version: expectedVersion + 1, updatedAt: nowIso };
        });
        res.json(await buildBranchPurchase(updatedRun));
      } catch (error) {
        sendServiceError(res, error);
      } finally {
        await session.endSession();
      }
    },

    orderBranchPurchase: async (req, res) => {
      if (!ensureAdmin(req, res)) return;
      const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
      const expectedVersion = Number(req.body?.version);
      if (!idempotencyKey) return res.status(400).json({ message: "idempotencyKey is required" });
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
        return res.status(400).json({ message: "A valid version is required" });
      }

      const session = getClient().startSession();
      let response;
      try {
        await session.withTransaction(async () => {
          const orderLogs = repository.weeklyPurchaseOrderLogs();
          const existingByKey = await orderLogs.findOne({ idempotencyKey }, { session });
          if (existingByKey) {
            if (existingByKey.purchaseRunId !== req.params.runId) {
              throw Object.assign(new Error("Idempotency key has already been used"), { status: 409 });
            }
            response = { ok: true, replayed: true, order: existingByKey };
            return;
          }

          const run = await repository.combinedPurchaseRuns().findOne({ id: req.params.runId }, { session });
          if (!run) throw Object.assign(new Error("Branch purchase not found"), { status: 404 });
          const existingOrder = await orderLogs.findOne({ purchaseRunId: run.id }, { session });
          if (existingOrder) {
            response = { ok: true, replayed: true, order: existingOrder };
            return;
          }
          if (run.status !== "DRAFT") {
            throw Object.assign(new Error("Only a draft branch purchase can be ordered"), { status: 400 });
          }
          if (Number(run.version || 0) !== expectedVersion) {
            throw Object.assign(new Error("This purchase changed elsewhere. Reload and try again."), { status: 409 });
          }

          const request = await repository.weeklyRequests().findOne({ id: run.requestId }, { session });
          if (!request || request.status !== "SUBMITTED") {
            throw Object.assign(new Error("Weekly request is not ready to be ordered"), { status: 400 });
          }
          const requestItems = await repository.weeklyRequestItems().find({ requestId: request.id }, { session }).toArray();
          const purchaseItems = await repository.combinedPurchaseItems().find({ runId: run.id }, { session }).toArray();
          const purchaseByItemId = new Map(purchaseItems.map((item) => [item.itemId, item]));
          if (!requestItems.length) throw Object.assign(new Error("Branch purchase has no items"), { status: 400 });

          const nowIso = new Date().toISOString();
          const orderItems = requestItems.map((requestItem) => {
            const purchaseItem = purchaseByItemId.get(requestItem.itemId) || {};
            const requestedQty = Number(requestItem.requestedQty || 0);
            const centralReservedQty = Number(requestItem.centralReservedQty || 0);
            const purchaseRequiredQty = Math.max(0, requestedQty - centralReservedQty);
            const orderQty = Number(purchaseItem.orderQty ?? purchaseItem.approvedQty ?? purchaseRequiredQty);
            const estimatedUnitPrice = Number(purchaseItem.estimatedUnitPrice ?? purchaseItem.unitPrice ?? requestItem.unitPrice ?? 0);
            if (!Number.isFinite(orderQty) || orderQty < 0 || !Number.isFinite(estimatedUnitPrice) || estimatedUnitPrice < 0) {
              throw Object.assign(new Error(`${requestItem.itemName}: invalid order quantity or estimated MRP`), { status: 400 });
            }
            return {
              itemId: requestItem.itemId,
              itemName: requestItem.itemName,
              categoryName: requestItem.categoryName,
              requestedQty,
              centralReservedQty,
              purchaseRequiredQty,
              orderQty,
              expectedQty: requestedQty,
              estimatedUnitPrice,
              includeInPdf: purchaseItem.includeInPdf !== false
            };
          });
          const orderLog = {
            id: uuidv4(),
            idempotencyKey,
            purchaseRunId: run.id,
            requestId: request.id,
            branchId: request.branchId,
            weekStartDate: request.weekStartDate,
            revision: expectedVersion,
            status: "ORDERED",
            orderedAt: nowIso,
            orderedBy: req.user?.id || "",
            estimatedTotal: orderItems.reduce((sum, item) => sum + item.orderQty * item.estimatedUnitPrice, 0),
            items: orderItems
          };
          await orderLogs.insertOne(orderLog, { session });

          let distributionRun = await repository.distributionRuns().findOne({ requestId: request.id }, { session });
          if (!distributionRun) {
            distributionRun = {
              id: uuidv4(),
              requestId: request.id,
              branchId: request.branchId,
              weekStartDate: request.weekStartDate,
              combinedRunId: run.id,
              orderLogId: orderLog.id,
              status: "AWAITING_RECEIPT",
              version: 0,
              createdAt: nowIso
            };
            await repository.distributionRuns().insertOne(distributionRun, { session });
            const distributionItems = orderItems.map((item) => ({
              id: uuidv4(),
              runId: distributionRun.id,
              requestId: request.id,
              branchId: request.branchId,
              itemId: item.itemId,
              itemName: item.itemName,
              categoryName: item.categoryName,
              requestedQty: item.requestedQty,
              centralReservedQty: item.centralReservedQty,
              orderedQty: item.orderQty,
              actualPurchaseQty: item.orderQty,
              expectedQty: item.requestedQty,
              approvedQty: item.requestedQty,
              receiptDefaultQty: item.requestedQty,
              deliveredQty: null,
              estimatedUnitPrice: item.estimatedUnitPrice,
              unitPrice: item.estimatedUnitPrice,
              paymentStatus: item.orderQty > 0 ? "NOT_RECORDED" : "NOT_APPLICABLE",
              mismatchReason: "",
              status: item.requestedQty > 0 ? "AVAILABLE" : "UNAVAILABLE"
            }));
            if (distributionItems.length) {
              await repository.distributionItems().insertMany(distributionItems, { session });
            }
          }

          const runResult = await repository.combinedPurchaseRuns().updateOne(
            { id: run.id, status: "DRAFT", $or: [{ version: expectedVersion }, ...(expectedVersion === 0 ? [{ version: { $exists: false } }] : [])] },
            { $set: { status: "ORDERED", orderedAt: nowIso, orderedBy: req.user?.id || "", orderLogId: orderLog.id, updatedAt: nowIso }, $inc: { version: 1 } },
            { session }
          );
          if (runResult.modifiedCount !== 1) {
            throw Object.assign(new Error("This purchase changed elsewhere. Reload and try again."), { status: 409 });
          }
          await repository.weeklyRequests().updateOne(
            { id: request.id, status: "SUBMITTED" },
            { $set: { status: "AWAITING_RECEIPT", updatedAt: nowIso } },
            { session }
          );
          const centralItems = orderItems.map((item) => ({
            itemId: item.itemId,
            itemName: item.itemName,
            orderedQty: item.orderQty,
            actualPurchaseQty: item.orderQty,
            orderedEstimatedUnitPrice: item.estimatedUnitPrice,
            finalUnitPrice: item.estimatedUnitPrice,
            purchaseAmount: Number((item.orderQty * item.estimatedUnitPrice).toFixed(2)),
            paymentStatus: item.orderQty > 0 ? "NOT_RECORDED" : "NOT_APPLICABLE",
            paymentMethod: ""
          }));
          await upsertWeeklyCentralPurchaseLog(repository.weeklyCentralPurchaseLogs(), request.weekStartDate, {
            branchId: request.branchId,
            requestId: request.id,
            requestCreatedAt: request.createdAt || request.submittedAt || "",
            purchaseRunId: run.id,
            distributionRunId: distributionRun.id,
            orderLogId: orderLog.id,
            status: "ORDERED",
            distributionStatus: distributionRun.status,
            orderedAt: nowIso,
            orderedQty: centralItems.reduce((sum, item) => sum + item.orderedQty, 0),
            purchasedQty: centralItems.reduce((sum, item) => sum + item.actualPurchaseQty, 0),
            purchaseAmount: centralItems.reduce((sum, item) => sum + item.purchaseAmount, 0),
            paidAmount: 0,
            pendingAmount: 0,
            cashPaid: 0,
            upiPaid: 0,
            items: centralItems
          }, { session });
          response = { ok: true, replayed: false, order: orderLog, distributionRunId: distributionRun.id };
        });
        res.json(response);
      } catch (error) {
        if (error?.code === 11000) {
          const existing = await repository.weeklyPurchaseOrderLogs().findOne({ purchaseRunId: req.params.runId });
          if (existing) return res.json({ ok: true, replayed: true, order: existing });
        }
        sendServiceError(res, error);
      } finally {
        await session.endSession();
      }
    }
  };
}
