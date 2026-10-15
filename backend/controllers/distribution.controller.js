export function registerDistributionRoutesController(context) {
  const { app, repository, authMiddleware, ensureAdmin, service } = context;

  app.get("/api/distribution-queue", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const runsCol = repository.distributionRuns();
    const itemsCol = repository.distributionItems();
    const reqCol = repository.weeklyRequests();
  
    const runs = await runsCol
      .find({ status: { $in: ["DRAFT", "AWAITING_RECEIPT", "RECEIVED_PENDING_REVIEW"] } })
      .sort({ createdAt: -1 })
      .toArray();
    const runIds = runs.map((r) => r.id);
    const items = runIds.length ? await itemsCol.find({ runId: { $in: runIds } }).toArray() : [];
  
    const reqIds = runs.map((r) => r.requestId).filter(Boolean);
    const reqs = reqIds.length ? await reqCol.find({ id: { $in: reqIds } }).toArray() : [];
    const reqMap = new Map(reqs.map((r) => [r.id, r]));
  
    const normalizedRuns = runs.map((r) => {
      if (!r.branchId && r.requestId) {
        const req = reqMap.get(r.requestId);
        if (req) {
          return { ...r, branchId: req.branchId };
        }
      }
      return r;
    });
  
    res.json({ runs: normalizedRuns, items });
  });
  
  app.put("/api/distribution-run/:id/payments", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try { res.json(await service.updatePayments(req.params.id, req.user, req.body)); }
    catch (error) { res.status(error.status || 500).json({ message: error.message || "Unexpected error", ...(error.details || {}) }); }
  });

  app.post("/api/requests/:id/verify-receipt", authMiddleware, async (req, res) => {
    try { res.json(await service.verifyReceipt(req.params.id, req.user, req.body)); }
    catch (error) { res.status(error.status || 500).json({ message: error.message || "Unexpected error", ...(error.details || {}) }); }
  });

  app.post("/api/distribution-run/:id/close", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try { res.json(await service.closeRun(req.params.id, req.body, req.user)); }
    catch (error) { res.status(error.status || 500).json({ message: error.message || "Unexpected error" }); }
  });

}
