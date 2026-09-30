export function registerExpenseTicketRoutesController({ app, authMiddleware, service }) {
  app.get("/api/expense-tickets", authMiddleware, service.handle1);

  app.post("/api/expense-tickets", authMiddleware, service.handle2);

  app.post("/api/expense-tickets/:id/update", authMiddleware, service.handle3);

  app.post("/api/expense-tickets/:id/partial", authMiddleware, service.handle4);

  app.post("/api/expense-tickets/:id/delete", authMiddleware, service.handle5);

  app.post("/api/expense-tickets/branch", authMiddleware, service.handle6);

  app.get("/api/expense-tickets/logs", authMiddleware, service.handle7);

  app.get("/api/expense-tickets/branch/history", authMiddleware, service.handle8);

  app.post("/api/expense-tickets/branch/:id/update", authMiddleware, service.handle9);

  app.post("/api/expense-tickets/branch/:id/delete", authMiddleware, service.handle10);
}

