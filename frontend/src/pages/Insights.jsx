import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

function Insights() {
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState([]);
  const [rows, setRows] = useState([]);
  const [purchaseLogs, setPurchaseLogs] = useState([]);
  const [expandedLogId, setExpandedLogId] = useState(null);

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    loadPurchaseLogs(branchId);
  }, [branchId]);

  const loadBranches = async () => {
    const res = await axios.get("/api/branches");
    setBranches(res.data);
  };

  const load = async () => {
    const res = await axios.get("/api/reports/branch-trend", { params: { branchId: branchId || undefined } });
    setRows(res.data);
  };

  const loadPurchaseLogs = async (targetBranchId = branchId) => {
    const res = await axios.get("/api/reports/purchase-logs", { params: { branchId: targetBranchId || undefined } });
    setPurchaseLogs(res.data);
    setExpandedLogId(null);
  };

  const lookupBranchName = (id) => branches.find((b) => b.id === id)?.name || id;

  const totalAll = rows.reduce((sum, r) => sum + r.total, 0);
  const displayedPurchaseLogs = useMemo(() => {
    if (!branchId) return purchaseLogs;
    return purchaseLogs
      .map((log) => {
        const branchEntries = log.branches.filter((b) => b.branchId === branchId);
        if (!branchEntries.length) return null;
        const branchTotal = branchEntries.reduce((sum, b) => sum + (b.total || 0), 0);
        return { ...log, branches: branchEntries, total: branchTotal };
      })
      .filter(Boolean);
  }, [purchaseLogs, branchId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section className="section-card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="section-title">Insights</h3>
            <p className="muted-text">Understand spending trends per branch or across the network.</p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.85rem", color: "#475569", fontWeight: 600, alignSelf: "center" }}>Branch</label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={{ minWidth: 180 }}>
              <option value="">All</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" type="button" onClick={load}>
              Load
            </button>
          </div>
        </div>
        <div style={{ marginTop: "1rem" }}>
          <span className="stats-pill">
            Total spend <strong style={{ color: "#0f172a" }}>₹{totalAll}</strong>
          </span>
        </div>
      </section>

      <section className="section-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Week</th>
                <th>Branch</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td>{r.weekStartDate}</td>
                  <td>{lookupBranchName(r.branchId)}</td>
                  <td>₹{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div>
            <h4 className="section-title">Purchase Logs</h4>
            <p className="muted-text">Finalized purchase runs with branch-wise drill downs.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => loadPurchaseLogs(branchId)}>
            Refresh
          </button>
        </div>
        {displayedPurchaseLogs.length === 0 && <p className="muted-text">No purchase runs finalized yet.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {displayedPurchaseLogs.map((log) => {
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
                    Week {log.weekStartDate} • {new Date(log.createdAt).toLocaleString()}
                  </span>
                  <span>₹{Number(log.total || 0).toFixed(2)} {isOpen ? "−" : "+"}</span>
                </button>
                {isOpen && (
                  <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {log.branches.map((branch) => (
                      <div key={branch.branchId} style={{ padding: "0.5rem 0", borderTop: "1px solid #e2e8f0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.35rem" }}>
                          <strong>{lookupBranchName(branch.branchId)}</strong>
                          <span>₹{Number(branch.total || 0).toFixed(2)}</span>
                        </div>
                        <div className="table-wrapper">
                          <table>
                            <thead>
                              <tr>
                                <th>Item</th>
                                <th>Category</th>
                                <th>Requested</th>
                                <th>Approved</th>
                                <th>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {branch.items.map((item) => (
                                <tr key={`${branch.branchId}-${item.itemId}`}>
                                  <td>{item.itemName}</td>
                                  <td>{item.categoryName}</td>
                                  <td>{item.requestedQty}</td>
                                  <td>{item.approvedQty}</td>
                                  <td>₹{Number(item.totalPrice || 0).toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default Insights;
