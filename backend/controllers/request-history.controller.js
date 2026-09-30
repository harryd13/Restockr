export function registerRequestHistoryRoutesController(context) {
  const { app, repository, authMiddleware } = context;

  app.get("/api/requests/history", authMiddleware, async (req, res) => {
    if (req.user.role !== "BRANCH") {
      return res.status(403).json({ message: "Branch role required" });
    }
    const branchId = req.user.branchId;
    const requestsCol = repository.weeklyRequests();
    const itemsCol = repository.weeklyRequestItems();
  
    const list = await requestsCol
      .find({ branchId, status: { $ne: "DRAFT" } })
      .sort({ createdAt: -1, updatedAt: -1 })
      .toArray();
  
    const reqIds = list.map((r) => r.id);
    const items = await itemsCol.find({ requestId: { $in: reqIds } }).toArray();
    const totalMap = new Map();
    for (const it of items) {
      totalMap.set(it.requestId, (totalMap.get(it.requestId) || 0) + (it.totalPrice || 0));
    }
  
    const formatted = list
      .map((r) => ({
        id: r.id,
        weekStartDate: r.weekStartDate,
        status: r.status,
        total: totalMap.get(r.id) || 0,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      }))
      .sort((a, b) => new Date(b.createdAt || b.updatedAt) - new Date(a.createdAt || a.updatedAt))
      .map(({ createdAt, updatedAt, ...rest }) => rest);
  
    res.json(formatted);
  });
  
  app.get("/api/requests/history/:id/items", authMiddleware, async (req, res) => {
    if (req.user.role !== "BRANCH") {
      return res.status(403).json({ message: "Branch role required" });
    }
    const { id } = req.params;
    const requestsCol = repository.weeklyRequests();
    const itemsCol = repository.weeklyRequestItems();
    const distRunsCol = repository.distributionRuns();
    const distItemsCol = repository.distributionItems();
  
    const reqObj = await requestsCol.findOne({ id, branchId: req.user.branchId });
    if (!reqObj) return res.status(404).json({ message: "Request not found" });
  
    const items = await itemsCol.find({ requestId: id }).toArray();
    const distributionRun = await distRunsCol.findOne({ requestId: id });
    const distItems = await distItemsCol.find({ requestId: id, branchId: req.user.branchId }).toArray();
    const distMap = new Map(distItems.map((row) => [row.itemId, row]));
    const receiptVerified = ["RECEIVED_PENDING_REVIEW", "FINALIZED"].includes(distributionRun?.status);
  
    const result = items.map((row) => {
      const distRow = distMap.get(row.itemId);
      const approvedQty = Number(distRow?.receiptDefaultQty ?? distRow?.approvedQty ?? 0);
      const deliveredQty = receiptVerified ? Number(distRow?.deliveredQty ?? distRow?.approvedQty ?? 0) : null;
      return {
        itemId: row.itemId,
        itemName: row.itemName,
        categoryName: row.categoryName,
        requestedQty: row.requestedQty,
        approvedQty,
        deliveredQty,
        mismatchReason: distRow?.mismatchReason || "",
        unitPrice: row.unitPrice || 0,
        status: distRow?.status || row.status || "AVAILABLE"
      };
    });
  
    res.json({
      status: reqObj.status,
      distributionStatus: distributionRun?.status || "",
      distributionVersion: Number(distributionRun?.version || 0),
      canVerifyReceipt: distributionRun?.status === "AWAITING_RECEIPT" || distributionRun?.status === "DRAFT",
      receiptVerified,
      items: result
    });
  });
}



