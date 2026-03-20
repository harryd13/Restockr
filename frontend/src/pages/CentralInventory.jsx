import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../components/Modal";

function CentralInventory() {
  const [rows, setRows] = useState([]);
  const [totalValue, setTotalValue] = useState(0);
  const [logs, setLogs] = useState([]);
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [logsPage, setLogsPage] = useState(1);
  const [errorBanner, setErrorBanner] = useState("");
  const [editRow, setEditRow] = useState(null);
  const [adjustMode, setAdjustMode] = useState("ADD");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState("");

  useEffect(() => {
    load();
    loadLogs();
  }, []);

  const load = async () => {
    try {
      const res = await axios.get("/api/central-inventory");
      setRows(res.data.rows || []);
      setTotalValue(Number(res.data.totalValue || 0));
      setErrorBanner("");
    } catch (err) {
      setErrorBanner("Failed to load central inventory.");
    }
  };

  const loadLogs = async () => {
    try {
      const res = await axios.get("/api/combined-purchase-logs");
      setLogs(res.data || []);
      setExpandedLogId(null);
      setLogsPage(1);
    } catch (err) {
      setErrorBanner("Failed to load combined purchase logs.");
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

  const logsPageSize = 5;
  const logsTotalPages = Math.max(1, Math.ceil(logs.length / logsPageSize));
  const logsStartIndex = (logsPage - 1) * logsPageSize;
  const pagedLogs = useMemo(
    () => logs.slice(logsStartIndex, logsStartIndex + logsPageSize),
    [logs, logsStartIndex]
  );

  useEffect(() => {
    setLogsPage((prev) => Math.min(prev, logsTotalPages));
  }, [logsTotalPages]);

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
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>On Hand</th>
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

      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div>
            <h4 className="section-title">Central Purchase Logs</h4>
            <p className="muted-text">Latest combined purchase submissions.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={loadLogs}>
            Refresh
          </button>
        </div>
        {pagedLogs.length === 0 && <p className="muted-text">No logs available yet.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {pagedLogs.map((log) => {
            const isOpen = expandedLogId === log.id;
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
                  onClick={() => setExpandedLogId(isOpen ? null : log.id)}
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
                    Week {log.weekStartDate || "-"} - {log.requestId || "-"} {log.branchId ? `(${log.branchId})` : ""} {log.requestCount ? `· ${log.requestCount} requests` : ""} - {new Date(log.createdAt).toLocaleString()}
                  </span>
                  <span>Rs {Number(log.total || 0).toFixed(2)} {isOpen ? "v" : "+"}</span>
                </button>
                {isOpen && (
                  <div style={{ marginTop: "0.75rem" }} className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Category</th>
                          <th>Requested</th>
                          <th>Approved</th>
                          <th>Unit Price</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(log.items || []).map((item) => (
                          <tr key={`${log.id}-${item.itemId}`}>
                            <td>{item.itemName}</td>
                            <td>{item.categoryName}</td>
                            <td>{item.requestedTotal}</td>
                            <td>{item.approvedQty}</td>
                            <td>Rs {Number(item.unitPrice || 0).toFixed(2)}</td>
                            <td>{item.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem" }}>
          <button type="button" className="btn btn-ghost" onClick={() => setLogsPage((p) => Math.max(1, p - 1))} disabled={logsPage === 1}>
            Prev
          </button>
          <span className="muted-text">
            Page {logsPage} of {logsTotalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setLogsPage((p) => Math.min(logsTotalPages, p + 1))}
            disabled={logsPage === logsTotalPages}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}

export default CentralInventory;
