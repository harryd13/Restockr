export function registerAdminRoutesController({ app, authMiddleware, service }) {
  app.post("/api/admin/settings/weekly-override", authMiddleware, service.handle1);

  app.get("/api/admin/categories", authMiddleware, service.handle2);

  app.post("/api/admin/categories", authMiddleware, service.handle3);

  app.put("/api/admin/categories/:id", authMiddleware, service.handle4);

  app.delete("/api/admin/categories/:id", authMiddleware, service.handle5);

  app.get("/api/admin/items", authMiddleware, service.handle6);

  app.post("/api/admin/items", authMiddleware, service.handle7);

  app.put("/api/admin/items/:id", authMiddleware, service.handle8);

  app.delete("/api/admin/items/:id", authMiddleware, service.handle9);

  app.get("/api/admin/branches", authMiddleware, service.handle10);

  app.post("/api/admin/branches", authMiddleware, service.handle11);

  app.put("/api/admin/branches/:id", authMiddleware, service.handle12);

  app.delete("/api/admin/branches/:id", authMiddleware, service.handle13);

  app.get("/api/admin/users", authMiddleware, service.handle14);

  app.post("/api/admin/users", authMiddleware, service.handle15);

  app.put("/api/admin/users/:id", authMiddleware, service.handle16);

  app.delete("/api/admin/users/:id", authMiddleware, service.handle17);
}

