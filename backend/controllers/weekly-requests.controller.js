export function registerWeeklyRequestRoutesController(context) {
  const { app, repository, ALLOW_WEEKLY_ANY_DAY, uuidv4, authMiddleware, isWeeklyWindow, startOfWeek, getWeeklyOverrideSetting, createCombinedPurchaseRunForRequest } = context;

  // --- Branch Requests ---
  app.get("/api/requests/current", authMiddleware, async (req, res) => {
    if (req.user.role !== "BRANCH") {
      return res.status(403).json({ message: "Branch role required" });
    }
    const branchId = req.user.branchId;
    const weekStartDate = startOfWeek();
    const requestsCol = repository.weeklyRequests();
    const itemsCol = repository.weeklyRequestItems();
  
    const reqObj = await requestsCol.findOne({ branchId, weekStartDate, status: "DRAFT" });
    if (!reqObj) {
      return res.json({ request: null, items: [] });
    }
    const items = await itemsCol.find({ requestId: reqObj.id }).toArray();
    res.json({ request: reqObj, items });
  });
  
  app.post("/api/requests/current", authMiddleware, async (req, res) => {
    if (req.user.role !== "BRANCH") {
      return res.status(403).json({ message: "Branch role required" });
    }
    const weeklyOverride = await getWeeklyOverrideSetting();
    if (!ALLOW_WEEKLY_ANY_DAY && !weeklyOverride && !isWeeklyWindow()) {
      return res.status(400).json({ message: "Weekly requests can only be started on Thursday or before 12pm Friday." });
    }
    const branchId = req.user.branchId;
    const weekStartDate = startOfWeek();
    const requestsCol = repository.weeklyRequests();
    const itemsCol = repository.weeklyRequestItems();
  
    let reqObj = await requestsCol.findOne({ branchId, weekStartDate, status: "DRAFT" });
    if (!reqObj) {
      reqObj = {
        id: uuidv4(),
        branchId,
        weekStartDate,
        status: "DRAFT",
        createdBy: req.user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await requestsCol.insertOne(reqObj);
    }
    const items = await itemsCol.find({ requestId: reqObj.id }).toArray();
    res.status(201).json({ request: reqObj, items });
  });
  
  app.post("/api/requests/:id/items", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { items: bodyItems } = req.body; // [{ itemId, requestedQty }]
    const requestsCol = repository.weeklyRequests();
    const itemsCol = repository.weeklyRequestItems();
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
  
    await itemsCol.deleteMany({ requestId: id });
  
    const itemIds = (bodyItems || []).filter((bi) => bi.requestedQty > 0).map((bi) => bi.itemId);
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
        approvedQty: bi.requestedQty,
        unitPrice,
        totalPrice: unitPrice * bi.requestedQty,
        status: "AVAILABLE"
      });
    }
  
    if (newItems.length) {
      await itemsCol.insertMany(newItems);
    }
    await requestsCol.updateOne({ id }, { $set: { updatedAt: new Date().toISOString() } });
    const itemsForReq = await itemsCol.find({ requestId: id }).toArray();
    res.json({ request: reqObj, items: itemsForReq });
  });
  
  app.post("/api/requests/:id/submit", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const requestsCol = repository.weeklyRequests();
    const itemsCol = repository.weeklyRequestItems();
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
    const updated = await requestsCol.findOne({ id });
    await createCombinedPurchaseRunForRequest(updated.id);
    res.json({ request: updated });
  });
}







