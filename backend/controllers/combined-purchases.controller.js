export function registerCombinedPurchaseRoutesController({ app, authMiddleware, service }) {
  app.get("/api/combined-purchase-runs", authMiddleware, service.handle1);

  app.get("/api/combined-purchase-run", authMiddleware, service.handle2);

  app.get("/api/combined-purchase-queue", authMiddleware, service.handle3);

  app.post("/api/combined-purchase-queue/submit", authMiddleware, service.handle4);

  app.get("/api/combined-purchase-logs", authMiddleware, service.handle5);

  app.post("/api/combined-purchase-run/:id/items", authMiddleware, service.handle6);

  app.post("/api/combined-purchase-run/:id/add-item", authMiddleware, service.handle7);

  app.post("/api/combined-purchase-run/:id/submit", authMiddleware, service.handle8);
}

