import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../components/Modal";

const ASSIGNEES = ["Vivek", "Harman", "Bhashit"];
const PAYMENT_METHODS = ["UPI", "Cash", "Paid by assignee"];
const EXPENSE_CATEGORIES = ["Rent", "Electricity Bill", "Salary", "Food Expense", "Ice Cream", "Other", "Purchase"];
const EXPENSE_PAYMENT_METHODS = ["UPI", "Cash", "Paid by assignee"];

function Tickets({ reportStartDate = "", reportRefreshKey = 0 }) {
  const [branches, setBranches] = useState([]);
  const [inventoryMap, setInventoryMap] = useState(new Map());
  const [tickets, setTickets] = useState([]);
  const [ticketItems, setTicketItems] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [expandedExpenseId, setExpandedExpenseId] = useState(null);
  const [expenseBranchId, setExpenseBranchId] = useState("");
  const [expenseAssignee, setExpenseAssignee] = useState("");
  const [expensePayment, setExpensePayment] = useState("");
  const [expenseType, setExpenseType] = useState("");
  const [expenseLogsPage, setExpenseLogsPage] = useState(1);
  const [activeTicket, setActiveTicket] = useState(null);
  const [assignee, setAssignee] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [editableItems, setEditableItems] = useState([]);
  const [errorBanner, setErrorBanner] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTicket, setDeleteTicket] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingPayments, setPendingPayments] = useState([]);
  const [pendingActive, setPendingActive] = useState(null);
  const [pendingCategory, setPendingCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [pendingBranchId, setPendingBranchId] = useState("");
  const [pendingAssignee, setPendingAssignee] = useState("");
  const [pendingPaymentMethod, setPendingPaymentMethod] = useState("");
  const [pendingAmount, setPendingAmount] = useState("");
  const [pendingDate, setPendingDate] = useState("");
  const [pendingAttachmentName, setPendingAttachmentName] = useState("");
  const [pendingAttachmentType, setPendingAttachmentType] = useState("");
  const [pendingAttachmentData, setPendingAttachmentData] = useState("");
  const [pendingAttachmentKey, setPendingAttachmentKey] = useState(0);
  const [pendingEmployeeName, setPendingEmployeeName] = useState("");
  const [pendingSource, setPendingSource] = useState("");
  const [pendingNote, setPendingNote] = useState("");
  const [pendingItems, setPendingItems] = useState([]);
  const [pendingAmountPaid, setPendingAmountPaid] = useState("");
  const [pendingErrorBanner, setPendingErrorBanner] = useState("");
  const [pendingSuccessBanner, setPendingSuccessBanner] = useState("");
  const [isPendingSubmitting, setIsPendingSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isPendingDeleting, setIsPendingDeleting] = useState(false);

  useEffect(() => {
    loadBranches();
    loadTickets();
    loadInventory();
    loadPendingPayments();
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [reportStartDate, reportRefreshKey]);

  const loadBranches = async () => {
    const res = await axios.get("/api/branches");
    setBranches(res.data || []);
  };

  const loadTickets = async () => {
    try {
      const res = await axios.get("/api/tickets", { params: { status: "OPEN" } });
      setTickets(res.data.tickets || []);
      setTicketItems(res.data.items || []);
      setErrorBanner("");
    } catch (err) {
      setErrorBanner("Failed to load tickets.");
    }
  };

  const loadPendingPayments = async () => {
    try {
      const res = await axios.get("/api/expense-tickets", { params: { status: "PENDING" } });
      setPendingPayments(res.data || []);
      setPendingErrorBanner("");
    } catch (err) {
      setPendingErrorBanner("Failed to load pending payments.");
    }
  };

  const loadExpenses = async () => {
    const params = reportStartDate ? { startDate: reportStartDate } : undefined;
    const res = await axios.get("/api/tickets/expenses", { params });
    setExpenses(res.data || []);
  };


  const loadInventory = async () => {
    const res = await axios.get("/api/central-inventory");
    const map = new Map();
    (res.data?.rows || []).forEach((row) => {
      map.set(row.itemId, Number(row.onHand || 0));
    });
    setInventoryMap(map);
  };

  const lookupBranchName = (id) => {
    const name = branches.find((b) => b.id === id)?.name || id;
    return name.replace(/^foffee\s+/i, "");
  };

  const ticketsWithItems = useMemo(() => {
    const map = new Map();
    ticketItems.forEach((item) => {
      if (!map.has(item.ticketId)) map.set(item.ticketId, []);
      map.get(item.ticketId).push(item);
    });
    return tickets.map((ticket) => ({
      ...ticket,
      items: map.get(ticket.id) || []
    }));
  }, [tickets, ticketItems]);

  const ticketHasRemaining = (ticket) =>
    (ticket.items || []).some((item) => Number(item.requestedQty || 0) > 0 && Number(item.approvedQty || 0) === 0);

  const filteredExpenses = useMemo(() => {
    return [...expenses]
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .filter((log) => {
        if (expenseBranchId && log.branchId !== expenseBranchId) return false;
        if (expenseAssignee && log.assignee !== expenseAssignee) return false;
        if (expensePayment && log.paymentMethod !== expensePayment) return false;
        if (expenseType && (log.type || "DAILY") !== expenseType) return false;
        return true;
      });
  }, [expenses, expenseBranchId, expenseAssignee, expensePayment, expenseType]);

  const expenseLogsPageSize = 5;
  const expenseLogsTotalPages = Math.max(1, Math.ceil(filteredExpenses.length / expenseLogsPageSize));
  const expenseLogsStartIndex = (expenseLogsPage - 1) * expenseLogsPageSize;
  const pagedExpenseLogs = filteredExpenses.slice(expenseLogsStartIndex, expenseLogsStartIndex + expenseLogsPageSize);

  useEffect(() => {
    setExpenseLogsPage(1);
  }, [expenseBranchId, expenseAssignee, expensePayment, expenseType]);

  useEffect(() => {
    setExpenseLogsPage((prev) => Math.min(prev, expenseLogsTotalPages));
  }, [expenseLogsTotalPages]);


  const openTicket = (ticket) => {
    setActiveTicket(ticket);
    setAssignee(ticket.assignee || "");
    setPaymentMethod(ticket.paymentMethod || "");
    setEditableItems(ticket.items.map((it) => ({ ...it })));
  };

  const closeModal = () => {
    if (isSubmitting) return;
    setActiveTicket(null);
  };

  const openDeleteModal = (ticket) => {
    setDeleteTicket(ticket);
    setDeleteReason("");
  };

  const closeDeleteModal = () => {
    if (isDeleting) return;
    setDeleteTicket(null);
    setDeleteReason("");
  };

  const timeSince = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m`;
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h`;
  };

  const updateItem = (id, field, value) => {
    setEditableItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, [field]: value };
        if (field === "approvedQty" || field === "unitPrice") {
          next[field] = Number(value || 0);
        }
        return next;
      })
    );
  };

  const total = editableItems.reduce((sum, item) => {
    if (item.fromStock) return sum;
    return sum + (item.approvedQty || 0) * (item.unitPrice || 0);
  }, 0);
  const requestTotal = editableItems.reduce((sum, item) => sum + (item.approvedQty || 0) * (item.unitPrice || 0), 0);

  const canUseStock = (item) => {
    const onHand = inventoryMap.get(item.itemId) || 0;
    return onHand > 0 && Number(item.approvedQty || 0) <= onHand;
  };

  const completeTicket = async () => {
    if (!activeTicket) return;
    if (!paymentMethod) {
      setErrorBanner("Payment method is required to close a ticket.");
      return;
    }
    try {
      setIsSubmitting(true);
      await axios.post(`/api/tickets/${activeTicket.id}/done`, {
        assignee,
        paymentMethod,
        items: editableItems.map((item) => ({
          id: item.id,
          approvedQty: Number(item.approvedQty || 0),
          unitPrice: Number(item.unitPrice || 0),
          fromStock: !!item.fromStock
        }))
      });
      setActiveTicket(null);
      await loadTickets();
      await loadExpenses();
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasRemainingItems = editableItems.some((item) => Number(item.requestedQty || 0) > 0 && Number(item.approvedQty || 0) === 0);

  const partialSubmit = async () => {
    if (!activeTicket) return;
    if (!paymentMethod) {
      setErrorBanner("Payment method is required to close a ticket.");
      return;
    }
    try {
      setIsSubmitting(true);
      await axios.post(`/api/tickets/${activeTicket.id}/partial`, {
        assignee,
        paymentMethod,
        items: editableItems.map((item) => ({
          id: item.id,
          approvedQty: Number(item.approvedQty || 0),
          unitPrice: Number(item.unitPrice || 0),
          fromStock: !!item.fromStock
        }))
      });
      setActiveTicket(null);
      await loadTickets();
      await loadExpenses();
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTicket || !deleteReason) return;
    try {
      setIsDeleting(true);
      await axios.post(`/api/tickets/${deleteTicket.id}/delete`, { reason: deleteReason });
      setDeleteTicket(null);
      setDeleteReason("");
      await loadTickets();
    } finally {
      setIsDeleting(false);
    }
  };

  const openPendingModal = (ticket) => {
    setPendingActive(ticket);
    setPendingCategory(ticket.category || EXPENSE_CATEGORIES[0]);
    setPendingBranchId(ticket.branchId || "");
    setPendingAssignee(ticket.assignee || "");
    setPendingPaymentMethod(ticket.paymentMethod || "");
    const initialItems = Array.isArray(ticket.items)
      ? ticket.items.map((row) => ({
          name: row.name || "",
          qty: Number(row.qty || 0),
          unitPrice: Number(row.unitPrice || 0),
          paid: true
        }))
      : [];
    setPendingAmount(String(ticket.amount ?? ""));
    setPendingDate(ticket.date || "");
    setPendingAttachmentName(ticket.attachmentName || "");
    setPendingAttachmentType(ticket.attachmentType || "");
    setPendingAttachmentData(ticket.attachmentData || "");
    setPendingAttachmentKey((value) => value + 1);
    setPendingEmployeeName(ticket.employeeName || "");
    setPendingSource(ticket.source || "");
    setPendingNote(ticket.note || "");
    setPendingItems(initialItems);
    setPendingAmountPaid("");
    setPendingErrorBanner("");
    setPendingSuccessBanner("");
  };

  const closePendingModal = () => {
    if (isPendingSubmitting) return;
    setPendingActive(null);
  };

  const openPendingDeleteModal = (ticket) => {
    setPendingDelete(ticket);
  };

  const closePendingDeleteModal = () => {
    if (isPendingDeleting) return;
    setPendingDelete(null);
  };

  const handlePendingAttachmentChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setPendingAttachmentName("");
      setPendingAttachmentType("");
      setPendingAttachmentData("");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setPendingErrorBanner("Attachment must be under 2 MB.");
      event.target.value = "";
      setPendingAttachmentName("");
      setPendingAttachmentType("");
      setPendingAttachmentData("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPendingAttachmentName(file.name);
      setPendingAttachmentType(file.type);
      setPendingAttachmentData(String(reader.result || ""));
    };
    reader.onerror = () => {
      setPendingErrorBanner("Could not read attachment.");
      setPendingAttachmentName("");
      setPendingAttachmentType("");
      setPendingAttachmentData("");
    };
    reader.readAsDataURL(file);
  };

  const pendingShowEmployee = pendingCategory === "Salary";
  const pendingShowSource = pendingCategory === "Food Expense";
  const pendingShowNote = pendingCategory === "Other";
  const pendingShowItems = pendingCategory === "Purchase";

  const pendingItemsTotal = useMemo(() => {
    if (!pendingShowItems) return Number(pendingAmount || 0);
    const computed = pendingItems.reduce((sum, row) => sum + Number(row.qty || 0) * Number(row.unitPrice || 0), 0);
    return computed > 0 ? computed : Number(pendingAmount || 0);
  }, [pendingShowItems, pendingItems, pendingAmount]);

  const pendingPaidTotal = useMemo(() => {
    if (!pendingShowItems) return Number(pendingAmountPaid || 0);
    return pendingItems.reduce((sum, row) => (row.paid ? sum + Number(row.qty || 0) * Number(row.unitPrice || 0) : sum), 0);
  }, [pendingShowItems, pendingItems, pendingAmountPaid]);

  const pendingRemainingTotal = useMemo(() => {
    if (!pendingShowItems) return Math.max(0, Number(pendingAmount || 0) - Number(pendingAmountPaid || 0));
    return pendingItems.reduce((sum, row) => (!row.paid ? sum + Number(row.qty || 0) * Number(row.unitPrice || 0) : sum), 0);
  }, [pendingShowItems, pendingItems, pendingAmount, pendingAmountPaid]);

  const pendingCanSave = useMemo(() => {
    if (!pendingBranchId || !pendingAssignee || !pendingDate) return false;
    if (Number(pendingItemsTotal || 0) <= 0) return false;
    if (pendingShowEmployee && !pendingEmployeeName.trim()) return false;
    if (pendingShowSource && !pendingSource.trim()) return false;
    return true;
  }, [pendingBranchId, pendingAssignee, pendingDate, pendingItemsTotal, pendingShowEmployee, pendingEmployeeName, pendingShowSource, pendingSource]);

  const pendingCanPay = useMemo(() => {
    if (!pendingCanSave) return false;
    if (!pendingPaymentMethod) return false;
    const paid = Number(pendingPaidTotal || 0);
    if (paid <= 0) return false;
    if (paid > Number(pendingItemsTotal || 0)) return false;
    return true;
  }, [pendingCanSave, pendingPaymentMethod, pendingPaidTotal, pendingItemsTotal]);

  const pendingHasRemaining = useMemo(() => {
    if (!pendingShowItems) return false;
    return pendingItems.some((row) => !row.paid);
  }, [pendingShowItems, pendingItems]);

  const pendingIsFullyPaid = useMemo(() => {
    if (pendingShowItems) return !pendingHasRemaining;
    return Number(pendingAmountPaid || 0) >= Number(pendingAmount || 0);
  }, [pendingShowItems, pendingHasRemaining, pendingAmountPaid, pendingAmount]);

  const updatePendingItemPrice = (index, value) => {
    setPendingItems((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        return { ...row, unitPrice: Number(value || 0) };
      })
    );
  };

  const updatePendingItemPaid = (index, checked) => {
    setPendingItems((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        return { ...row, paid: checked };
      })
    );
  };

  const savePendingChanges = async () => {
    if (!pendingActive || !pendingCanSave) return;
    try {
      setIsPendingSubmitting(true);
      await axios.post(`/api/expense-tickets/${pendingActive.id}/update`, {
        category: pendingCategory,
        branchId: pendingBranchId,
        assignee: pendingAssignee,
        paymentMethod: pendingPaymentMethod,
        amount: Number(pendingItemsTotal || 0),
        date: pendingDate,
        attachmentName: pendingAttachmentName,
        attachmentType: pendingAttachmentType,
        attachmentData: pendingAttachmentData,
        items: pendingItems.map((row) => ({
          name: row.name,
          qty: Number(row.qty || 0),
          unitPrice: Number(row.unitPrice || 0)
        })),
        employeeName: pendingEmployeeName,
        source: pendingSource,
        note: pendingNote
      });
      setPendingSuccessBanner("Pending payment updated.");
      await loadPendingPayments();
    } catch (err) {
      setPendingErrorBanner("Could not update pending payment.");
    } finally {
      setIsPendingSubmitting(false);
    }
  };

  const submitPendingPayment = async () => {
    if (!pendingActive || !pendingCanPay) return;
    try {
      setIsPendingSubmitting(true);
      const paidItems = pendingItems.filter((row) => row.paid);
      const remainingItems = pendingItems.filter((row) => !row.paid);
      const res = await axios.post(`/api/expense-tickets/${pendingActive.id}/partial`, {
        category: pendingCategory,
        branchId: pendingBranchId,
        assignee: pendingAssignee,
        paymentMethod: pendingPaymentMethod,
        amount: Number(pendingItemsTotal || 0),
        date: pendingDate,
        attachmentName: pendingAttachmentName,
        attachmentType: pendingAttachmentType,
        attachmentData: pendingAttachmentData,
        items: remainingItems.map((row) => ({
          name: row.name,
          qty: Number(row.qty || 0),
          unitPrice: Number(row.unitPrice || 0)
        })),
        paidItems: paidItems.map((row) => ({
          name: row.name,
          qty: Number(row.qty || 0),
          unitPrice: Number(row.unitPrice || 0)
        })),
        employeeName: pendingEmployeeName,
        source: pendingSource,
        note: pendingNote,
        amountPaid: Number(pendingPaidTotal || 0)
      });
      setPendingSuccessBanner("Payment logged.");
      setPendingAmountPaid("");
      await loadPendingPayments();
      if (Number(res.data?.remainingAmount || 0) <= 0) {
        setPendingActive(null);
      }
    } catch (err) {
      setPendingErrorBanner("Could not log payment.");
    } finally {
      setIsPendingSubmitting(false);
    }
  };

  const confirmPendingDelete = async () => {
    if (!pendingDelete) return;
    try {
      setIsPendingDeleting(true);
      await axios.post(`/api/expense-tickets/${pendingDelete.id}/delete`);
      setPendingDelete(null);
      await loadPendingPayments();
    } finally {
      setIsPendingDeleting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {errorBanner && (
        <div className="banner banner--warning">
          <strong>Warning:</strong> {errorBanner}
        </div>
      )}

      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="section-title">Tickets</h3>
            <p className="muted-text">Review daily and other requests coming from branch.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={loadTickets}>
            Refresh
          </button>
        </div>
        {ticketsWithItems.length === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No open tickets.</p>}
        <div className="tickets-grid" style={{ marginTop: "1rem" }}>
          {ticketsWithItems.map((ticket) => (
            <div
              key={ticket.id}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "1rem",
                padding: "0.75rem 1rem",
                background: "#f8fafc",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "0.75rem"
              }}
            >
              <div>
                <strong>{lookupBranchName(ticket.branchId)}</strong>
                <div className="muted-text">
                  {ticket.requestDate} · {timeSince(ticket.createdAt)} ago
                </div>
              </div>
              <div className="muted-text">
                {ticketHasRemaining(ticket) && <span className="stats-pill" style={{ marginLeft: "0.5rem" }}>P</span>}
                {ticket.type === "OTHER" && <span className="stats-pill" style={{ marginLeft: "0.5rem" }}>O</span>}
                {ticket.assignee && <span style={{ marginLeft: "0.5rem" }}>{ticket.assignee}</span>}
              </div>
              <div className="ticket-card__actions">
                <button className="btn btn-secondary ticket-card__btn" type="button" onClick={() => openDeleteModal(ticket)}>
                  DEL
                </button>
                <button className="btn btn-primary ticket-card__btn" type="button" onClick={() => openTicket(ticket)}>
                  MORE
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h4 className="section-title">Pending Payments</h4>
            <p className="muted-text">Expense tickets awaiting payment confirmation.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={loadPendingPayments}>
            Refresh
          </button>
        </div>
        {pendingErrorBanner && (
          <div className="banner banner--warning" style={{ marginTop: "0.75rem" }}>
            <strong>Warning:</strong> {pendingErrorBanner}
          </div>
        )}
        {pendingSuccessBanner && (
          <div className="banner banner--success" style={{ marginTop: "0.75rem" }}>
            <strong>Success:</strong> {pendingSuccessBanner}
          </div>
        )}
        {pendingPayments.length === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No pending payments.</p>}
        <div className="tickets-grid" style={{ marginTop: "1rem" }}>
          {pendingPayments.map((ticket) => (
            <div
              key={ticket.id}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "1rem",
                padding: "0.75rem 1rem",
                background: "#f8fafc",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "0.75rem"
              }}
            >
              <div>
                <strong>{lookupBranchName(ticket.branchId)}</strong>
                <div className="muted-text">
                  {ticket.date || ticket.requestDate} Â· {ticket.createdAt ? `${timeSince(ticket.createdAt)} ago` : ""}
                </div>
              </div>
              <div className="muted-text">
                {ticket.category && <span className="stats-pill" style={{ marginLeft: "0.5rem" }}>{ticket.category}</span>}
                <span style={{ marginLeft: "0.5rem" }}>Rs {Number(ticket.amount || 0).toFixed(2)}</span>
                {ticket.assignee && <span style={{ marginLeft: "0.5rem" }}>{ticket.assignee}</span>}
              </div>
              <div className="ticket-card__actions">
                <button className="btn btn-secondary ticket-card__btn" type="button" onClick={() => openPendingDeleteModal(ticket)}>
                  DEL
                </button>
                <button className="btn btn-primary ticket-card__btn" type="button" onClick={() => openPendingModal(ticket)}>
                  MORE
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h4 className="section-title">Ticket Logs</h4>
            <p className="muted-text">Complete tickets logs.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={loadExpenses}>
            Refresh
          </button>
        </div>
        <div
          style={{
            marginTop: "0.75rem",
            display: "flex",
            gap: "0.75rem",
            flexWrap: "nowrap",
            alignItems: "center",
            background: "#f8fafc",
            padding: "0.75rem",
            borderRadius: "0.75rem",
            border: "1px solid #e2e8f0",
            overflowX: "auto"
          }}
        >
          <strong style={{ fontSize: "0.85rem", color: "#475569" }}>Filters</strong>
          <select value={expenseBranchId} onChange={(e) => setExpenseBranchId(e.target.value)} style={{ minWidth: 180 }}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select value={expenseAssignee} onChange={(e) => setExpenseAssignee(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">All assignees</option>
            {ASSIGNEES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select value={expensePayment} onChange={(e) => setExpensePayment(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">All payments</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
          <select value={expenseType} onChange={(e) => setExpenseType(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Ticket Type</option>
            <option value="DAILY">Daily</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        {filteredExpenses.length === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No expenses logged yet.</p>}
        <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
          {pagedExpenseLogs.map((log) => {
            const isOpen = expandedExpenseId === log.id;
            return (
              <div
                key={log.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "1rem",
                  padding: "0.75rem 1rem",
                  background: "#f8fafc"
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedExpenseId(isOpen ? null : log.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "1rem",
                    fontWeight: 600,
                    color: "#0f172a"
                  }}
                >
                  <span>
                    {lookupBranchName(log.branchId)} · {log.requestDate} · {log.assignee || "Unassigned"} · {log.paymentMethod || "No payment method"}
                  </span>
                  <span>TRC Rs {Number(log.requestTotal || log.total || 0).toFixed(2)} {isOpen ? "v" : "+"}</span>
                </button>
                {isOpen && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontWeight: 600 }}>
                      <span>Paid Rs {Number(log.total || 0).toFixed(2)}</span>
                      <span>{log.completedAt ? new Date(log.completedAt).toLocaleString() : ""}</span>
                    </div>
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Requested</th>
                            <th>Approved</th>
                            <th>Price</th>
                            <th>From Stock</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(log.items || []).map((item) => (
                            <tr key={`${log.id}-${item.itemId}`}>
                              <td>{item.itemName}</td>
                              <td>{item.requestedQty}</td>
                              <td>{item.approvedQty}</td>
                              <td>Rs {Number(item.unitPrice || 0).toFixed(2)}</td>
                              <td>{item.fromStock ? "Yes" : "No"}</td>
                              <td>Rs {Number((item.approvedQty || 0) * (item.unitPrice || 0)).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {filteredExpenses.length > expenseLogsPageSize && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setExpenseLogsPage((prev) => Math.max(1, prev - 1))}
              disabled={expenseLogsPage === 1}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setExpenseLogsPage((prev) => Math.min(expenseLogsTotalPages, prev + 1))}
              disabled={expenseLogsPage === expenseLogsTotalPages}
            >
              Next
            </button>
          </div>
        )}
      </section>

      <Modal
        open={!!deleteTicket}
        title="Delete ticket?"
        onClose={closeDeleteModal}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeDeleteModal} disabled={isDeleting}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmDelete} disabled={!deleteReason || isDeleting}>
              {isDeleting ? "Deleting..." : "Confirm Delete"}
            </button>
          </>
        }
      >
        <p className="muted-text" style={{ marginBottom: "1rem" }}>
          This will remove the ticket from the open list. Please select a reason.
        </p>
        <label className="muted-text" htmlFor="delete-reason" style={{ display: "block", marginBottom: "0.4rem" }}>
          Reason
        </label>
        <select
          id="delete-reason"
          value={deleteReason}
          onChange={(e) => setDeleteReason(e.target.value)}
          style={{ minWidth: 220 }}
        >
          <option value="">Select a reason</option>
          <option value="duplicate">Duplicate</option>
          <option value="wrong">Wrong</option>
          <option value="stale">Stale</option>
        </select>
      </Modal>

      <Modal
        open={!!pendingDelete}
        title="Delete pending payment?"
        onClose={closePendingDeleteModal}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={closePendingDeleteModal} disabled={isPendingDeleting}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmPendingDelete} disabled={isPendingDeleting}>
              {isPendingDeleting ? "Deleting..." : "Confirm Delete"}
            </button>
          </>
        }
      >
        <p className="muted-text">
          This will remove the pending payment from the list.
        </p>
      </Modal>

      <Modal
        open={!!pendingActive}
        title={
          pendingActive
            ? `${pendingActive.category || "Expense"} · ${lookupBranchName(pendingActive.branchId)} · ${
                pendingActive.createdAt ? new Date(pendingActive.createdAt).toLocaleDateString() : pendingActive.date
              }`
            : "Pending Payment"
        }
        onClose={closePendingModal}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={closePendingModal} disabled={isPendingSubmitting}>
              Cancel
            </button>
            <button type="button" className="btn btn-secondary" onClick={savePendingChanges} disabled={!pendingCanSave || isPendingSubmitting}>
              {isPendingSubmitting ? "Saving..." : "Save Changes"}
            </button>
            {pendingShowItems ? (
              pendingHasRemaining ? (
                <button type="button" className="btn btn-primary" onClick={submitPendingPayment} disabled={!pendingCanPay || isPendingSubmitting}>
                  {isPendingSubmitting ? "Saving..." : "Partial Submit"}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={submitPendingPayment} disabled={!pendingCanPay || isPendingSubmitting}>
                  {isPendingSubmitting ? "Saving..." : "Submit"}
                </button>
              )
            ) : pendingIsFullyPaid ? (
              <button type="button" className="btn btn-primary" onClick={submitPendingPayment} disabled={!pendingCanPay || isPendingSubmitting}>
                {isPendingSubmitting ? "Saving..." : "Submit"}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={submitPendingPayment} disabled={!pendingCanPay || isPendingSubmitting}>
                {isPendingSubmitting ? "Saving..." : "Partial Submit"}
              </button>
            )}
          </>
        }
      >
        {pendingActive && (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <label>
              <span className="muted-text field-label">Assignee</span>
              <select value={pendingAssignee} onChange={(e) => setPendingAssignee(e.target.value)}>
                <option value="">Select</option>
                {ASSIGNEES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="muted-text field-label">Payment Method</span>
              <select value={pendingPaymentMethod} onChange={(e) => setPendingPaymentMethod(e.target.value)}>
                <option value="">Select</option>
                {EXPENSE_PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>


            {pendingShowItems && (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingItems.map((row, index) => (
                      <tr key={`${row.name}-${index}`}>
                        <td>
                          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <input
                              type="checkbox"
                              checked={!!row.paid}
                              onChange={(e) => updatePendingItemPaid(index, e.target.checked)}
                            />
                            <span>{row.name}</span>
                          </label>
                        </td>
                        <td>{row.qty}</td>
                        <td>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            value={Number(row.unitPrice || 0)}
                            onChange={(e) => updatePendingItemPrice(index, e.target.value)}
                            style={{ width: "6rem" }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="muted-text" style={{ marginTop: "0.5rem" }}>
                  Pending total: Rs {Number(pendingItemsTotal || 0).toFixed(2)}
                </div>
              </div>
            )}

            {!pendingShowItems && (
              <label>
                <span className="muted-text field-label">Pending Amount (Rs)</span>
                <input className="input" type="number" min={0} value={pendingAmount} readOnly />
              </label>
            )}

            {pendingShowEmployee && (
              <label>
                <span className="muted-text field-label">Employee Name</span>
                <input className="input" type="text" value={pendingEmployeeName} onChange={(e) => setPendingEmployeeName(e.target.value)} />
              </label>
            )}

            {pendingShowSource && (
              <label>
                <span className="muted-text field-label">Source</span>
                <input className="input" type="text" value={pendingSource} onChange={(e) => setPendingSource(e.target.value)} />
              </label>
            )}

            {pendingShowNote && (
              <label>
                <span className="muted-text field-label">Note</span>
                <input className="input" type="text" value={pendingNote} onChange={(e) => setPendingNote(e.target.value)} />
              </label>
            )}

            <label>
              <span className="muted-text field-label">Attachment (optional)</span>
              <input
                key={pendingAttachmentKey}
                className="input"
                type="file"
                accept="image/*,application/pdf"
                onChange={handlePendingAttachmentChange}
              />
              {pendingAttachmentName && (
                <span className="muted-text">
                  Selected:{" "}
                  {pendingAttachmentData ? (
                    <a href={pendingAttachmentData} download={pendingAttachmentName}>
                      {pendingAttachmentName}
                    </a>
                  ) : (
                    pendingAttachmentName
                  )}
                </span>
              )}
            </label>

            {pendingShowItems ? (
              <label>
                <span className="muted-text field-label">Payment Amount (Rs)</span>
                <input className="input" type="number" min={0} value={Number(pendingPaidTotal || 0).toFixed(2)} readOnly />
                <span className="muted-text">Remaining: Rs {Number(pendingRemainingTotal || 0).toFixed(2)}</span>
              </label>
            ) : (
              <label>
                <span className="muted-text field-label">Payment Amount (Rs)</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={pendingAmountPaid}
                  onChange={(e) => setPendingAmountPaid(e.target.value)}
                />
                <span className="muted-text">Remaining: Rs {Number(pendingRemainingTotal || 0).toFixed(2)}</span>
              </label>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!activeTicket}
        title={activeTicket ? `${lookupBranchName(activeTicket.branchId)} · ${activeTicket.requestDate}` : "Ticket"}
        onClose={closeModal}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeModal} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="button" className="btn btn-secondary" onClick={partialSubmit} disabled={isSubmitting || !paymentMethod || !hasRemainingItems}>
              {isSubmitting ? "Saving..." : "Partial Submit"}
            </button>
            {!hasRemainingItems && (
              <button type="button" className="btn btn-primary" onClick={completeTicket} disabled={isSubmitting || !paymentMethod}>
                {isSubmitting ? "Saving..." : "Done"}
              </button>
            )}
          </>
        }
      >
        {activeTicket && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div className="muted-text">Raised {timeSince(activeTicket.createdAt)} ago</div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Requested</th>
                    <th>Approved</th>
                    <th>From Stock</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {editableItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.itemName}</td>
                      <td>{item.requestedQty}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={Number(item.approvedQty || 0)}
                          onChange={(e) => updateItem(item.id, "approvedQty", e.target.value)}
                          style={{ width: "5rem" }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!item.fromStock}
                          disabled={!canUseStock(item)}
                          onChange={(e) => updateItem(item.id, "fromStock", e.target.checked)}
                        />
                        {!canUseStock(item) && (
                          <span className="muted-text" style={{ marginLeft: "0.5rem" }}>
                            Insufficient stock
                          </span>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={Number(item.unitPrice || 0)}
                          onChange={(e) => updateItem(item.id, "unitPrice", e.target.value)}
                          style={{ width: "6rem" }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label className="muted-text">Assignee</label>
                <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">Select</option>
                  {ASSIGNEES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label className="muted-text">Payment Method</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="">Select</option>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </div>
              <span className="stats-pill">
                TRC <strong style={{ color: "#0f172a" }}>Rs {requestTotal.toFixed(2)}</strong>
              </span>
              <span className="stats-pill">
                Payable <strong style={{ color: "#0f172a" }}>Rs {total.toFixed(2)}</strong>
              </span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Tickets;
