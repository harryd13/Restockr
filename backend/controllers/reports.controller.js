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
}

