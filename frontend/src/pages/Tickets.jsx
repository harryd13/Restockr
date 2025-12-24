import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../components/Modal";

const ASSIGNEES = ["Vivek", "Harman", "Bhashit"];
const PAYMENT_METHODS = ["UPI", "Cash", "Paid by assignee"];

function Tickets() {
  const [branches, setBranches] = useState([]);
  const [inventoryMap, setInventoryMap] = useState(new Map());
  const [tickets, setTickets] = useState([]);
  const [ticketItems, setTicketItems] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [expandedExpenseId, setExpandedExpenseId] = useState(null);
  const [expenseBranchId, setExpenseBranchId] = useState("");
  const [expenseAssignee, setExpenseAssignee] = useState("");
  const [expensePayment, setExpensePayment] = useState("");
  const [activeTicket, setActiveTicket] = useState(null);
  const [assignee, setAssignee] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [editableItems, setEditableItems] = useState([]);
  const [errorBanner, setErrorBanner] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadBranches();
    loadTickets();
    loadExpenses();
    loadInventory();
  }, []);

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

  const loadExpenses = async () => {
    const res = await axios.get("/api/tickets/expenses");
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

  const lookupBranchName = (id) => branches.find((b) => b.id === id)?.name || id;

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
        return true;
      });
  }, [expenses, expenseBranchId, expenseAssignee, expensePayment]);

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
            <p className="muted-text">Daily requests awaiting processing.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={loadTickets}>
            Refresh
          </button>
        </div>
        {ticketsWithItems.length === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No open tickets.</p>}
        <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
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
                Assignee: {ticket.assignee || "Unassigned"}
                {ticketHasRemaining(ticket) && <span className="stats-pill" style={{ marginLeft: "0.5rem" }}>Partial</span>}
              </div>
              <button className="btn btn-primary" type="button" onClick={() => openTicket(ticket)}>
                More
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h4 className="section-title">Expenses</h4>
            <p className="muted-text">Completed daily requests with spend details.</p>
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
        </div>
        {filteredExpenses.length === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No expenses logged yet.</p>}
        <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
          {filteredExpenses.map((log) => {
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
      </section>

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
