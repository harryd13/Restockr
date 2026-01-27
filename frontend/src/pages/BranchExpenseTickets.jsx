import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../components/Modal";

const ITEM_SUGGESTIONS = ["Milk", "Pizza Bread", "Garlic Bread", "Ice Cubes"];
const PAYMENT_METHODS = ["UPI", "Cash", "Paid by assignee"];

function BranchExpenseTickets() {
  const [items, setItems] = useState([{ name: "", qty: 1 }]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [errorBanner, setErrorBanner] = useState("");
  const [successBanner, setSuccessBanner] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showPaymentHint, setShowPaymentHint] = useState(false);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [editTicket, setEditTicket] = useState(null);
  const [editItems, setEditItems] = useState([{ name: "", qty: 1 }]);
  const [editPaymentMethod, setEditPaymentMethod] = useState("");
  const [editDate, setEditDate] = useState(new Date().toISOString().slice(0, 10));
  const [editAmount, setEditAmount] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [deleteTicket, setDeleteTicket] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const updateItem = (index, field, value) => {
    setItems((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  };

  const updateEditItem = (index, field, value) => {
    setEditItems((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  };

  const addItem = () => {
    setItems((prev) => [...prev, { name: "", qty: 1 }]);
  };

  const removeItem = (index) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const removeEditItem = (index) => {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  };

  const cleanedItems = useMemo(
    () =>
      items
        .map((row) => ({
          name: String(row.name || "").trim(),
          qty: Number(row.qty || 0)
        }))
        .filter((row) => row.name && row.qty > 0),
    [items]
  );

  const cleanedEditItems = useMemo(
    () =>
      editItems
        .map((row) => ({
          name: String(row.name || "").trim(),
          qty: Number(row.qty || 0)
        }))
        .filter((row) => row.name && row.qty > 0),
    [editItems]
  );

  const canSubmit = useMemo(() => {
    if (!paymentMethod || !date) return false;
    if (Number(amount || 0) <= 0) return false;
    if (!cleanedItems.length) return false;
    return true;
  }, [paymentMethod, date, amount, cleanedItems]);

  const canEditSubmit = useMemo(() => {
    if (!editPaymentMethod || !editDate) return false;
    if (Number(editAmount || 0) <= 0) return false;
    if (!cleanedEditItems.length) return false;
    return true;
  }, [editPaymentMethod, editDate, editAmount, cleanedEditItems]);

  const submit = async () => {
    setErrorBanner("");
    setSuccessBanner("");
    if (!paymentMethod) {
      setShowPaymentHint(true);
    }
    if (!canSubmit) {
      setErrorBanner("Please fill all required fields.");
      return;
    }
    try {
      setIsSubmitting(true);
      await axios.post("/api/expense-tickets/branch", {
        items: cleanedItems,
        paymentMethod,
        amount: Number(amount || 0),
        date
      });
      setSuccessBanner("Expense ticket logged.");
      setItems([{ name: "", qty: 1 }]);
      setPaymentMethod("");
      setAmount("");
      await loadHistory(date);
    } catch (err) {
      setErrorBanner("Could not log expense ticket.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Enter") return;
    if (paymentMethod) return;
    event.preventDefault();
    setShowPaymentHint(true);
  };

  const isEditable = (log) => {
    if (!log?.createdAt) return false;
    const createdAt = new Date(log.createdAt).getTime();
    if (Number.isNaN(createdAt)) return false;
    const elapsedMs = Date.now() - createdAt;
    return elapsedMs >= 0 && elapsedMs <= 60 * 60 * 1000;
  };

  const openEditModal = (log) => {
    setEditTicket(log);
    setEditItems(
      Array.isArray(log.items) && log.items.length ? log.items.map((item) => ({ ...item })) : [{ name: "", qty: 1 }]
    );
    setEditPaymentMethod(log.paymentMethod || "");
    setEditDate(log.date || date);
    setEditAmount(String(log.amount ?? ""));
  };

  const closeEditModal = () => {
    if (isEditing) return;
    setEditTicket(null);
  };

  const openDeleteModal = (log) => {
    setDeleteTicket(log);
  };

  const closeDeleteModal = () => {
    if (isDeleting) return;
    setDeleteTicket(null);
  };

  const loadHistory = async (targetDate) => {
    try {
      const res = await axios.get("/api/expense-tickets/branch/history", {
        params: { date: targetDate || date }
      });
      setHistoryLogs(res.data || []);
      setHistoryPage(1);
    } catch (err) {
      // Ignore history load failures for now.
    }
  };

  useEffect(() => {
    loadHistory(date);
  }, [date]);

  const historyPageSize = 5;
  const historyTotalPages = Math.max(1, Math.ceil(historyLogs.length / historyPageSize));
  const historyStartIndex = (historyPage - 1) * historyPageSize;
  const pagedHistory = historyLogs.slice(historyStartIndex, historyStartIndex + historyPageSize);

  useEffect(() => {
    setHistoryPage((prev) => Math.min(prev, historyTotalPages));
  }, [historyTotalPages]);

  const submitEdit = async () => {
    if (!editTicket) return;
    setErrorBanner("");
    setSuccessBanner("");
    if (!canEditSubmit) {
      setErrorBanner("Please fill all required fields.");
      return;
    }
    try {
      setIsEditing(true);
      await axios.post(`/api/expense-tickets/branch/${editTicket.ticketId || editTicket.id}/update`, {
        items: cleanedEditItems,
        paymentMethod: editPaymentMethod,
        amount: Number(editAmount || 0),
        date: editDate
      });
      setSuccessBanner("Expense ticket updated.");
      setEditTicket(null);
      await loadHistory(editDate);
    } catch (err) {
      setErrorBanner("Could not update expense ticket.");
    } finally {
      setIsEditing(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteTicket) return;
    setErrorBanner("");
    setSuccessBanner("");
    try {
      setIsDeleting(true);
      await axios.post(`/api/expense-tickets/branch/${deleteTicket.ticketId || deleteTicket.id}/delete`);
      setSuccessBanner("Expense ticket deleted.");
      setDeleteTicket(null);
      await loadHistory(date);
    } catch (err) {
      setErrorBanner("Could not delete expense ticket.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }} onKeyDown={handleKeyDown}>
      {errorBanner && (
        <div className="banner banner--warning">
          <strong>Warning:</strong> {errorBanner}
        </div>
      )}
      {successBanner && (
        <div className="banner banner--success">
          <strong>Success:</strong> {successBanner}
        </div>
      )}

      <section
        className="section-card expense-form"
        style={{ maxWidth: 540, width: "100%" }}
        onKeyDownCapture={handleKeyDown}
      >
        <h3 className="section-title">Expense Ticket</h3>
        <p className="muted-text">Log branch expenses with quick item suggestions.</p>

        <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
          {items.map((row, index) => (
            <div key={`item-${index}`} style={{ display: "grid", gap: "0.5rem" }}>
              <label>
                <span className="muted-text field-label">Item</span>
                <input
                  className="input"
                  list="branch-expense-suggestions"
                  value={row.name}
                  onChange={(e) => updateItem(index, "name", e.target.value)}
                  placeholder="Type or pick an item"
                />
              </label>
              <label>
                <span className="muted-text field-label">Quantity</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={row.qty}
                  onChange={(e) => updateItem(index, "qty", e.target.value)}
                />
              </label>
              {items.length > 1 && (
                <button type="button" className="btn btn-ghost" onClick={() => removeItem(index)}>
                  Remove item
                </button>
              )}
            </div>
          ))}
          <datalist id="branch-expense-suggestions">
            {ITEM_SUGGESTIONS.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>

          <button type="button" className="btn btn-secondary" onClick={addItem}>
            Add another item
          </button>

          <label>
            <span className="muted-text field-label">Payment Method</span>
            <button
              type="button"
              className={`btn btn-secondary${showPaymentHint && !paymentMethod ? " field-error" : ""}`}
              onClick={() => setShowPaymentModal(true)}
            >
              {paymentMethod || "Select payment"}
            </button>
            {showPaymentHint && !paymentMethod && (
              <span className="field-hint field-hint--error">Select payment method first.</span>
            )}
          </label>

          <label>
            <span className="muted-text field-label">Date</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <label>
            <span className="muted-text field-label">TRC (Amount)</span>
            <input className="input" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        </div>

        <div style={{ marginTop: "1rem" }}>
          <button className="btn btn-primary" type="button" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Submit Ticket"}
          </button>
        </div>
      </section>

      <Modal
        open={showPaymentModal}
        title="Select payment method"
        onClose={() => setShowPaymentModal(false)}
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => setShowPaymentModal(false)}>
            Close
          </button>
        }
      >
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              className={method === paymentMethod ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => {
                setPaymentMethod(method);
                setShowPaymentHint(false);
                setShowPaymentModal(false);
              }}
            >
              {method}
            </button>
          ))}
        </div>
      </Modal>

      <section className="section-card" style={{ maxWidth: 540, width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h4 className="section-title">Today&apos;s Expenses</h4>
            <p className="muted-text">History of submitted expense tickets.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => loadHistory(date)}>
            Refresh
          </button>
        </div>
        {historyLogs.length === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No expenses logged today.</p>}
        <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
          {pagedHistory.map((log) => (
            <div
              key={log.id}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "1rem",
                padding: "0.75rem 1rem",
                background: "#f8fafc"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                <span>{log.date}</span>
                <span>Rs {Number(log.amount || 0).toFixed(2)}</span>
              </div>
              {Array.isArray(log.items) && log.items.length > 0 && (
                <div className="muted-text" style={{ marginTop: "0.35rem" }}>
                  Items: {log.items.map((item) => `${item.name} (${item.qty})`).join(", ")}
                </div>
              )}
              <div className="muted-text" style={{ marginTop: "0.35rem" }}>
                {log.paymentMethod || "No payment method"}
              </div>
              {isEditable(log) && (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                  <button type="button" className="btn btn-secondary" onClick={() => openEditModal(log)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => openDeleteModal(log)}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {historyLogs.length > historyPageSize && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
              disabled={historyPage === 1}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setHistoryPage((prev) => Math.min(historyTotalPages, prev + 1))}
              disabled={historyPage === historyTotalPages}
            >
              Next
            </button>
          </div>
        )}
      </section>

      <Modal
        open={!!editTicket}
        title="Edit expense ticket"
        onClose={closeEditModal}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeEditModal} disabled={isEditing}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={submitEdit} disabled={!canEditSubmit || isEditing}>
              {isEditing ? "Saving..." : "Save changes"}
            </button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {editItems.map((row, index) => (
            <div key={`edit-item-${index}`} style={{ display: "grid", gap: "0.5rem" }}>
              <label>
                <span className="muted-text field-label">Item</span>
                <input
                  className="input"
                  list="branch-expense-suggestions"
                  value={row.name}
                  onChange={(e) => updateEditItem(index, "name", e.target.value)}
                  placeholder="Type or pick an item"
                />
              </label>
              <label>
                <span className="muted-text field-label">Quantity</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={row.qty}
                  onChange={(e) => updateEditItem(index, "qty", e.target.value)}
                />
              </label>
              {editItems.length > 1 && (
                <button type="button" className="btn btn-ghost" onClick={() => removeEditItem(index)}>
                  Remove item
                </button>
              )}
            </div>
          ))}

          <button type="button" className="btn btn-secondary" onClick={() => setEditItems((prev) => [...prev, { name: "", qty: 1 }])}>
            Add another item
          </button>

          <label>
            <span className="muted-text field-label">Payment Method</span>
            <select value={editPaymentMethod} onChange={(e) => setEditPaymentMethod(e.target.value)}>
              <option value="">Select</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="muted-text field-label">Date</span>
            <input className="input" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
          </label>

          <label>
            <span className="muted-text field-label">TRC (Amount)</span>
            <input className="input" type="number" min={0} value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
          </label>
        </div>
      </Modal>

      <Modal
        open={!!deleteTicket}
        title="Delete expense ticket?"
        onClose={closeDeleteModal}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeDeleteModal} disabled={isDeleting}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={submitDelete} disabled={isDeleting}>
              {isDeleting ? "Deleting..." : "Confirm delete"}
            </button>
          </>
        }
      >
        <p className="muted-text">
          This will remove the expense ticket from today&apos;s list.
        </p>
      </Modal>
    </div>
  );
}

export default BranchExpenseTickets;
