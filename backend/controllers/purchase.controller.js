function respondWithError(res, error) {
  return res.status(error.status || 500).json({ message: error.message || "Unexpected error" });
}

export function registerPurchaseRoutesController({ app, service, authMiddleware, startOfWeek }) {
  const requireOpsOrAdmin = (req, res, next) => {
    if (!['OPS', 'ADMIN'].includes(req.user.role)) return res.status(403).json({ message: "Ops/Admin role required" });
    next();
  };

  app.get("/api/purchase-run", authMiddleware, requireOpsOrAdmin, async (req, res) => {
    try { res.json(await service.getRun(req.query.week || startOfWeek(), req.query.branchId)); }
    catch (error) { respondWithError(res, error); }
  });

  app.post("/api/purchase-run/:id/update-items", authMiddleware, requireOpsOrAdmin, async (req, res) => {
    try { res.json(await service.updateItems(req.params.id, req.body.items || [])); }
    catch (error) { respondWithError(res, error); }
  });

  app.post("/api/purchase-run/:id/finalize", authMiddleware, requireOpsOrAdmin, async (req, res) => {
    try { const result = await service.finalizeRequests([req.params.id]); res.json({ request: result.request }); }
    catch (error) { respondWithError(res, error); }
  });

  app.post("/api/purchase-run/finalize-multi", authMiddleware, requireOpsOrAdmin, async (req, res) => {
    try { res.json(await service.finalizeRequests(req.body.requestIds)); }
    catch (error) { respondWithError(res, error); }
  });
}


