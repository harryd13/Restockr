import { insertExpenseLog, updateExpenseLog } from "./ticket-workflow.service.js";

export function createExpenseTicketsService(context) {
  const { repository, uuidv4, ensureAdmin, formatDateLocal, sendSlackWebhook } = context;
  return {
    handle1: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const status = String(req.query.status || "").trim().toUpperCase();
    const filter = {};
    if (status) filter.status = status;
    const tickets = await repository.expenseTickets().find(filter).sort({ createdAt: -1 }).toArray();
    res.json(tickets);
  },

    handle2: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const {
      category,
      branchId,
      assignee,
      paymentMethod,
      status,
      amount,
      date,
      attachmentName,
      attachmentType,
      attachmentData,
      items,
      employeeName,
      source,
      note
    } = req.body;
  
    const normalizedCategory = String(category || "").trim();
    const normalizedBranchId = String(branchId || "").trim();
    const normalizedAssignee = String(assignee || "").trim();
    const normalizedPayment = String(paymentMethod || "").trim();
    const normalizedDate = String(date || "").trim();
    const normalizedAmount = Number(amount || 0);
    const normalizedStatus = String(status || "LOGGED").trim().toUpperCase();
    const allowedStatuses = ["LOGGED", "PENDING"];
  
    if (!normalizedCategory) return res.status(400).json({ message: "Category is required" });
    if (!normalizedBranchId) return res.status(400).json({ message: "Branch is required" });
    if (!normalizedAssignee) return res.status(400).json({ message: "Assignee is required" });
    if (!allowedStatuses.includes(normalizedStatus)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    if (normalizedStatus !== "PENDING" && !normalizedPayment) {
      return res.status(400).json({ message: "Payment method is required" });
    }
    if (!normalizedDate) return res.status(400).json({ message: "Date is required" });
    if (normalizedAmount <= 0) return res.status(400).json({ message: "Amount must be greater than zero" });
  
    if (normalizedCategory === "Salary" && !String(employeeName || "").trim()) {
      return res.status(400).json({ message: "Employee name is required for Salary" });
    }
    if (normalizedCategory === "Food Expense" && !String(source || "").trim()) {
      return res.status(400).json({ message: "Source is required for Food Expense" });
    }
  
    const ticketsCol = repository.expenseTickets();
    const logsCol = repository.expenseTicketLogs();
    const cleanedItems = Array.isArray(items)
      ? items
          .map((row) => ({
            name: String(row.name || "").trim(),
            qty: Number(row.qty || 0),
            unitPrice: Number(row.unitPrice || 0)
          }))
          .filter((row) => row.name && row.qty > 0)
      : [];
    const ticket = {
      id: uuidv4(),
      category: normalizedCategory,
      branchId: normalizedBranchId,
      assignee: normalizedAssignee,
      paymentMethod: normalizedPayment,
      amount: normalizedAmount,
      date: normalizedDate,
      attachmentName: String(attachmentName || "").trim(),
      attachmentType: String(attachmentType || "").trim(),
      attachmentData: String(attachmentData || ""),
      items: cleanedItems,
      employeeName: String(employeeName || "").trim(),
      source: String(source || "").trim(),
      note: String(note || "").trim(),
      status: normalizedStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await ticketsCol.insertOne(ticket);
  
    if (normalizedStatus !== "PENDING") {
      await insertExpenseLog(logsCol, {
        id: uuidv4(),
        ticketId: ticket.id,
        branchId: ticket.branchId,
        category: ticket.category,
        assignee: ticket.assignee,
        paymentMethod: ticket.paymentMethod,
        amount: ticket.amount,
        date: ticket.date,
        attachmentName: ticket.attachmentName,
        attachmentType: ticket.attachmentType,
        attachmentData: ticket.attachmentData,
        items: ticket.items || [],
        employeeName: ticket.employeeName,
        source: ticket.source,
        note: ticket.note,
        status: ticket.status,
        createdAt: ticket.createdAt
      });
    }
  
    res.status(201).json({ ok: true, ticketId: ticket.id });
  },

    handle3: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const {
      category,
      branchId,
      assignee,
      paymentMethod,
      amount,
      date,
      attachmentName,
      attachmentType,
      attachmentData,
      items,
      employeeName,
      source,
      note
    } = req.body || {};
  
    const ticketsCol = repository.expenseTickets();
    const logsCol = repository.expenseTicketLogs();
    const ticket = await ticketsCol.findOne({ id });
    if (!ticket) return res.status(404).json({ message: "Expense ticket not found" });
    if (ticket.status === "DELETED") return res.status(400).json({ message: "Ticket already deleted" });
  
    const normalizedCategory = String(category || "").trim();
    const normalizedBranchId = String(branchId || "").trim();
    const normalizedAssignee = String(assignee || "").trim();
    const normalizedPayment = String(paymentMethod || "").trim();
    const normalizedDate = String(date || "").trim();
    const normalizedAmount = Number(amount || 0);
    const cleanedItems = Array.isArray(items)
      ? items
          .map((row) => ({
            name: String(row.name || "").trim(),
            qty: Number(row.qty || 0),
            unitPrice: Number(row.unitPrice || 0)
          }))
          .filter((row) => row.name && row.qty > 0)
      : ticket.items || [];
  
    if (!normalizedCategory) return res.status(400).json({ message: "Category is required" });
    if (!normalizedBranchId) return res.status(400).json({ message: "Branch is required" });
    if (!normalizedAssignee) return res.status(400).json({ message: "Assignee is required" });
    if (ticket.status !== "PENDING" && !normalizedPayment) {
      return res.status(400).json({ message: "Payment method is required" });
    }
    if (!normalizedDate) return res.status(400).json({ message: "Date is required" });
    if (normalizedAmount <= 0) return res.status(400).json({ message: "Amount must be greater than zero" });
  
    if (normalizedCategory === "Salary" && !String(employeeName || "").trim()) {
      return res.status(400).json({ message: "Employee name is required for Salary" });
    }
    if (normalizedCategory === "Food Expense" && !String(source || "").trim()) {
      return res.status(400).json({ message: "Source is required for Food Expense" });
    }
  
    const update = {
      category: normalizedCategory,
      branchId: normalizedBranchId,
      assignee: normalizedAssignee,
      paymentMethod: normalizedPayment,
      amount: normalizedAmount,
      date: normalizedDate,
      attachmentName: String(attachmentName || "").trim(),
      attachmentType: String(attachmentType || "").trim(),
      attachmentData: String(attachmentData || ""),
      items: cleanedItems,
      employeeName: String(employeeName || "").trim(),
      source: String(source || "").trim(),
      note: String(note || "").trim(),
      updatedAt: new Date().toISOString()
    };
  
    await ticketsCol.updateOne({ id }, { $set: update });
    if (ticket.status === "LOGGED") {
      await updateExpenseLog(logsCol, 
        { ticketId: id, status: { $ne: "DELETED" } },
        {
          $set: {
            branchId: update.branchId,
            category: update.category,
            assignee: update.assignee,
            paymentMethod: update.paymentMethod,
            amount: update.amount,
            date: update.date,
            attachmentName: update.attachmentName,
            attachmentType: update.attachmentType,
            attachmentData: update.attachmentData,
            items: update.items,
            employeeName: update.employeeName,
            source: update.source,
            note: update.note,
            updatedAt: update.updatedAt
          }
        }
      );
    }
    res.json({ ok: true });
  },

    handle4: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const {
      category,
      branchId,
      assignee,
      paymentMethod,
      amount,
      date,
      attachmentName,
      attachmentType,
      attachmentData,
      items,
      paidItems,
      employeeName,
      source,
      note,
      amountPaid
    } = req.body || {};
  
    const ticketsCol = repository.expenseTickets();
    const logsCol = repository.expenseTicketLogs();
    const ticket = await ticketsCol.findOne({ id });
    if (!ticket) return res.status(404).json({ message: "Expense ticket not found" });
    if (ticket.status !== "PENDING") return res.status(400).json({ message: "Ticket is not pending" });
  
    const normalizedCategory = String(category || ticket.category || "").trim();
    const normalizedBranchId = String(branchId || ticket.branchId || "").trim();
    const normalizedAssignee = String(assignee || ticket.assignee || "").trim();
    const normalizedPayment = String(paymentMethod || "").trim();
    const normalizedDate = String(date || ticket.date || "").trim();
    const normalizedAmount = Number(amount ?? ticket.amount ?? 0);
    const normalizedPaid = Number(amountPaid || 0);
    const cleanedItems = Array.isArray(items)
      ? items
          .map((row) => ({
            name: String(row.name || "").trim(),
            qty: Number(row.qty || 0),
            unitPrice: Number(row.unitPrice || 0)
          }))
          .filter((row) => row.name && row.qty > 0)
      : ticket.items || [];
    const cleanedPaidItems = Array.isArray(paidItems)
      ? paidItems
          .map((row) => ({
            name: String(row.name || "").trim(),
            qty: Number(row.qty || 0),
            unitPrice: Number(row.unitPrice || 0)
          }))
          .filter((row) => row.name && row.qty > 0)
      : [];
  
    if (!normalizedCategory) return res.status(400).json({ message: "Category is required" });
    if (!normalizedBranchId) return res.status(400).json({ message: "Branch is required" });
    if (!normalizedAssignee) return res.status(400).json({ message: "Assignee is required" });
    if (!normalizedPayment) return res.status(400).json({ message: "Payment method is required" });
    if (!normalizedDate) return res.status(400).json({ message: "Date is required" });
    if (normalizedAmount <= 0) return res.status(400).json({ message: "Amount must be greater than zero" });
    if (normalizedPaid <= 0) return res.status(400).json({ message: "Payment amount must be greater than zero" });
    if (normalizedPaid > normalizedAmount) return res.status(400).json({ message: "Payment exceeds pending amount" });
  
    if (normalizedCategory === "Salary" && !String(employeeName || ticket.employeeName || "").trim()) {
      return res.status(400).json({ message: "Employee name is required for Salary" });
    }
    if (normalizedCategory === "Food Expense" && !String(source || ticket.source || "").trim()) {
      return res.status(400).json({ message: "Source is required for Food Expense" });
    }
  
    const remainingAmount = Number((normalizedAmount - normalizedPaid).toFixed(2));
    const nextStatus = remainingAmount > 0 ? "PENDING" : "LOGGED";
    const nowIso = new Date().toISOString();
  
    const update = {
      category: normalizedCategory,
      branchId: normalizedBranchId,
      assignee: normalizedAssignee,
      paymentMethod: normalizedPayment,
      amount: remainingAmount > 0 ? remainingAmount : 0,
      date: normalizedDate,
      attachmentName: String(attachmentName || ticket.attachmentName || "").trim(),
      attachmentType: String(attachmentType || ticket.attachmentType || "").trim(),
      attachmentData: String(attachmentData || ticket.attachmentData || ""),
      items: cleanedItems,
      employeeName: String(employeeName || ticket.employeeName || "").trim(),
      source: String(source || ticket.source || "").trim(),
      note: String(note || ticket.note || "").trim(),
      status: nextStatus,
      updatedAt: nowIso,
      ...(nextStatus === "LOGGED" ? { completedAt: nowIso } : {})
    };
  
    await ticketsCol.updateOne({ id }, { $set: update });
  
    await insertExpenseLog(logsCol, {
      id: uuidv4(),
      ticketId: ticket.id,
      branchId: update.branchId,
      category: update.category,
      assignee: update.assignee,
      paymentMethod: update.paymentMethod,
      amount: normalizedPaid,
      date: update.date,
      attachmentName: update.attachmentName,
      attachmentType: update.attachmentType,
      attachmentData: update.attachmentData,
      items: cleanedPaidItems.length ? cleanedPaidItems : update.items || [],
      employeeName: update.employeeName,
      source: update.source,
      note: update.note,
      sourceType: "PENDING_SETTLEMENT",
      status: nextStatus === "PENDING" ? "PARTIAL" : "LOGGED",
      createdAt: nowIso
    });
  
    res.json({ ok: true, remainingAmount, status: nextStatus });
  },

    handle5: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const ticketsCol = repository.expenseTickets();
    const ticket = await ticketsCol.findOne({ id });
    if (!ticket) return res.status(404).json({ message: "Expense ticket not found" });
    if (ticket.status !== "PENDING") return res.status(400).json({ message: "Only pending tickets can be deleted" });
  
    const nowIso = new Date().toISOString();
    await ticketsCol.updateOne(
      { id },
      { $set: { status: "DELETED", deletedAt: nowIso, deletedBy: req.user.id, updatedAt: nowIso } }
    );
    res.json({ ok: true });
  },

    handle6: async (req, res) => {
    if (req.user?.role !== "BRANCH") {
      return res.status(403).json({ message: "Branch role required" });
    }
    const { items, paymentMethod, amount, date } = req.body;
    const normalizedPayment = String(paymentMethod || "").trim();
    const normalizedDate = String(date || "").trim();
    const normalizedAmount = Number(amount || 0);
    const cleanedItems = Array.isArray(items)
      ? items
          .map((row) => ({
            name: String(row.name || "").trim(),
            qty: Number(row.qty || 0),
            unitPrice: Number(row.unitPrice || 0)
          }))
          .filter((row) => row.name && row.qty > 0)
      : [];
  
    if (!cleanedItems.length) return res.status(400).json({ message: "At least one item is required" });
    if (!normalizedPayment) return res.status(400).json({ message: "Payment method is required" });
    if (!normalizedDate) return res.status(400).json({ message: "Date is required" });
    if (normalizedAmount <= 0) return res.status(400).json({ message: "Amount must be greater than zero" });
  
    const ticketsCol = repository.expenseTickets();
    const logsCol = repository.expenseTicketLogs();
    const ticket = {
      id: uuidv4(),
      category: "Branch Expense",
      branchId: req.user.branchId,
      assignee: "",
      paymentMethod: normalizedPayment,
      amount: normalizedAmount,
      date: normalizedDate,
      attachmentName: "",
      attachmentType: "",
      attachmentData: "",
      items: cleanedItems,
      employeeName: "",
      source: "",
      note: "",
      status: "LOGGED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await ticketsCol.insertOne(ticket);
  
    await insertExpenseLog(logsCol, {
      id: uuidv4(),
      ticketId: ticket.id,
      branchId: ticket.branchId,
      category: ticket.category,
      assignee: ticket.assignee,
      paymentMethod: ticket.paymentMethod,
      amount: ticket.amount,
      date: ticket.date,
      attachmentName: ticket.attachmentName,
      attachmentType: ticket.attachmentType,
      attachmentData: ticket.attachmentData,
      items: ticket.items || [],
      employeeName: ticket.employeeName,
      source: ticket.source,
      note: ticket.note,
      status: ticket.status,
      createdAt: ticket.createdAt
    });
  
    const branchDoc = await repository.branches().findOne({ id: ticket.branchId });
    const branchName = branchDoc?.name || ticket.branchId;
    const itemLines = (ticket.items || []).map((row) => `- ${row.name} (${row.qty})`).join("\n");
    const slackMessage = [
      `Branch expense logged: ${branchName}`,
      `Date: ${ticket.date}`,
      `Amount: Rs ${Number(ticket.amount || 0).toFixed(2)}`,
      `Payment: ${ticket.paymentMethod || "N/A"}`,
      itemLines ? `Items:\n${itemLines}` : "Items: None"
    ].join("\n");
    sendSlackWebhook(slackMessage);
  
    res.status(201).json({ ok: true, ticketId: ticket.id });
  },

    handle7: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const startDate = String(req.query.startDate || "").trim();
    const filter = startDate ? { date: { $gte: startDate } } : {};
    const logs = await repository.expenseTicketLogs()
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();
    res.json(logs);
  },

    handle8: async (req, res) => {
    if (req.user?.role !== "BRANCH") {
      return res.status(403).json({ message: "Branch role required" });
    }
    const date = String(req.query.date || formatDateLocal(new Date())).trim();
    const logs = await repository.expenseTicketLogs()
      .find({ branchId: req.user.branchId, category: "Branch Expense", date, status: { $ne: "DELETED" } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(logs);
  },

    handle9: async (req, res) => {
    if (req.user?.role !== "BRANCH") {
      return res.status(403).json({ message: "Branch role required" });
    }
    const { id } = req.params;
    const { items, paymentMethod, amount, date } = req.body || {};
    const normalizedPayment = String(paymentMethod || "").trim();
    const normalizedDate = String(date || "").trim();
    const normalizedAmount = Number(amount || 0);
    const cleanedItems = Array.isArray(items)
      ? items
          .map((row) => ({
            name: String(row.name || "").trim(),
            qty: Number(row.qty || 0),
            unitPrice: Number(row.unitPrice || 0)
          }))
          .filter((row) => row.name && row.qty > 0)
      : [];
  
    if (!cleanedItems.length) return res.status(400).json({ message: "At least one item is required" });
    if (!normalizedPayment) return res.status(400).json({ message: "Payment method is required" });
    if (!normalizedDate) return res.status(400).json({ message: "Date is required" });
    if (normalizedAmount <= 0) return res.status(400).json({ message: "Amount must be greater than zero" });
  
    const ticketsCol = repository.expenseTickets();
    const logsCol = repository.expenseTicketLogs();
    const ticket = await ticketsCol.findOne({ id, branchId: req.user.branchId, category: "Branch Expense" });
    if (!ticket) return res.status(404).json({ message: "Expense ticket not found" });
    if (ticket.status === "DELETED") return res.status(400).json({ message: "Ticket already deleted" });
  
    const createdAt = new Date(ticket.createdAt || 0).getTime();
    const elapsedMs = Date.now() - createdAt;
    if (!(elapsedMs >= 0 && elapsedMs <= 60 * 60 * 1000)) {
      return res.status(400).json({ message: "Editing window has expired" });
    }
  
    const update = {
      paymentMethod: normalizedPayment,
      amount: normalizedAmount,
      date: normalizedDate,
      items: cleanedItems,
      updatedAt: new Date().toISOString()
    };
  
    await ticketsCol.updateOne({ id }, { $set: update });
    await updateExpenseLog(logsCol, 
      { ticketId: id },
      {
        $set: {
          paymentMethod: update.paymentMethod,
          amount: update.amount,
          date: update.date,
          items: update.items,
          updatedAt: update.updatedAt
        }
      }
    );
  
    const branchDoc = await repository.branches().findOne({ id: ticket.branchId });
    const branchName = branchDoc?.name || ticket.branchId;
    const itemLines = update.items.map((row) => `- ${row.name} (${row.qty})`).join("\n");
    const slackMessage = [
      `Branch expense updated: ${branchName}`,
      `Date: ${update.date}`,
      `Amount: Rs ${Number(update.amount || 0).toFixed(2)}`,
      `Payment: ${update.paymentMethod || "N/A"}`,
      itemLines ? `Items:\n${itemLines}` : "Items: None",
      `Ticket ID: ${id}`
    ].join("\n");
    sendSlackWebhook(slackMessage);
  
    res.json({ ok: true });
  },

    handle10: async (req, res) => {
    if (req.user?.role !== "BRANCH") {
      return res.status(403).json({ message: "Branch role required" });
    }
    const { id } = req.params;
    const ticketsCol = repository.expenseTickets();
    const logsCol = repository.expenseTicketLogs();
    const ticket = await ticketsCol.findOne({ id, branchId: req.user.branchId, category: "Branch Expense" });
    if (!ticket) return res.status(404).json({ message: "Expense ticket not found" });
    if (ticket.status === "DELETED") return res.status(400).json({ message: "Ticket already deleted" });
  
    const createdAt = new Date(ticket.createdAt || 0).getTime();
    const elapsedMs = Date.now() - createdAt;
    if (!(elapsedMs >= 0 && elapsedMs <= 60 * 60 * 1000)) {
      return res.status(400).json({ message: "Delete window has expired" });
    }
  
    const nowIso = new Date().toISOString();
    await ticketsCol.updateOne(
      { id },
      { $set: { status: "DELETED", deletedAt: nowIso, deletedBy: req.user.id, updatedAt: nowIso } }
    );
    await updateExpenseLog(logsCol, 
      { ticketId: id },
      { $set: { status: "DELETED", deletedAt: nowIso, deletedBy: req.user.id, updatedAt: nowIso } }
    );
  
    const branchDoc = await repository.branches().findOne({ id: ticket.branchId });
    const branchName = branchDoc?.name || ticket.branchId;
    const slackMessage = [
      `Branch expense deleted: ${branchName}`,
      `Date: ${ticket.date}`,
      `Amount: Rs ${Number(ticket.amount || 0).toFixed(2)}`,
      `Payment: ${ticket.paymentMethod || "N/A"}`,
      `Ticket ID: ${id}`
    ].join("\n");
    sendSlackWebhook(slackMessage);
  
    res.json({ ok: true });
  }
  };
}



