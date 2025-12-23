import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import Modal from "../components/Modal";

function CombinedPurchaseRun({ onNavigate }) {
  const [rows, setRows] = useState([]);
  const [items, setItems] = useState([]);
  const [queueSize, setQueueSize] = useState(0);
  const [newItemId, setNewItemId] = useState("");
  const [newItemQty, setNewItemQty] = useState(0);
  const [newItemPrice, setNewItemPrice] = useState(0);
  const [newItemStatus, setNewItemStatus] = useState("AVAILABLE");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [errorBanner, setErrorBanner] = useState("");

  useEffect(() => {
    loadQueue();
    loadItems();
  }, []);

  const loadItems = async () => {
    const res = await axios.get("/api/items");
    setItems(res.data || []);
  };

  const loadQueue = async (silent = false) => {
    try {
      const res = await axios.get("/api/combined-purchase-queue");
      setRows(res.data.rows || []);
      setQueueSize((res.data.runIds || []).length);
      if (!silent) setErrorBanner("");
    } catch (err) {
      if (!silent) setErrorBanner("Failed to load combined purchase requests.");
    }
  };

  const changeRow = (id, field, value) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.itemId !== id) return r;
        const updated = { ...r, [field]: value };
        if (field === "status" && value === "UNAVAILABLE") {
          updated.approvedQty = 0;
        }
        return updated;
      })
    );
  };

  const total = useMemo(() => {
    return rows.reduce((sum, r) => sum + (r.approvedQty || 0) * (r.unitPrice || 0), 0);
  }, [rows]);

  const addItem = () => {
    if (!newItemId) return;
    const selected = items.find((it) => it.id === newItemId);
    const nextRow = {
      itemId: newItemId,
      itemName: selected?.name || newItemId,
      categoryName: selected?.categoryName || "",
      requestedTotal: 0,
      approvedQty: Number(newItemQty || 0),
      unitPrice: Number(newItemPrice || selected?.defaultPrice || 0),
      status: newItemStatus
    };
    setRows((prev) => [...prev, nextRow]);
    setNewItemId("");
    setNewItemQty(0);
    setNewItemPrice(0);
    setNewItemStatus("AVAILABLE");
  };

  const submitRun = async () => {
    if (!rows.length) return;
    try {
      setIsSubmitting(true);
      await axios.post(`/api/combined-purchase-queue/submit`, { rows });
      setRows([]);
      setShowSubmitModal(false);
      await loadQueue();
      if (onNavigate) onNavigate("distribution");
    } catch (err) {
      setErrorBanner("Failed to submit combined purchase request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canEdit = rows.length > 0;

  const exportPdf = () => {
    if (!rows.length) return;
    const doc = new jsPDF();
    doc.setFontSize(14);
    const now = new Date();
    const stamp = now.toLocaleString();
    doc.text(`Combined Purchase Request - ${stamp}`, 14, 16);
    autoTable(doc, {
      startY: 22,
      head: [["Item", "Category", "Requested", "Approved", "Unit Price", "Status", "Total"]],
      body: rows.map((r) => [
        r.itemName,
        r.categoryName,
        r.requestedTotal,
        r.approvedQty,
        r.unitPrice,
        r.status,
        (Number(r.approvedQty || 0) * Number(r.unitPrice || 0)).toFixed(2)
      ])
    });
    const filename = `combined-purchase-request-${now.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.pdf`;
    doc.save(filename);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {errorBanner && (
        <div className="banner banner--warning">
          <strong>Warning:</strong> {errorBanner}
        </div>
      )}

      <section className="section-card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="section-title">Combined Purchase Request</h3>
            <p className="muted-text">Review shortfalls and confirm procurement from central.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span className="stats-pill">
              Pending requests <strong style={{ color: "#0f172a" }}>{queueSize}</strong>
            </span>
            <button type="button" className="btn btn-secondary" onClick={() => loadQueue()}>
              Refresh
            </button>
          </div>
        </div>
        {queueSize === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No pending purchase requests.</p>}

        <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <span className="stats-pill">
            Total spend <strong style={{ color: "#0f172a" }}>Rs {total.toFixed(2)}</strong>
          </span>
          {canEdit && (
            <button type="button" className="btn btn-primary" onClick={() => setShowSubmitModal(true)} disabled={!rows.length}>
              Submit Purchase Request
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={exportPdf} disabled={!rows.length}>
            Download PDF
          </button>
        </div>
      </section>

      <section className="section-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>Requested</th>
                <th>Approved</th>
                <th>Unit Price</th>
                <th>Status</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId}>
                  <td>{r.itemName}</td>
                  <td>{r.categoryName}</td>
                  <td>{r.requestedTotal}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={r.approvedQty}
                      disabled={!canEdit || r.status === "UNAVAILABLE"}
                      onChange={(e) => changeRow(r.itemId, "approvedQty", Number(e.target.value))}
                      style={{
                        width: "5rem",
                        backgroundColor: r.status === "UNAVAILABLE" ? "#f1f5f9" : "#fff",
                        color: r.status === "UNAVAILABLE" ? "#94a3b8" : "#0f172a"
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={r.unitPrice}
                      disabled={!canEdit}
                      onChange={(e) => changeRow(r.itemId, "unitPrice", Number(e.target.value))}
                      style={{ width: "6rem" }}
                    />
                  </td>
                  <td>
                    {canEdit ? (
                      <select value={r.status} onChange={(e) => changeRow(r.itemId, "status", e.target.value)}>
                        <option value="AVAILABLE">Available</option>
                        <option value="UNAVAILABLE">Unavailable</option>
                      </select>
                    ) : (
                      r.status
                    )}
                  </td>
                  <td>Rs {(Number(r.approvedQty || 0) * Number(r.unitPrice || 0)).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <select
              value={newItemId}
              onChange={(e) => {
                const nextId = e.target.value;
                const selected = items.find((it) => it.id === nextId);
                setNewItemId(nextId);
                if (selected && (newItemPrice === 0 || newItemPrice === "")) {
                  setNewItemPrice(Number(selected.defaultPrice || 0));
                }
              }}
              style={{ minWidth: 220 }}
            >
              <option value="">Add item...</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={newItemQty}
              onChange={(e) => setNewItemQty(Number(e.target.value))}
              placeholder="Qty"
              style={{ width: "5rem" }}
            />
            <input
              type="number"
              min={0}
              value={newItemPrice}
              onChange={(e) => setNewItemPrice(Number(e.target.value))}
              placeholder="Price"
              style={{ width: "6rem" }}
            />
            <select value={newItemStatus} onChange={(e) => setNewItemStatus(e.target.value)}>
              <option value="AVAILABLE">Available</option>
              <option value="UNAVAILABLE">Unavailable</option>
            </select>
            <button type="button" className="btn btn-ghost" onClick={addItem} disabled={!newItemId}>
              Add
            </button>
          </div>
        </div>
      </section>

      <Modal
        open={showSubmitModal}
        title="Submit combined purchase request?"
        onClose={() => setShowSubmitModal(false)}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setShowSubmitModal(false)} disabled={isSubmitting}>
              Keep editing
            </button>
            <button type="button" className="btn btn-primary" onClick={submitRun} disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit"}
            </button>
          </>
        }
      >
        <p className="muted-text" style={{ margin: 0 }}>
          Submitting locks the purchase request and prepares distribution.
        </p>
      </Modal>
    </div>
  );
}

export default CombinedPurchaseRun;
