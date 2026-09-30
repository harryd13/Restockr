export function registerDistributionRoutesController(context) {
  const { app, repository, authMiddleware, ensureAdmin, service } = context;

  app.get("/api/distribution-run", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const runId = req.query.runId;
    const runsCol = repository.distributionRuns();
    if (!runId) return res.status(400).json({ message: "runId is required" });
    const run = await runsCol.findOne({ id: runId });
    if (!run) return res.status(404).json({ message: "Distribution run not found" });
    const items = await repository.distributionItems().find({ runId: run.id }).toArray();
    res.json({ run, items });
  });
  
  app.get("/api/distribution-runs", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const runs = await repository.distributionRuns()
      .find({ status: { $in: ["DRAFT", "AWAITING_RECEIPT", "RECEIVED_PENDING_REVIEW"] } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(runs);
  });
  
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
  
  app.post("/api/distribution-run/:id/items", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    res.status(405).json({ message: "Delivery quantities are verified by the branch and cannot be edited by admin" });
  });

  app.post("/api/requests/:id/verify-receipt", authMiddleware, async (req, res) => {
    try { res.json(await service.verifyReceipt(req.params.id, req.user, req.body)); }
    catch (error) { res.status(error.status || 500).json({ message: error.message || "Unexpected error", ...(error.details || {}) }); }
  });

  app.post("/api/distribution-run/:id/close", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try { res.json(await service.closeRun(req.params.id, req.body.items, req.user)); }
    catch (error) { res.status(error.status || 500).json({ message: error.message || "Unexpected error" }); }
  });

  app.post("/api/distribution-run/:id/finalize", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    res.status(410).json({ message: "Use Close Distribution after branch receipt verification" });
  });
  app.post("/api/distribution-run/finalize-multi", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    res.status(410).json({ message: "Distributions must be closed individually after branch receipt verification" });
  });
}

