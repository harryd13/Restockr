export function registerMiscRequestRoutesController(context) {
  const { app, repository, uuidv4, authMiddleware, formatDateLocal } = context;

  // --- Misc Requests ---
  app.post("/api/misc-requests/submit", authMiddleware, async (req, res) => {
    if (req.user.role !== "BRANCH") {
      return res.status(403).json({ message: "Branch role required" });
    }
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Items are required" });
    }
  
    const requestsCol = repository.miscRequests();
    const itemsCol = repository.miscRequestItems();
    const ticketsCol = repository.tickets();
    const ticketItemsCol = repository.ticketItems();
  
    const requestId = uuidv4();
    const requestDate = formatDateLocal(new Date());
    const reqDoc = {
      id: requestId,
      branchId: req.user.branchId,
      requestDate,
      createdBy: req.user.id,
      createdAt: new Date().toISOString()
    };
    await requestsCol.insertOne(reqDoc);
  
    const cleanedItems = items
      .map((it) => ({
        itemName: String(it.itemName || "").trim(),
        requestedQty: Number(it.requestedQty || 0),
        reason: String(it.reason || "").trim()
      }))
      .filter((it) => it.itemName && it.requestedQty > 0);
  
    if (!cleanedItems.length) {
      return res.status(400).json({ message: "Valid items are required" });
    }
  
    const reqItems = cleanedItems.map((it) => ({
      id: uuidv4(),
      requestId,
      branchId: req.user.branchId,
      itemName: it.itemName,
      requestedQty: it.requestedQty,
      reason: it.reason || ""
    }));
    await itemsCol.insertMany(reqItems);
  
    const ticket = {
      id: uuidv4(),
      requestId,
      branchId: req.user.branchId,
      requestDate,
      status: "OPEN",
      type: "OTHER",
      assignee: "",
      paymentMethod: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await ticketsCol.insertOne(ticket);
  
    const ticketItems = reqItems.map((it) => ({
      id: uuidv4(),
      ticketId: ticket.id,
      itemId: uuidv4(),
      itemName: it.itemName,
      categoryName: "",
      requestedQty: it.requestedQty,
      approvedQty: it.requestedQty,
      unitPrice: 0,
      fromStock: false,
      reason: it.reason || ""
    }));
    await ticketItemsCol.insertMany(ticketItems);
  
    res.status(201).json({ ok: true, requestId });
  });
}









