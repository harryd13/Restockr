export function registerDailyRequestRoutesController(context) {
  const { app, repository, DAILY_MENTIONS, uuidv4, authMiddleware, formatDateLocal, formatMentions, sendDailyWebhook } = context;

  // --- Daily Requests ---
  app.get("/api/daily-requests/current", authMiddleware, async (req, res) => {
    if (req.user.role !== "BRANCH") {
      return res.status(403).json({ message: "Branch role required" });
    }
    const branchId = req.user.branchId;
    const requestDate = formatDateLocal(new Date());
    const requestsCol = repository.dailyRequests();
    const itemsCol = repository.dailyRequestItems();
  
    let reqObj = await requestsCol.findOne({ branchId, requestDate, status: "DRAFT" });
    if (!reqObj) {
      reqObj = {
        id: uuidv4(),
        branchId,
        requestDate,
        status: "DRAFT",
        createdBy: req.user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await requestsCol.insertOne(reqObj);
    }
    const items = await itemsCol.find({ requestId: reqObj.id }).toArray();
    res.json({ request: reqObj, items });
  });
  
  app.post("/api/daily-requests/:id/items", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { items: bodyItems } = req.body; // [{ itemId, requestedQty }]
    const requestsCol = repository.dailyRequests();
    const itemsCol = repository.dailyRequestItems();
    const masterItemsCol = repository.items();
    const categoriesCol = repository.categories();
  
    const reqObj = await requestsCol.findOne({ id });
    if (!reqObj) return res.status(404).json({ message: "Request not found" });
    if (req.user.role !== "BRANCH" || req.user.branchId !== reqObj.branchId) {
      return res.status(403).json({ message: "Not allowed" });
    }
    if (reqObj.status !== "DRAFT") {
      return res.status(400).json({ message: "Cannot edit non-draft request" });
    }
  
    const requestedItems = (bodyItems || []).filter((bi) => bi.requestedQty > 0);
    if (requestedItems.length > 10) {
      return res.status(400).json({ message: "Daily requests allow a maximum of 10 items. Submit to create another request for today." });
    }
  
    await itemsCol.deleteMany({ requestId: id });
  
    const itemIds = requestedItems.map((bi) => bi.itemId);
    const itemDocs = await masterItemsCol.find({ id: { $in: itemIds } }).toArray();
    const categoryDocs = await categoriesCol.find({}).toArray();
    const categoryMap = new Map(categoryDocs.map((c) => [c.id, c]));
  
    const newItems = [];
    for (const bi of bodyItems || []) {
      if (bi.requestedQty <= 0) continue;
      const item = itemDocs.find((it) => it.id === bi.itemId);
      if (!item) continue;
      const cat = categoryMap.get(item.categoryId);
      const unitPrice = item.defaultPrice || 0;
      newItems.push({
        id: uuidv4(),
        requestId: id,
        branchId: reqObj.branchId,
        itemId: item.id,
        itemName: item.name,
        categoryName: cat ? cat.name : "",
        requestedQty: bi.requestedQty,
        unitPrice
      });
    }
  
    if (newItems.length) {
      await itemsCol.insertMany(newItems);
    }
    await requestsCol.updateOne({ id }, { $set: { updatedAt: new Date().toISOString() } });
    const itemsForReq = await itemsCol.find({ requestId: id }).toArray();
    res.json({ request: reqObj, items: itemsForReq });
  });
  
  app.post("/api/daily-requests/:id/submit", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const requestsCol = repository.dailyRequests();
    const itemsCol = repository.dailyRequestItems();
    const ticketsCol = repository.tickets();
    const ticketItemsCol = repository.ticketItems();
  
    const reqObj = await requestsCol.findOne({ id });
    if (!reqObj) return res.status(404).json({ message: "Request not found" });
    if (req.user.role !== "BRANCH" || req.user.branchId !== reqObj.branchId) {
      return res.status(403).json({ message: "Not allowed" });
    }
    if (reqObj.status !== "DRAFT") {
      return res.status(400).json({ message: "Only draft can be submitted" });
    }
  
    const items = await itemsCol.find({ requestId: id }).toArray();
    if (!items.length) {
      return res.status(400).json({ message: "Cannot submit an empty request" });
    }
  
    await requestsCol.updateOne(
      { id },
      { $set: { status: "SUBMITTED", updatedAt: new Date().toISOString() } }
    );
  
    const ticket = {
      id: uuidv4(),
      requestId: id,
      branchId: reqObj.branchId,
      requestDate: reqObj.requestDate,
      status: "OPEN",
      type: "DAILY",
      assignee: "",
      paymentMethod: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await ticketsCol.insertOne(ticket);
  
    const ticketItems = items.map((it) => ({
      id: uuidv4(),
      ticketId: ticket.id,
      itemId: it.itemId,
      itemName: it.itemName,
      categoryName: it.categoryName,
      requestedQty: it.requestedQty,
      approvedQty: it.requestedQty,
      unitPrice: it.unitPrice || 0,
      fromStock: false
    }));
    await ticketItemsCol.insertMany(ticketItems);
  
    const branchDoc = await repository.branches().findOne({ id: reqObj.branchId });
    const branchName = branchDoc?.name || reqObj.branchId;
    const mentionLine = formatMentions(DAILY_MENTIONS[reqObj.branchId] || []);
    const itemLines = items
      .map((it) => {
        const qty = Number(it.requestedQty || 0);
        return `${it.itemName} (${qty})`;
      })
      .join("\n");
    const total = items.reduce((sum, it) => sum + Number(it.requestedQty || 0) * Number(it.unitPrice || 0), 0);
    const separator = "_____________________________";
    const totalLine = mentionLine
      ? `Estimated total: Rs ${total.toFixed(2)} ${mentionLine}`
      : `Estimated total: Rs ${total.toFixed(2)}`;
    const dailyMessage = [
      "Daily request submitted.",
      `Branch - ${branchName}`,
      separator,
      "Items:-",
      itemLines || "None",
      separator,
      `Date: ${reqObj.requestDate}`,
      totalLine
    ].join("\n");
    sendDailyWebhook(dailyMessage);
  
    const updated = await requestsCol.findOne({ id });
    res.json({ request: updated });
  });
}







