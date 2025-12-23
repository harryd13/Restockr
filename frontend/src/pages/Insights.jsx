import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

function Insights() {
  const [branches, setBranches] = useState([]);
  const [purchaseLogs, setPurchaseLogs] = useState([]);
  const [combinedLogs, setCombinedLogs] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState("purchases");
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [purchaseLogsPage, setPurchaseLogsPage] = useState(1);

  useEffect(() => {
    loadBranches();
    loadPurchaseLogs();
    loadCombinedLogs();
  }, []);

  const loadBranches = async () => {
    const res = await axios.get("/api/branches");
    setBranches(res.data || []);
  };

  const loadPurchaseLogs = async () => {
    const res = await axios.get("/api/reports/purchase-logs");
    setPurchaseLogs(res.data || []);
    setExpandedLogId(null);
    setPurchaseLogsPage(1);
  };

  const loadCombinedLogs = async () => {
    const res = await axios.get("/api/combined-purchase-logs");
    setCombinedLogs(res.data || []);
  };

  const branchList = useMemo(() => branches.slice(0, 3), [branches]);

  const lastFourLogs = useMemo(() => {
    return [...purchaseLogs]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 4);
  }, [purchaseLogs]);

  const combinedByWeek = useMemo(() => {
    const map = new Map();
    combinedLogs.forEach((log) => {
      if (!log.weekStartDate || log.weekStartDate === "MULTI") return;
      map.set(log.weekStartDate, Number(log.total || 0));
    });
    return map;
  }, [combinedLogs]);

  const chartSeries = useMemo(() => {
    const seriesMap = new Map();
    const addWeek = (week, value) => {
      seriesMap.set(week, (seriesMap.get(week) || 0) + value);
    };

    if (selectedSeries === "purchases") {
      purchaseLogs.forEach((log) => {
        const week = log.weekStartDate || new Date(log.createdAt).toISOString().slice(0, 10);
        addWeek(week, Number(log.total || 0));
      });
    } else if (selectedSeries === "inventory") {
      combinedLogs.forEach((log) => {
        const week = log.weekStartDate || new Date(log.createdAt).toISOString().slice(0, 10);
        addWeek(week, Number(log.total || 0));
      });
    } else {
      const branchId = selectedSeries;
      purchaseLogs.forEach((log) => {
        const week = log.weekStartDate || new Date(log.createdAt).toISOString().slice(0, 10);
        const branch = (log.branches || []).find((b) => b.branchId === branchId);
        if (branch) addWeek(week, Number(branch.total || 0));
      });
    }

    return Array.from(seriesMap.entries())
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .map(([week, total]) => ({ week, total }));
  }, [purchaseLogs, combinedLogs, selectedSeries]);

  const maxValue = Math.max(1, ...chartSeries.map((d) => d.total));

  const purchaseLogsPageSize = 5;
  const purchaseLogsTotalPages = Math.max(1, Math.ceil(purchaseLogs.length / purchaseLogsPageSize));
  const purchaseLogsStartIndex = (purchaseLogsPage - 1) * purchaseLogsPageSize;
  const pagedPurchaseLogs = purchaseLogs.slice(purchaseLogsStartIndex, purchaseLogsStartIndex + purchaseLogsPageSize);

  useEffect(() => {
    setPurchaseLogsPage((prev) => Math.min(prev, purchaseLogsTotalPages));
  }, [purchaseLogsTotalPages]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section className="section-card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="section-title">Reports</h3>
            <p className="muted-text">Latest request costs across branches and combined purchases.</p>
          </div>
        </div>
        <div className="table-wrapper" style={{ marginTop: "1rem" }}>
          <table>
            <thead>
              <tr>
                <th>Week</th>
                {branchList.map((b) => (
                  <th key={b.id}>{b.name}</th>
                ))}
                <th>Combined Purchase</th>
              </tr>
            </thead>
            <tbody>
              {lastFourLogs.map((log) => (
                <tr key={log.id}>
                  <td>{log.weekStartDate || new Date(log.createdAt).toISOString().slice(0, 10)}</td>
                  {branchList.map((b) => {
                    const entry = (log.branches || []).find((br) => br.branchId === b.id);
                    return <td key={b.id}>Rs {Number(entry?.total || 0).toFixed(2)}</td>;
                  })}
                  <td>Rs {Number(combinedByWeek.get(log.weekStartDate) || 0).toFixed(2)}</td>
                </tr>
              ))}
              {lastFourLogs.length === 0 && (
                <tr>
                  <td colSpan={branchList.length + 2} className="muted-text">
                    No finalized distributions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h4 className="section-title">Weekly Comparison</h4>
            <p className="muted-text">Track week-by-week totals by branch, purchases, or inventory.</p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.85rem", color: "#475569", fontWeight: 600, alignSelf: "center" }}>Series</label>
            <select value={selectedSeries} onChange={(e) => setSelectedSeries(e.target.value)} style={{ minWidth: 200 }}>
              <option value="purchases">Purchases</option>
              <option value="inventory">Inventory</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: "1rem", display: "flex", alignItems: "flex-end", gap: "0.75rem", minHeight: 180 }}>
          {chartSeries.map((point) => (
            <div key={point.week} style={{ flex: 1, textAlign: "center" }}>
              <div
                style={{
                  height: `${Math.round((point.total / maxValue) * 140)}px`,
                  background: "linear-gradient(180deg, #2563eb, #0ea5e9)",
                  borderRadius: "0.5rem",
                  marginBottom: "0.5rem"
                }}
                title={`Rs ${point.total.toFixed(2)}`}
              />
              <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{point.week}</div>
              <div style={{ fontSize: "0.75rem", fontWeight: 600 }}>Rs {point.total.toFixed(2)}</div>
            </div>
          ))}
          {chartSeries.length === 0 && <p className="muted-text">No data available for the selected series.</p>}
        </div>
      </section>

      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div>
            <h4 className="section-title">Distribution Logs</h4>
            <p className="muted-text">Finalized distributions with branch-wise drill downs.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={loadPurchaseLogs}>
            Refresh
          </button>
        </div>
        {pagedPurchaseLogs.length === 0 && <p className="muted-text">No purchase runs finalized yet.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {pagedPurchaseLogs.map((log) => {
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
                    Week {log.weekStartDate || new Date(log.createdAt).toISOString().slice(0, 10)} - {new Date(log.createdAt).toLocaleString()}
                  </span>
                  <span>Rs {Number(log.total || 0).toFixed(2)} {isOpen ? "v" : "+"}</span>
                </button>
                {isOpen && (
                  <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {(log.branches || []).map((branch) => (
                      <div key={branch.branchId} style={{ padding: "0.5rem 0", borderTop: "1px solid #e2e8f0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.35rem" }}>
                          <strong>{branches.find((b) => b.id === branch.branchId)?.name || branch.branchId}</strong>
                          <span>Rs {Number(branch.total || 0).toFixed(2)}</span>
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
                                  <td>Rs {Number(item.totalPrice || 0).toFixed(2)}</td>
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
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setPurchaseLogsPage((p) => Math.max(1, p - 1))}
            disabled={purchaseLogsPage === 1}
          >
            Prev
          </button>
          <span className="muted-text">
            Page {purchaseLogsPage} of {purchaseLogsTotalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setPurchaseLogsPage((p) => Math.min(purchaseLogsTotalPages, p + 1))}
            disabled={purchaseLogsPage === purchaseLogsTotalPages}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}

export default Insights;
