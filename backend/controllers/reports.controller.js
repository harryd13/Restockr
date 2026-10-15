import { COLLECTIONS } from "../config.js";
import { parseStartDate } from "../utils/dates.js";

export function registerReportRoutesController(app, { repository, authMiddleware }) {
  const requireOpsOrAdmin = (req, res, next) => {
    if (req.user.role !== "ADMIN" && req.user.role !== "OPS") {
      return res.status(403).json({ message: "Ops/Admin required" });
    }
    next();
  };

  app.get("/api/reports/branch-trend", authMiddleware, requireOpsOrAdmin, async (req, res) => {
    const { branchId } = req.query;
    const requestsCol = repository.weeklyRequests();
    const itemsCol = repository.weeklyRequestItems();
    const relevantReqs = await requestsCol.find(branchId ? { branchId } : {}).toArray();
    const reqIds = relevantReqs.map((request) => request.id);
    const items = reqIds.length ? await itemsCol.find({ requestId: { $in: reqIds } }).toArray() : [];
    const totalMap = new Map();
    for (const item of items) {
      totalMap.set(item.requestId, (totalMap.get(item.requestId) || 0) + (item.totalPrice || 0));
    }
    res.json(relevantReqs.map((request) => ({
      weekStartDate: request.weekStartDate,
      branchId: request.branchId,
      total: totalMap.get(request.id) || 0
    })));
  });

  app.get("/api/reports/purchase-logs", authMiddleware, requireOpsOrAdmin, async (req, res) => {
    const startDate = parseStartDate(req.query.startDate);
    const filter = startDate ? { createdAt: { $gte: startDate } } : {};
    const list = await repository.purchaseLogs().find(filter).sort({ createdAt: -1 }).toArray();
    res.json(list);
  });

  app.get("/api/reports/weekly-central-purchases", authMiddleware, requireOpsOrAdmin, async (req, res) => {
    const startDate = parseStartDate(req.query.startDate);
    const filter = startDate ? { updatedAt: { $gte: startDate } } : {};
    res.json(await repository.weeklyCentralPurchaseLogs().find(filter).sort({ weekStartDate: -1 }).toArray());
  });

  app.get("/api/reports/weekly-distributions", authMiddleware, requireOpsOrAdmin, async (req, res) => {
    const startDate = parseStartDate(req.query.startDate);
    const filter = startDate ? { updatedAt: { $gte: startDate } } : {};
    res.json(await repository.weeklyDistributionLogs().find(filter).sort({ weekStartDate: -1 }).toArray());
  });

  app.get("/api/reports/weekly-purchase-transactions", authMiddleware, requireOpsOrAdmin, async (req, res) => {
    const startDate = parseStartDate(req.query.startDate);
    const filter = {
      distributionRunId: { $type: "string" },
      sourceType: { $in: ["WEEKLY_PURCHASE_PAYMENT", "PENDING_SETTLEMENT"] },
      status: { $ne: "DELETED" },
      ...(startDate ? { createdAt: { $gte: startDate } } : {})
    };
    const transactions = await repository.expenseTicketLogs().find(filter).sort({ paidAt: -1, createdAt: -1 }).toArray();
    const runIds = [...new Set(transactions.map((entry) => entry.distributionRunId).filter(Boolean))];
    const runs = runIds.length
      ? await repository.distributionRuns().find({ id: { $in: runIds } }).toArray()
      : [];
    const runMap = new Map(runs.map((run) => [run.id, run]));
    res.json(transactions.map((entry) => ({
      ...entry,
      weekStartDate: runMap.get(entry.distributionRunId)?.weekStartDate || "",
      requestId: runMap.get(entry.distributionRunId)?.requestId || entry.requestId || ""
    })));
  });

  app.get("/api/reports/weekly-order-audit", authMiddleware, requireOpsOrAdmin, async (req, res) => {
    const startDate = parseStartDate(req.query.startDate);
    const branchId = String(req.query.branchId || "").trim();
    const runFilter = branchId ? { branchId } : {};
    const runs = await repository.distributionRuns().find(runFilter).sort({ createdAt: -1 }).toArray();
    const runIds = runs.map((run) => run.id);
    const requestIds = runs.map((run) => run.requestId).filter(Boolean);
    if (!runIds.length) return res.json([]);

    const [requests, items, receipts, orders, commitments, tickets, payments, mismatches] = await Promise.all([
      repository.weeklyRequests().find({ id: { $in: requestIds } }).toArray(),
      repository.distributionItems().find({ runId: { $in: runIds } }).toArray(),
      repository.distributionReceipts().find({ runId: { $in: runIds } }).toArray(),
      repository.weeklyPurchaseOrderLogs().find({ requestId: { $in: requestIds } }).toArray(),
      repository.inventoryCommitmentLogs().find({ distributionRunId: { $in: runIds } }).toArray(),
      repository.expenseTickets().find({ distributionRunId: { $in: runIds }, sourceType: "WEEKLY_PURCHASE" }).toArray(),
      repository.expenseTicketLogs().find({ distributionRunId: { $in: runIds } }).toArray(),
      repository.unfulfilledLogs().find({ distributionRunId: { $in: runIds } }).toArray()
    ]);

    const byKey = (list, key) => new Map(list.map((row) => [row[key], row]));
    const requestMap = byKey(requests, "id");
    const receiptMap = byKey(receipts, "runId");
    const orderMap = byKey(orders, "requestId");
    const commitmentMap = byKey(commitments, "distributionRunId");
    const ticketMap = byKey(tickets, "distributionRunId");
    const groupByRun = (list) => {
      const map = new Map();
      list.forEach((row) => {
        const runId = row.distributionRunId || row.runId;
        if (!map.has(runId)) map.set(runId, []);
        map.get(runId).push(row);
      });
      return map;
    };
    const itemMap = groupByRun(items);
    const paymentMap = groupByRun(payments);
    const mismatchMap = groupByRun(mismatches);

    const result = runs.map((run) => {
      const request = requestMap.get(run.requestId) || {};
      const receipt = receiptMap.get(run.id) || null;
      const order = orderMap.get(run.requestId) || null;
      const commitment = commitmentMap.get(run.id) || null;
      const pendingTicket = ticketMap.get(run.id) || null;
      const paymentEntries = paymentMap.get(run.id) || [];
      const mismatchEntries = mismatchMap.get(run.id) || [];
      const runItems = itemMap.get(run.id) || [];
      const orderedItemMap = new Map((order?.items || []).map((item) => [item.itemId, item]));
      const events = [
        request.submittedAt && { type: "REQUEST_SUBMITTED", at: request.submittedAt, by: request.submittedBy || "" },
        order?.orderedAt && { type: "ORDERED", at: order.orderedAt, by: order.orderedBy || "" },
        receipt?.verifiedAt && { type: "RECEIPT_VERIFIED", at: receipt.verifiedAt, by: receipt.verifiedBy || "" },
        ...paymentEntries.map((entry) => ({ type: "PAYMENT_RECORDED", at: entry.paidAt || entry.createdAt, by: entry.createdBy || entry.assignee || "", amount: Number(entry.amount || 0), paymentMethod: entry.paymentMethod || "" })),
        commitment?.committedAt && { type: "INVENTORY_COMMITTED", at: commitment.committedAt, by: commitment.committedBy || "" },
        run.finalizedAt && { type: "DISTRIBUTION_CLOSED", at: run.finalizedAt, by: run.finalizedBy || "" }
      ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at));
      return {
        id: run.id,
        distributionRunId: run.id,
        requestId: run.requestId,
        branchId: run.branchId || request.branchId || "",
        weekStartDate: run.weekStartDate || request.weekStartDate || "",
        status: run.status,
        requestStatus: request.status || "",
        createdAt: run.createdAt,
        orderedAt: order?.orderedAt || "",
        receivedAt: receipt?.verifiedAt || run.receivedAt || "",
        finalizedAt: run.finalizedAt || "",
        order: order ? { id: order.id, estimatedTotal: Number(order.estimatedTotal || 0), orderedBy: order.orderedBy || "" } : null,
        pendingTicket: pendingTicket ? { id: pendingTicket.id, status: pendingTicket.status, amount: Number(pendingTicket.amount || 0) } : null,
        payments: { total: paymentEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0), entries: paymentEntries },
        inventory: commitment ? {
          id: commitment.id,
          centralCommittedQty: Number(commitment.totalCentralCommittedQty || 0),
          centralReleasedQty: Number(commitment.totalCentralReleasedQty || 0),
          purchasedDeliveredQty: Number(commitment.totalPurchasedDeliveredQty || 0),
          purchasedSurplusQty: Number(commitment.totalPurchasedSurplusQty || 0)
        } : null,
        mismatchCount: mismatchEntries.length,
        mismatches: mismatchEntries,
        items: runItems.map((item) => ({
          id: item.id,
          itemId: item.itemId,
          itemName: item.itemName,
          requestedQty: Number(item.requestedQty || 0),
          centralReservedQty: Number(item.centralReservedQty || 0),
          orderedQty: Number(item.orderedQty || 0),
          actualPurchaseQty: Number(item.actualPurchaseQty ?? item.orderedQty ?? 0),
          orderedEstimatedUnitPrice: Number(orderedItemMap.get(item.itemId)?.estimatedUnitPrice || 0),
          finalUnitPrice: Number(item.estimatedUnitPrice ?? item.unitPrice ?? 0),
          branchReportedQty: item.branchReportedQty == null ? null : Number(item.branchReportedQty),
          finalDeliveredQty: item.deliveredQty == null ? null : Number(item.deliveredQty),
          centralCommittedQty: Number(item.centralCommittedQty || 0),
          centralReleasedQty: Number(item.centralReleasedQty || 0),
          purchasedDeliveredQty: Number(item.purchasedDeliveredQty || 0),
          purchasedSurplusQty: Number(item.purchasedSurplusQty || 0),
          paymentStatus: item.paymentStatus || "NOT_APPLICABLE",
          paymentMethod: item.paymentMethod || "",
          mismatchReason: item.mismatchReason || "",
          adminAdjusted: !!item.adminAdjusted
        })),
        events
      };
    }).filter((row) => !startDate || [row.createdAt, row.orderedAt, row.receivedAt, row.finalizedAt].some((value) => value && value >= startDate));

    res.json(result);
  });
}
