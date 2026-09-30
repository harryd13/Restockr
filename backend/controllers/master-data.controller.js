import { COLLECTIONS } from "../config.js";

export function registerMasterDataRoutesController(app, { repository, authMiddleware }) {
  app.get("/api/branches", authMiddleware, async (req, res) => {
    const list = await repository.branches().find({}).toArray();
    res.json(list);
  });

  app.get("/api/categories", authMiddleware, async (req, res) => {
    const list = await repository.categories().find({}).toArray();
    res.json(list);
  });

  app.get("/api/items", authMiddleware, async (req, res) => {
    const filter = req.query.categoryId ? { categoryId: req.query.categoryId } : {};
    const list = await repository.items().find(filter).toArray();
    res.json(list);
  });
}

