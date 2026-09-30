function serviceError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function createPurchaseService(repository, { uuidv4, formatDateLocal }) {
  const requests = repository.weeklyRequests;
  const items = repository.weeklyRequestItems;
  const logs = repository.purchaseLogs;
  const expenseTickets = repository.expenseTickets;

  async function getRun(weekStartDate, branchId) {
    const filter = { weekStartDate, status: { $ne: "PURCHASED" }, ...(branchId ? { branchId } : {}) };
    const requestList = await requests().find(filter).toArray();
    const requestIds = requestList.map((request) => request.id);
    const rows = requestIds.length ? await items().find({ requestId: { $in: requestIds } }).toArray() : [];
    return { weekStartDate, rows, requestIds: Array.from(new Set(rows.map((row) => row.requestId))) };
  }

  async function updateItems(requestId, bodyItems = []) {
    for (const bodyItem of bodyItems) {
      const update = {};
      if (typeof bodyItem.approvedQty === "number") update.approvedQty = bodyItem.approvedQty;
      if (typeof bodyItem.unitPrice === "number") update.unitPrice = bodyItem.unitPrice;
      if (["AVAILABLE", "UNAVAILABLE", "PAYMENT_PENDING"].includes(bodyItem.status)) update.status = bodyItem.status;
      if (!Object.keys(update).length) continue;
      const existing = await items().findOne({ id: bodyItem.id, requestId });
      if (!existing) continue;
      const quantity = update.approvedQty ?? existing.approvedQty;
      const price = update.unitPrice ?? existing.unitPrice;
      update.totalPrice = quantity * price;
      await items().updateOne({ id: bodyItem.id, requestId }, { $set: update });
    }
    return items().find({ requestId }).toArray();
  }

  function createPendingTickets(requestList, itemList, nowIso) {
    const requestMap = new Map(requestList.map((request) => [request.id, request]));
    const grouped = new Map();
    itemList.filter((item) => item.status === "PAYMENT_PENDING" && Number(item.approvedQty || 0) > 0).forEach((item) => {
      if (!grouped.has(item.requestId)) grouped.set(item.requestId, []);
      grouped.get(item.requestId).push(item);
    });
    return Array.from(grouped, ([requestId, pendingItems]) => {
      const request = requestMap.get(requestId);
      return {
        id: uuidv4(), category: "Purchase", branchId: request.branchId, assignee: "", paymentMethod: "",
        amount: pendingItems.reduce((sum, item) => sum + (item.totalPrice || item.approvedQty * item.unitPrice), 0),
        date: request.weekStartDate || formatDateLocal(new Date(request.createdAt || Date.now())),
        attachmentName: "", attachmentType: "", attachmentData: "",
        items: pendingItems.map((item) => ({ name: item.itemName, qty: Number(item.approvedQty || 0), unitPrice: Number(item.unitPrice || 0) })),
        employeeName: "", source: "", note: "", status: "PENDING", createdAt: nowIso, updatedAt: nowIso
      };
    });
  }

  async function finalizeRequests(requestIds) {
    if (!Array.isArray(requestIds) || !requestIds.length) throw serviceError(400, "requestIds array is required");
    const requestList = await requests().find({ id: { $in: requestIds } }).toArray();
    if (requestList.length !== requestIds.length) throw serviceError(404, requestIds.length === 1 ? "Request not found" : "Requests not found");
    if (new Set(requestList.map((request) => request.weekStartDate)).size > 1) throw serviceError(400, "All requests must belong to the same week");
    if (requestList.some((request) => request.status === "PURCHASED")) throw serviceError(400, requestIds.length === 1 ? "Request already finalized" : "Some requests are already finalized");
    const itemList = await items().find({ requestId: { $in: requestIds } }).toArray();
    if (!itemList.length) throw serviceError(400, "Cannot finalize empty purchase list");
    const nowIso = new Date().toISOString();
    const pendingTickets = createPendingTickets(requestList, itemList, nowIso);
    if (pendingTickets.length) await expenseTickets().insertMany(pendingTickets);
    const branchMap = new Map();
    let total = 0;
    itemList.filter((item) => item.status !== "PAYMENT_PENDING").forEach((item) => {
      total += Number(item.totalPrice || 0);
      const branch = branchMap.get(item.branchId) || { branchId: item.branchId, total: 0, items: [] };
      branch.total += Number(item.totalPrice || 0);
      branch.items.push({ itemId: item.itemId, itemName: item.itemName, categoryName: item.categoryName, requestedQty: item.requestedQty, approvedQty: item.approvedQty, unitPrice: item.unitPrice, totalPrice: item.totalPrice });
      branchMap.set(item.branchId, branch);
    });
    const weekStartDate = requestList[0].weekStartDate;
    await logs().insertOne({ id: uuidv4(), ...(requestIds.length === 1 ? { requestId: requestIds[0] } : { requestIds }), weekStartDate, createdAt: nowIso, total, branches: Array.from(branchMap.values()) });
    await requests().updateMany({ id: { $in: requestIds } }, { $set: { status: "PURCHASED", updatedAt: nowIso } });
    return { ok: true, weekStartDate, total, requestIds, request: requestIds.length === 1 ? await requests().findOne({ id: requestIds[0] }) : undefined };
  }

  return { getRun, updateItems, finalizeRequests };
}
