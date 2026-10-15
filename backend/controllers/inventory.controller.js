export function registerInventoryRoutesController(context) {
  const { app, repository, uuidv4, authMiddleware, ensureAdmin, parseStartDate, getClient, getCurrentDateInIST } = context;

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
        const unitPrice = Number(row.unitCost ?? item?.defaultPrice ?? 0);
        return {
          itemId: row.itemId,
          onHand: Number(row.onHand || 0),
          reserved: Number(row.reserved || 0),
          available: Math.max(0, Number(row.onHand || 0) - Number(row.reserved || 0)),
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
    const currentReserved = Number(existing?.reserved || 0);
    let nextOnHand = currentOnHand;
    if (normalizedMode === "ADD") {
      nextOnHand = currentOnHand + normalizedQty;
    } else if (normalizedMode === "REMOVE") {
      nextOnHand = currentOnHand - normalizedQty;
    } else {
      nextOnHand = normalizedQty;
    }
  
    if (nextOnHand < currentReserved) {
      return res.status(400).json({ message: `Cannot reduce on-hand below the reserved quantity (${currentReserved})` });
    }
  
    const nowIso = new Date().toISOString();
    if (nextOnHand === 0 && currentReserved === 0) {
      await inventoryCol.deleteOne({ itemId: normalizedItemId });
    } else {
      await inventoryCol.updateOne(
        { itemId: normalizedItemId },
        { $set: { itemId: normalizedItemId, onHand: nextOnHand, reserved: currentReserved, updatedAt: nowIso } },
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

  app.get("/api/central-procurements", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const rows = await repository.centralProcurements().find({}).sort({ createdAt: -1 }).toArray();
    res.json(rows);
  });

  app.post("/api/central-procurements", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { paymentStatus, paymentMethod, note, items, idempotencyKey } = req.body || {};
    const key = String(idempotencyKey || "").trim();
    if (!key) return res.status(400).json({ message: "idempotencyKey is required" });
    const existing = await repository.centralProcurements().findOne({ idempotencyKey: key });
    if (existing) return res.json({ procurement: existing, replayed: true });
    const normalizedPaymentStatus = String(paymentStatus || "").trim().toUpperCase();
    const normalizedPaymentMethod = String(paymentMethod || "").trim();
    if (!new Set(["PAID", "PENDING"]).has(normalizedPaymentStatus)) return res.status(400).json({ message: "Payment status must be PAID or PENDING" });
    if (normalizedPaymentStatus === "PAID" && !new Set(["Cash", "UPI"]).has(normalizedPaymentMethod)) return res.status(400).json({ message: "Payment method is required for paid procurement" });
    const itemIds = [...new Set((Array.isArray(items) ? items : []).map((row) => String(row.itemId || "").trim()).filter(Boolean))];
    const masterItems = itemIds.length ? await repository.items().find({ id: { $in: itemIds } }).toArray() : [];
    const itemMap = new Map(masterItems.map((item) => [item.id, item]));
    const cleanedItems = (Array.isArray(items) ? items : []).map((row) => ({
      itemId: String(row.itemId || "").trim(),
      itemName: itemMap.get(String(row.itemId || "").trim())?.name || "",
      quantity: Number(row.quantity || 0),
      unitPrice: Number(row.unitPrice || 0)
    })).filter((row) => row.itemId && row.itemName && row.quantity > 0 && row.unitPrice >= 0);
    if (!cleanedItems.length || cleanedItems.length !== (Array.isArray(items) ? items.length : 0)) return res.status(400).json({ message: "Every item needs a valid quantity and price" });
    if (new Set(cleanedItems.map((row) => row.itemId)).size !== cleanedItems.length) return res.status(400).json({ message: "Each item can appear only once" });
    const nowIso = new Date().toISOString();
    const procurementId = uuidv4();
    const total = Number(cleanedItems.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0).toFixed(2));
    const procurement = {
      id: procurementId, branchId: "CENTRAL",
      paymentStatus: normalizedPaymentStatus, paymentMethod: normalizedPaymentStatus === "PAID" ? normalizedPaymentMethod : "",
      note: String(note || "").trim(), items: cleanedItems, total,
      status: normalizedPaymentStatus === "PAID" ? "COMPLETED" : "PAYMENT_PENDING", idempotencyKey: key,
      receivedAt: nowIso, receivedBy: req.user?.id || "", createdAt: nowIso, updatedAt: nowIso
    };
    const session = getClient().startSession();
    try {
      await session.withTransaction(async () => {
        for (const item of cleanedItems) {
          const current = await repository.centralInventory().findOne({ itemId: item.itemId }, { session });
          const currentQty = Number(current?.onHand || 0);
          const currentCost = Number(current?.unitCost || 0);
          const nextQty = currentQty + item.quantity;
          const nextCost = Number(((currentQty * currentCost + item.quantity * item.unitPrice) / nextQty).toFixed(4));
          await repository.centralInventory().updateOne(
            { itemId: item.itemId },
            { $set: { itemId: item.itemId, onHand: nextQty, reserved: Number(current?.reserved || 0), unitCost: nextCost, updatedAt: nowIso } },
            { upsert: true, session }
          );
        }
        if (normalizedPaymentStatus === "PAID") {
          const expenseLogId = uuidv4();
          await repository.expenseTicketLogs().insertOne({
            id: expenseLogId, branchId: "CENTRAL", category: "Purchase", assignee: req.user?.id || "",
            paymentMethod: normalizedPaymentMethod, amount: total, date: getCurrentDateInIST(),
            items: cleanedItems.map((row) => ({ itemId: row.itemId, name: row.itemName, qty: row.quantity, unitPrice: row.unitPrice })),
            sourceType: "CENTRAL_PROCUREMENT_PAYMENT", sourceId: procurementId, status: "LOGGED", paidAt: nowIso, createdAt: nowIso
          }, { session });
          procurement.expenseLogId = expenseLogId;
        } else {
          const ticketId = uuidv4();
          await repository.expenseTickets().insertOne({
            id: ticketId, category: "Purchase", branchId: "CENTRAL", assignee: "", paymentMethod: "", amount: total,
            date: getCurrentDateInIST(), items: cleanedItems.map((row) => ({ name: row.itemName, qty: row.quantity, unitPrice: row.unitPrice })),
            sourceType: "CENTRAL_PROCUREMENT", sourceId: procurementId, centralProcurementId: procurementId,
            note: procurement.note, status: "PENDING", createdAt: nowIso, updatedAt: nowIso
          }, { session });
          procurement.pendingTicketId = ticketId;
        }
        await repository.centralProcurements().insertOne(procurement, { session });
      });
      res.status(201).json({ procurement });
    } catch (err) {
      if (err?.code === 11000) {
        const replay = await repository.centralProcurements().findOne({ idempotencyKey: key });
        if (replay) return res.json({ procurement: replay, replayed: true });
      }
      throw err;
    } finally {
      await session.endSession();
    }
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
    const reservedRows = inventory.filter((row) => Number(row.reserved || 0) > 0);
    if (reservedRows.length) {
      return res.status(409).json({ message: "Cannot flush inventory while stock is reserved for submitted weekly requests" });
    }
  
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
