export function registerInventoryRoutesController(context) {
  const { app, repository, uuidv4, authMiddleware, ensureAdmin, parseStartDate } = context;

  // --- Central Inventory / Combined Purchase / Distribution ---
  app.get("/api/central-inventory", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const inventoryCol = repository.centralInventory();
    const itemsCol = repository.items();
    const categoriesCol = repository.categories();
  
    const inventory = await inventoryCol.find({ onHand: { $gt: 0 } }).toArray();
    const itemIds = inventory.map((row) => row.itemId);
    const masterItems = itemIds.length ? await itemsCol.find({ id: { $in: itemIds } }).toArray() : [];
    const categories = await categoriesCol.find({}).toArray();
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
    const itemMap = new Map(masterItems.map((it) => [it.id, it]));
  
    const rows = inventory.map((row) => {
        const item = itemMap.get(row.itemId);
        const unitPrice = item?.defaultPrice || 0;
        return {
          itemId: row.itemId,
          onHand: Number(row.onHand || 0),
          itemName: item?.name || row.itemId,
          categoryName: item ? categoryMap.get(item.categoryId) || "" : "",
          unitPrice,
          totalValue: Number(row.onHand || 0) * unitPrice,
          updatedAt: row.updatedAt
        };
      });
  
    const totalValue = rows.reduce((sum, row) => sum + (row.totalValue || 0), 0);
    res.json({ totalValue, rows });
  });
  
  app.post("/api/central-inventory/adjust", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { itemId, mode, quantity, reason } = req.body || {};
    const normalizedItemId = String(itemId || "").trim();
    const normalizedMode = String(mode || "").trim().toUpperCase();
    const normalizedReason = String(reason || "").trim();
    const normalizedQty = Number(quantity || 0);
  
    if (!normalizedItemId) return res.status(400).json({ message: "itemId is required" });
    if (!["ADD", "REMOVE", "SET"].includes(normalizedMode)) {
      return res.status(400).json({ message: "mode must be ADD, REMOVE, or SET" });
    }
    if (!normalizedReason) return res.status(400).json({ message: "Reason is required" });
    if (normalizedQty <= 0 && normalizedMode !== "SET") {
      return res.status(400).json({ message: "Quantity must be greater than zero" });
    }
    if (normalizedMode === "SET" && normalizedQty < 0) {
      return res.status(400).json({ message: "Quantity cannot be negative" });
    }
  
    const inventoryCol = repository.centralInventory();
    const itemsCol = repository.items();
    const categoriesCol = repository.categories();
    const logsCol = repository.manualAdjustments();
  
    const itemDoc = await itemsCol.findOne({ id: normalizedItemId });
    if (!itemDoc) return res.status(404).json({ message: "Item not found" });
  
    const existing = await inventoryCol.findOne({ itemId: normalizedItemId });
    const currentOnHand = Number(existing?.onHand || 0);
    let nextOnHand = currentOnHand;
    if (normalizedMode === "ADD") {
      nextOnHand = currentOnHand + normalizedQty;
    } else if (normalizedMode === "REMOVE") {
      nextOnHand = currentOnHand - normalizedQty;
    } else {
      nextOnHand = normalizedQty;
    }
  
    if (nextOnHand < 0) {
      return res.status(400).json({ message: "Cannot reduce on-hand below zero" });
    }
  
    const nowIso = new Date().toISOString();
    if (nextOnHand === 0) {
      await inventoryCol.deleteOne({ itemId: normalizedItemId });
    } else {
      await inventoryCol.updateOne(
        { itemId: normalizedItemId },
        { $set: { itemId: normalizedItemId, onHand: nextOnHand, updatedAt: nowIso } },
        { upsert: true }
      );
    }
  
    const categoryDoc = await categoriesCol.findOne({ id: itemDoc.categoryId });
    const categoryName = categoryDoc?.name || "";
    const delta = nextOnHand - currentOnHand;
    await logsCol.insertOne({
      id: uuidv4(),
      itemId: normalizedItemId,
      itemName: itemDoc.name,
      categoryName,
      mode: normalizedMode,
      delta,
      beforeQty: currentOnHand,
      afterQty: nextOnHand,
      reason: normalizedReason,
      createdAt: nowIso,
      createdBy: req.user?.id || ""
    });
  
    res.json({ ok: true, itemId: normalizedItemId, beforeQty: currentOnHand, afterQty: nextOnHand });
  });
  
  app.get("/api/central-inventory/adjustments", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const startDate = parseStartDate(req.query.startDate);
    const filter = startDate ? { createdAt: { $gte: startDate } } : {};
    const logs = await repository.manualAdjustments()
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();
    res.json(logs);
  });
  
  app.post("/api/central-inventory/flush", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return res.status(400).json({ message: "Reason is required" });
  
    const inventoryCol = repository.centralInventory();
    const itemsCol = repository.items();
    const categoriesCol = repository.categories();
    const logsCol = repository.manualAdjustments();
  
    const inventory = await inventoryCol.find({}).toArray();
    if (!inventory.length) return res.json({ ok: true, flushed: 0 });
  
    const itemIds = inventory.map((row) => row.itemId);
    const masterItems = await itemsCol.find({ id: { $in: itemIds } }).toArray();
    const categories = await categoriesCol.find({}).toArray();
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
    const itemMap = new Map(masterItems.map((it) => [it.id, it]));
    const nowIso = new Date().toISOString();
  
    const logs = inventory.map((row) => {
      const item = itemMap.get(row.itemId);
      const categoryName = item ? categoryMap.get(item.categoryId) || "" : "";
      const beforeQty = Number(row.onHand || 0);
      return {
        id: uuidv4(),
        itemId: row.itemId,
        itemName: item?.name || row.itemId,
        categoryName,
        mode: "FLUSH",
        delta: -beforeQty,
        beforeQty,
        afterQty: 0,
        reason,
        createdAt: nowIso,
        createdBy: req.user?.id || ""
      };
    });
  
    await inventoryCol.deleteMany({});
    if (logs.length) await logsCol.insertMany(logs);
  
    res.json({ ok: true, flushed: logs.length });
  });
}







