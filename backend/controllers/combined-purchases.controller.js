export function registerCombinedPurchaseRoutesController({ app, authMiddleware, service }) {
  app.get("/api/combined-purchase-queue", authMiddleware, service.handle3);

  app.get("/api/combined-purchase-logs", authMiddleware, service.handle5);

  app.get("/api/weekly-purchases", authMiddleware, service.listBranchPurchases);

  app.get("/api/weekly-purchases/:runId", authMiddleware, service.getBranchPurchase);

  app.get("/api/weekly-purchases/:runId/vendor-pdf", authMiddleware, service.getVendorPdfData);

  app.put("/api/weekly-purchases/:runId", authMiddleware, service.updateBranchPurchase);

  app.post("/api/weekly-purchases/:runId/order", authMiddleware, service.orderBranchPurchase);
}
