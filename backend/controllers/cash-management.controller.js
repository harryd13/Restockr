export function registerCashManagementRoutesController({ app, authMiddleware, service }) {
  app.get("/api/cash-management/branch/today", authMiddleware, service.handle1);

  app.post("/api/cash-management/branch", authMiddleware, service.handle2);

  app.get("/api/admin/cash-management/summary", authMiddleware, service.handle3);

  app.get("/api/admin/cash-account-summary", authMiddleware, service.handle4);

  app.post("/api/admin/due-clearances", authMiddleware, service.handle5);

  app.post("/api/admin/cash-management/verify", authMiddleware, service.handle6);

  app.get("/api/admin/cash-reports", authMiddleware, service.handle7);

  app.post("/api/admin/cash-reports/send-previous-day", authMiddleware, service.handle8);
}

