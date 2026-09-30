import { applyTicketItemUpdates, insertExpenseLog } from "./ticket-workflow.service.js";

export function createTicketsService(context) {
  const { repository, uuidv4, ensureAdmin, getCurrentDateInIST, parseStartDate, getCentralInventoryMap, upsertCentralInventory } = context;
  return {
    handle1: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const status = req.query.status || "OPEN";
    const ticketsCol = repository.tickets();
    const itemsCol = repository.ticketItems();
    const tickets = await ticketsCol.find({ status }).sort({ createdAt: -1 }).toArray();
    const ticketIds = tickets.map((t) => t.id);
    const items = ticketIds.length ? await itemsCol.find({ ticketId: { $in: ticketIds } }).toArray() : [];
    res.json({ tickets, items });
  },

    handle2: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const { reason } = req.body || {};
    const allowedReasons = ["duplicate", "wrong", "stale"];
    if (!allowedReasons.includes(String(reason || "").toLowerCase())) {
      return res.status(400).json({ message: "Valid delete reason required." });
    }
  
    const ticketsCol = repository.tickets();
    const ticket = await ticketsCol.findOne({ id });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
  
    await ticketsCol.updateOne(
      { id },
      {
        $set: {
          status: "DELETED",
          deleteReason: String(reason).toLowerCase(),
          deletedAt: new Date().toISOString(),
          deletedBy: req.user.id,
          updatedAt: new Date().toISOString()
        }
      }
    );
  
    res.json({ ok: true });
  },

    handle3: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const { assignee, paymentMethod, items } = req.body;
    const ticketsCol = repository.tickets();
    const itemsCol = repository.ticketItems();
    const logsCol = repository.expenseLogs();
  
    const ticket = await ticketsCol.findOne({ id });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    if (ticket.status !== "OPEN") return res.status(400).json({ message: "Ticket already closed" });
    if (!paymentMethod) return res.status(400).json({ message: "Payment method is required" });
  
    await applyTicketItemUpdates(itemsCol, id, items);
  
    const updatedItems = await itemsCol.find({ ticketId: id }).toArray();
    const inventoryMap = await getCentralInventoryMap(updatedItems.map((row) => row.itemId));
    for (const row of updatedItems) {
      if (row.fromStock) {
        const approvedQty = Number(row.approvedQty || 0);
        const onHand = inventoryMap.get(row.itemId) || 0;
        if (approvedQty > onHand) {
          return res.status(400).json({ message: "From stock quantity exceeds central inventory" });
        }
        if (approvedQty > 0) {
          await upsertCentralInventory(row.itemId, -approvedQty);
        }
      }
    }
  
    const total = updatedItems.reduce((sum, row) => {
      if (row.fromStock) return sum;
      return sum + (row.approvedQty || 0) * (row.unitPrice || 0);
    }, 0);
    const requestTotal = updatedItems.reduce((sum, row) => sum + (row.approvedQty || 0) * (row.unitPrice || 0), 0);
    await insertExpenseLog(logsCol, {
      id: uuidv4(),
      ticketId: id,
      branchId: ticket.branchId,
      type: ticket.type || "DAILY",
      requestDate: ticket.requestDate,
      completedDate: getCurrentDateInIST(),
      assignee: assignee || ticket.assignee || "",
      paymentMethod: paymentMethod || ticket.paymentMethod || "",
      createdAt: ticket.createdAt,
      completedAt: new Date().toISOString(),
      total,
      requestTotal,
      items: updatedItems
    });
  
    await ticketsCol.updateOne(
      { id },
      { $set: { status: "DONE", assignee: assignee || "", paymentMethod: paymentMethod || "", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() } }
    );
  
    res.json({ ok: true });
  },

    handle4: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const { assignee, paymentMethod, items } = req.body;
    const ticketsCol = repository.tickets();
    const itemsCol = repository.ticketItems();
    const logsCol = repository.expenseLogs();
  
    const ticket = await ticketsCol.findOne({ id });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    if (ticket.status !== "OPEN") return res.status(400).json({ message: "Ticket already closed" });
    if (!paymentMethod) return res.status(400).json({ message: "Payment method is required" });
  
    await applyTicketItemUpdates(itemsCol, id, items);
  
    const updatedItems = await itemsCol.find({ ticketId: id }).toArray();
    const completedItems = updatedItems.filter((row) => (row.approvedQty || 0) > 0);
    const remainingItems = updatedItems
      .map((row) => ({
        ...row,
        remainingQty: Math.max(0, (row.requestedQty || 0) - (row.approvedQty || 0))
      }))
      .filter((row) => row.remainingQty > 0);
  
    if (!completedItems.length) {
      return res.status(400).json({ message: "No approved items to submit" });
    }
  
    const inventoryMap = await getCentralInventoryMap(completedItems.map((row) => row.itemId));
    for (const row of completedItems) {
      if (row.fromStock) {
        const approvedQty = Number(row.approvedQty || 0);
        const onHand = inventoryMap.get(row.itemId) || 0;
        if (approvedQty > onHand) {
          return res.status(400).json({ message: "From stock quantity exceeds central inventory" });
        }
        if (approvedQty > 0) {
          await upsertCentralInventory(row.itemId, -approvedQty);
        }
      }
    }
  
    const total = completedItems.reduce((sum, row) => {
      if (row.fromStock) return sum;
      return sum + (row.approvedQty || 0) * (row.unitPrice || 0);
    }, 0);
    const requestTotal = completedItems.reduce((sum, row) => sum + (row.approvedQty || 0) * (row.unitPrice || 0), 0);
  
    await insertExpenseLog(logsCol, {
      id: uuidv4(),
      ticketId: id,
      branchId: ticket.branchId,
      type: ticket.type || "DAILY",
      requestDate: ticket.requestDate,
      completedDate: getCurrentDateInIST(),
      assignee: assignee || ticket.assignee || "",
      paymentMethod: paymentMethod || ticket.paymentMethod || "",
      createdAt: ticket.createdAt,
      completedAt: new Date().toISOString(),
      total,
      requestTotal,
      items: completedItems
    });
  
    if (remainingItems.length) {
      await itemsCol.deleteMany({ ticketId: id });
      const resetRemaining = remainingItems.map((row) => ({
        id: uuidv4(),
        ticketId: id,
        itemId: row.itemId,
        itemName: row.itemName,
        categoryName: row.categoryName,
        requestedQty: row.remainingQty,
        approvedQty: 0,
        unitPrice: row.unitPrice || 0,
        fromStock: false
      }));
      await itemsCol.insertMany(resetRemaining);
      await ticketsCol.updateOne(
        { id },
        { $set: { assignee: assignee || "", paymentMethod: paymentMethod || "", updatedAt: new Date().toISOString() } }
      );
    } else {
      await ticketsCol.updateOne(
        { id },
        { $set: { status: "DONE", assignee: assignee || "", paymentMethod: paymentMethod || "", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() } }
      );
    }
  
    res.json({ ok: true, remaining: remainingItems.length });
  },

    handle5: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const startDate = parseStartDate(req.query.startDate);
    const filter = startDate ? { completedAt: { $gte: startDate } } : {};
    const logs = await repository.expenseLogs().find(filter).sort({ completedAt: -1 }).toArray();
    res.json(logs);
  }
  };
}





