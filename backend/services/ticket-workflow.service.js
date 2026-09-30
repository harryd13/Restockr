export async function applyTicketItemUpdates(itemsCollection, ticketId, items = []) {
  for (const item of items) {
    const update = {};
    if (typeof item.approvedQty === "number") update.approvedQty = item.approvedQty;
    if (typeof item.unitPrice === "number") update.unitPrice = item.unitPrice;
    if (typeof item.fromStock === "boolean") update.fromStock = item.fromStock;
    if (Object.keys(update).length) await itemsCollection.updateOne({ id: item.id, ticketId }, { $set: update });
  }
}

export function createTicketExpenseLog({ uuidv4, ticket, ticketId, items, assignee, paymentMethod, completedDate }) {
  const totals = items.reduce((result, item) => {
    const amount = Number(item.approvedQty || 0) * Number(item.unitPrice || 0);
    result.requestTotal += amount;
    if (!item.fromStock) result.total += amount;
    return result;
  }, { total: 0, requestTotal: 0 });
  return {
    id: uuidv4(), ticketId, branchId: ticket.branchId, type: ticket.type || "DAILY",
    requestDate: ticket.requestDate, completedDate, assignee: assignee || ticket.assignee || "",
    paymentMethod: paymentMethod || ticket.paymentMethod || "", createdAt: ticket.createdAt,
    completedAt: new Date().toISOString(), ...totals, items
  };
}

export function insertExpenseLog(logsCollection, document) {
  return logsCollection.insertOne(document);
}

export function updateExpenseLog(logsCollection, filter, update) {
  return logsCollection.updateOne(filter, update);
}
