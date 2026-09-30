export function registerTicketRoutesController({ app, authMiddleware, service }) {
  app.get("/api/tickets", authMiddleware, service.handle1);

  app.post("/api/tickets/:id/delete", authMiddleware, service.handle2);

  app.post("/api/tickets/:id/done", authMiddleware, service.handle3);

  app.post("/api/tickets/:id/partial", authMiddleware, service.handle4);

  app.get("/api/tickets/expenses", authMiddleware, service.handle5);
}

