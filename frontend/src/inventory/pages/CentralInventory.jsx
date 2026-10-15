import React, { useEffect, useState } from "react";
import axios from "axios";
import Modal from "../../shared/components/Modal";

function CentralInventory() {
  const [rows, setRows] = useState([]);
  const [totalValue, setTotalValue] = useState(0);
  const [errorBanner, setErrorBanner] = useState("");
  const [editRow, setEditRow] = useState(null);
  const [adjustMode, setAdjustMode] = useState("ADD");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState("");
  const [items, setItems] = useState([]);
  const [procurements, setProcurements] = useState([]);
  const [showProcurement, setShowProcurement] = useState(false);
  const [procurementForm, setProcurementForm] = useState({ paymentStatus: "PAID", paymentMethod: "UPI", note: "", items: [{ itemId: "", quantity: "", unitPrice: "" }] });
  const [procurementError, setProcurementError] = useState("");
  const [savingProcurement, setSavingProcurement] = useState(false);
  const [procurementKey, setProcurementKey] = useState("");
  const [procurementPage, setProcurementPage] = useState(1);

  const procurementPageSize = 5;
  const procurementTotalPages = Math.max(1, Math.ceil(procurements.length / procurementPageSize));
  const procurementStartIndex = (procurementPage - 1) * procurementPageSize;
  const pagedProcurements = procurements.slice(procurementStartIndex, procurementStartIndex + procurementPageSize);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setProcurementPage((page) => Math.min(page, procurementTotalPages));
  }, [procurementTotalPages]);

  const load = async () => {
    try {
      const [inventoryRes, itemRes, procurementRes] = await Promise.all([
        axios.get("/api/central-inventory"),
        axios.get("/api/admin/items"),
        axios.get("/api/central-procurements")
      ]);
      setRows(inventoryRes.data.rows || []);
      setTotalValue(Number(inventoryRes.data.totalValue || 0));
      setItems(itemRes.data || []);
      setProcurements(procurementRes.data || []);
      setErrorBanner("");
    } catch (err) {
      setErrorBanner("Failed to load central inventory.");
    }
  };

  const updateProcurementItem = (index, field, value) => {
    setProcurementForm((form) => ({ ...form, items: form.items.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row) }));
  };

  const submitProcurement = async () => {
    try {
      setSavingProcurement(true);
      setProcurementError("");
      await axios.post("/api/central-procurements", { ...procurementForm, idempotencyKey: procurementKey });
      setShowProcurement(false);
      setProcurementForm({ paymentStatus: "PAID", paymentMethod: "UPI", note: "", items: [{ itemId: "", quantity: "", unitPrice: "" }] });
      await load();
    } catch (err) {
      setProcurementError(err?.response?.data?.message || "Could not create procurement.");
    } finally {
      setSavingProcurement(false);
    }
  };

  const openAdjustModal = (row) => {
    setEditRow(row);
    setAdjustMode("ADD");
    setAdjustQty("");
    setAdjustReason("");
    setAdjustError("");
  };

  const closeAdjustModal = () => {
    if (isAdjusting) return;
    setEditRow(null);
  };

  const canSubmitAdjust = () => {
    const qty = Number(adjustQty || 0);
    if (!adjustReason.trim()) return false;
    if (adjustMode === "SET") return qty >= 0;
    return qty > 0;
  };

  const submitAdjust = async () => {
    if (!editRow || !canSubmitAdjust()) return;
    try {
      setIsAdjusting(true);
      setAdjustError("");
      await axios.post("/api/central-inventory/adjust", {
        itemId: editRow.itemId,
        mode: adjustMode,
        quantity: Number(adjustQty || 0),
        reason: adjustReason
      });
      setEditRow(null);
      await load();
    } catch (err) {
      setAdjustError("Could not save adjustment.");
    } finally {
      setIsAdjusting(false);
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <h3 className="section-title">Central Inventory</h3>
            <p className="muted-text hide-on-mobile">Live stock available for distribution.</p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <span className="stats-pill">
              Total value <strong style={{ color: "#0f172a" }}>Rs {totalValue.toFixed(2)}</strong>
            </span>
            <button type="button" className="btn btn-secondary" onClick={load}>
              Refresh
            </button>
            <button type="button" className="btn btn-primary" onClick={() => { setProcurementError(""); setProcurementKey(`${Date.now()}-${Math.random()}`); setShowProcurement(true); }}>
              Procure Stock
            </button>
          </div>
        </div>
      </section>

      <section className="section-card" style={{ order: 999 }}>
        <h4 className="section-title">Direct Central Procurements</h4>
        <p className="muted-text">Admin purchases made directly for shared Central Inventory.</p>
        {procurements.length === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No direct procurements yet.</p>}
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
          {pagedProcurements.map((procurement, index) => (
            <div key={procurement.id} style={{ border: "1px solid #e2e8f0", borderRadius: "0.75rem", padding: "0.75rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
              <div>
                <strong>Procurement {procurements.length - procurementStartIndex - index}</strong> · {procurement.status}
                <div className="muted-text">{new Date(procurement.receivedAt || procurement.createdAt).toLocaleString()} · {procurement.items?.length || 0} items · Rs {Number(procurement.finalTotal ?? procurement.total ?? 0).toFixed(2)} · {procurement.paymentStatus}</div>
              </div>
            </div>
          ))}
        </div>
        {procurements.length > procurementPageSize && (
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button type="button" className="btn btn-secondary" onClick={() => setProcurementPage((page) => Math.max(1, page - 1))} disabled={procurementPage === 1}>Prev</button>
            <span className="muted-text">Page {procurementPage} of {procurementTotalPages}</span>
            <button type="button" className="btn btn-secondary" onClick={() => setProcurementPage((page) => Math.min(procurementTotalPages, page + 1))} disabled={procurementPage === procurementTotalPages}>Next</button>
          </div>
        )}
      </section>

      <section className="section-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>On Hand</th>
                <th>Unit Cost</th>
                <th>Value</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.itemId}>
                  <td>{row.itemName}</td>
                  <td>{row.categoryName}</td>
                  <td>{row.onHand}</td>
                  <td>Rs {Number(row.unitPrice || 0).toFixed(2)}</td>
                  <td>Rs {Number(row.totalValue || 0).toFixed(2)}</td>
                  <td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "-"}</td>
                  <td>
                    <button type="button" className="btn btn-secondary" onClick={() => openAdjustModal(row)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={!!editRow}
        title={editRow ? `${editRow.itemName} · Manual Adjustment` : "Manual Adjustment"}
        onClose={closeAdjustModal}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeAdjustModal} disabled={isAdjusting}>
              Close
            </button>
            <button type="button" className="btn btn-primary" onClick={submitAdjust} disabled={!canSubmitAdjust() || isAdjusting}>
              {isAdjusting ? "Saving..." : "Save Adjustment"}
            </button>
          </>
        }
      >
        {editRow && (
          <div>
            <p className="muted-text" style={{ marginBottom: "0.75rem" }}>
              On hand {editRow.onHand}
            </p>
            {adjustError && (
              <div className="banner banner--warning" style={{ marginBottom: "0.75rem" }}>
                <strong>Warning:</strong> {adjustError}
              </div>
            )}
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <label>
                <span className="muted-text field-label">Adjustment Type</span>
                <select value={adjustMode} onChange={(e) => setAdjustMode(e.target.value)}>
                  <option value="ADD">Add</option>
                  <option value="REMOVE">Remove</option>
                  <option value="SET">Set Exact</option>
                </select>
              </label>
              <label>
                <span className="muted-text field-label">Quantity</span>
                <input className="input" type="number" min={0} value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} />
              </label>
              <label>
                <span className="muted-text field-label">Reason</span>
                <input className="input" type="text" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
              </label>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={showProcurement}
        title="Procure Stock for Central Inventory"
        onClose={() => !savingProcurement && setShowProcurement(false)}
        actions={<><button type="button" className="btn btn-ghost" onClick={() => setShowProcurement(false)} disabled={savingProcurement}>Cancel</button><button type="button" className="btn btn-primary" onClick={submitProcurement} disabled={savingProcurement}>{savingProcurement ? "Adding..." : "Add to Inventory"}</button></>}
      >
        {procurementError && <div className="banner banner--warning" style={{ marginBottom: "0.75rem" }}>{procurementError}</div>}
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <label><span className="muted-text field-label">Payment status</span><select value={procurementForm.paymentStatus} onChange={(e) => setProcurementForm((form) => ({ ...form, paymentStatus: e.target.value, paymentMethod: e.target.value === "PAID" ? (form.paymentMethod || "UPI") : "" }))}><option value="PAID">Paid</option><option value="PENDING">Pending</option></select></label>
            {procurementForm.paymentStatus === "PAID" && <label><span className="muted-text field-label">Payment method</span><select value={procurementForm.paymentMethod} onChange={(e) => setProcurementForm((form) => ({ ...form, paymentMethod: e.target.value }))}><option value="UPI">UPI</option><option value="Cash">Cash</option></select></label>}
          </div>
          {procurementForm.items.map((row, index) => (
            <div key={index} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: "0.5rem", alignItems: "end" }}>
              <label><span className="muted-text field-label">Item</span><select value={row.itemId} onChange={(e) => updateProcurementItem(index, "itemId", e.target.value)}><option value="">Select item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label><span className="muted-text field-label">Quantity</span><input className="input" type="number" min="0" value={row.quantity} onChange={(e) => updateProcurementItem(index, "quantity", e.target.value)} /></label>
              <label><span className="muted-text field-label">Purchase price</span><input className="input" type="number" min="0" value={row.unitPrice} onChange={(e) => updateProcurementItem(index, "unitPrice", e.target.value)} /></label>
              <button type="button" className="btn btn-ghost" onClick={() => setProcurementForm((form) => ({ ...form, items: form.items.filter((_, rowIndex) => rowIndex !== index) }))} disabled={procurementForm.items.length === 1}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={() => setProcurementForm((form) => ({ ...form, items: [...form.items, { itemId: "", quantity: "", unitPrice: "" }] }))}>Add item</button>
          <label><span className="muted-text field-label">Note</span><input className="input" value={procurementForm.note} onChange={(e) => setProcurementForm((form) => ({ ...form, note: e.target.value }))} /></label>
        </div>
      </Modal>

    </div>
  );
}

export default CentralInventory;
