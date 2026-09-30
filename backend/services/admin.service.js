export function createAdminService(context) {
  const { repository, uuidv4, ensureAdmin } = context;
  return {
    handle1: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const value = !!req.body?.weeklyOverride;
    const settingsCol = repository.settings();
    await settingsCol.updateOne(
      { key: "weeklyOverride" },
      { $set: { key: "weeklyOverride", value, updatedAt: new Date().toISOString(), updatedBy: req.user.id } },
      { upsert: true }
    );
    res.json({ weeklyOverride: value });
  },

    handle2: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const list = await repository.categories().find({}).sort({ name: 1 }).toArray();
    res.json(list);
  },

    handle3: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Name is required" });
    const doc = { id: uuidv4(), name };
    await repository.categories().insertOne(doc);
    res.status(201).json(doc);
  },

    handle4: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Name is required" });
    const result = await repository.categories().findOneAndUpdate(
      { id },
      { $set: { name } },
      { returnDocument: "after" }
    );
    if (!result.value) return res.status(404).json({ message: "Not found" });
    res.json(result.value);
  },

    handle5: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const itemCount = await repository.items().countDocuments({ categoryId: id });
    if (itemCount > 0) {
      return res.status(400).json({ message: "Cannot delete category that has items" });
    }
    await repository.categories().deleteOne({ id });
    res.json({ ok: true });
  },

    handle6: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const list = await repository.items().find({}).sort({ name: 1 }).toArray();
    res.json(list);
  },

    handle7: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { name, categoryId, unit, defaultPrice } = req.body;
    if (!name || !categoryId) return res.status(400).json({ message: "Name and categoryId are required" });
    const cat = await repository.categories().findOne({ id: categoryId });
    if (!cat) return res.status(400).json({ message: "Invalid categoryId" });
    const doc = {
      id: uuidv4(),
      name,
      categoryId,
      unit: unit || "",
      defaultPrice: Number(defaultPrice) || 0
    };
    await repository.items().insertOne(doc);
    res.status(201).json(doc);
  },

    handle8: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const { name, categoryId, unit, defaultPrice } = req.body;
    if (!name || !categoryId) return res.status(400).json({ message: "Name and categoryId are required" });
    const cat = await repository.categories().findOne({ id: categoryId });
    if (!cat) return res.status(400).json({ message: "Invalid categoryId" });
    const result = await repository.items().findOneAndUpdate(
      { id },
      { $set: { name, categoryId, unit: unit || "", defaultPrice: Number(defaultPrice) || 0 } },
      { returnDocument: "after" }
    );
    if (!result.value) return res.status(404).json({ message: "Not found" });
    res.json(result.value);
  },

    handle9: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const usageCount = await repository.weeklyRequestItems().countDocuments({ itemId: id });
    if (usageCount > 0) {
      return res.status(400).json({ message: "Cannot delete item used in requests" });
    }
    await repository.items().deleteOne({ id });
    res.json({ ok: true });
  },

    handle10: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const list = await repository.branches().find({}).sort({ name: 1 }).toArray();
    res.json(list);
  },

    handle11: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { name, code } = req.body;
    if (!name || !code) return res.status(400).json({ message: "Name and code are required" });
    const doc = { id: uuidv4(), name, code };
    await repository.branches().insertOne(doc);
    res.status(201).json(doc);
  },

    handle12: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const { name, code } = req.body;
    if (!name || !code) return res.status(400).json({ message: "Name and code are required" });
    const result = await repository.branches().findOneAndUpdate(
      { id },
      { $set: { name, code } },
      { returnDocument: "after" }
    );
    if (!result.value) return res.status(404).json({ message: "Not found" });
    res.json(result.value);
  },

    handle13: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const userCount = await repository.users().countDocuments({ branchId: id });
    const requestCount = await repository.weeklyRequests().countDocuments({ branchId: id });
    if (userCount > 0 || requestCount > 0) {
      return res.status(400).json({ message: "Cannot delete branch that is in use" });
    }
    await repository.branches().deleteOne({ id });
    res.json({ ok: true });
  },

    handle14: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const list = await repository.users().find({}).sort({ name: 1 }).toArray();
    res.json(list.map(({ password, ...rest }) => rest));
  },

    handle15: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { name, email, password, role, branchId } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ message: "Missing required fields" });
    const existing = await repository.users().findOne({ email });
    if (existing) return res.status(400).json({ message: "Email already exists" });
    const doc = { id: uuidv4(), name, email, password, role, branchId: branchId || null };
    await repository.users().insertOne(doc);
    res.status(201).json({ id: doc.id, name, email, role, branchId: doc.branchId });
  },

    handle16: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const { name, email, password, role, branchId } = req.body;
    if (!name || !email || !role) return res.status(400).json({ message: "Missing required fields" });
    const update = { name, email, role, branchId: branchId || null };
    if (password) update.password = password;
    const existingEmail = await repository.users().findOne({ email, id: { $ne: id } });
    if (existingEmail) return res.status(400).json({ message: "Email already exists" });
    const result = await repository.users().findOneAndUpdate({ id }, { $set: update }, { returnDocument: "after" });
    if (!result.value) return res.status(404).json({ message: "Not found" });
    const { password: _, ...rest } = result.value;
    res.json(rest);
  },

    handle17: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    await repository.users().deleteOne({ id });
    res.json({ ok: true });
  }
  };
}

