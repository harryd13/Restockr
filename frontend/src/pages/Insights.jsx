import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

function Insights() {
  const [branches, setBranches] = useState([]);
  const [purchaseLogs, setPurchaseLogs] = useState([]);
  const [combinedLogs, setCombinedLogs] = useState([]);
  const [expenseLogs, setExpenseLogs] = useState([]);
  const [expenseTicketLogs, setExpenseTicketLogs] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState("purchases");
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [purchaseLogsPage, setPurchaseLogsPage] = useState(1);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [expenseTicketBranchId, setExpenseTicketBranchId] = useState("");
  const [expenseTicketAssignee, setExpenseTicketAssignee] = useState("");
  const [expenseTicketPayment, setExpenseTicketPayment] = useState("");
  const [expenseTicketLevel, setExpenseTicketLevel] = useState("");
  const [expenseTicketPage, setExpenseTicketPage] = useState(1);
  const [expandedExpenseTicketId, setExpandedExpenseTicketId] = useState(null);

  useEffect(() => {
    loadBranches();
    loadPurchaseLogs();
    loadCombinedLogs();
    loadExpenseLogs();
    loadExpenseTicketLogs();
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

  const loadExpenseLogs = async () => {
    const res = await axios.get("/api/tickets/expenses");
    setExpenseLogs(res.data || []);
  };

  const loadExpenseTicketLogs = async () => {
    const res = await axios.get("/api/expense-tickets/logs");
    setExpenseTicketLogs(res.data || []);
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

  useEffect(() => {
    const dates = [];
    purchaseLogs.forEach((log) => {
      if (log.createdAt) dates.push(log.createdAt);
    });
    expenseLogs.forEach((log) => {
      if (log.completedAt) dates.push(log.completedAt);
    });
    expenseTicketLogs.forEach((log) => {
      if (log.date) dates.push(log.date);
    });
    if (!dates.length) return;
    const sorted = dates.map((d) => new Date(d)).sort((a, b) => a - b);
    const minDate = sorted[0].toISOString().slice(0, 10);
    const maxDate = sorted[sorted.length - 1].toISOString().slice(0, 10);
    if (!startDate) setStartDate(minDate);
    if (!endDate) setEndDate(maxDate);
  }, [purchaseLogs, expenseLogs, expenseTicketLogs, startDate, endDate]);

  const branchExpenseTotals = useMemo(() => {
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (end) end.setHours(23, 59, 59, 999);

    const totals = new Map();
    branchList.forEach((b) =>
      totals.set(b.id, { distributed: 0, daily: 0, other: 0, expenseTickets: 0, branchExpenses: 0 })
    );

    purchaseLogs.forEach((log) => {
      const date = log.createdAt ? new Date(log.createdAt) : null;
      if (start && date && date < start) return;
      if (end && date && date > end) return;
      (log.branches || []).forEach((branch) => {
        if (!totals.has(branch.branchId)) return;
        const entry = totals.get(branch.branchId);
        entry.distributed += Number(branch.total || 0);
      });
    });

    expenseLogs.forEach((log) => {
      const date = log.completedAt ? new Date(log.completedAt) : null;
      if (start && date && date < start) return;
      if (end && date && date > end) return;
      if (!totals.has(log.branchId)) return;
      const entry = totals.get(log.branchId);
      if ((log.type || "DAILY") === "OTHER") {
        entry.other += Number(log.requestTotal || log.total || 0);
      } else {
        entry.daily += Number(log.requestTotal || log.total || 0);
      }
    });

    expenseTicketLogs.forEach((log) => {
      const date = log.date ? new Date(log.date) : null;
      if (start && date && date < start) return;
      if (end && date && date > end) return;
      if (!totals.has(log.branchId)) return;
      const entry = totals.get(log.branchId);
      if ((log.category || "") === "Branch Expense") {
        entry.branchExpenses = (entry.branchExpenses || 0) + Number(log.amount || 0);
      } else {
        entry.expenseTickets = (entry.expenseTickets || 0) + Number(log.amount || 0);
      }
    });

    return totals;
  }, [purchaseLogs, expenseLogs, expenseTicketLogs, branchList, startDate, endDate]);

  const expenseGrandTotals = useMemo(() => {
    let distributed = 0;
    let daily = 0;
    let other = 0;
    let expenseTickets = 0;
    let branchExpenses = 0;
    branchExpenseTotals.forEach((value) => {
      distributed += value.distributed || 0;
      daily += value.daily || 0;
      other += value.other || 0;
      expenseTickets += value.expenseTickets || 0;
      branchExpenses += value.branchExpenses || 0;
    });
    return { distributed, daily, other, expenseTickets, branchExpenses };
  }, [branchExpenseTotals]);

  const filteredExpenseTickets = useMemo(() => {
    return [...expenseTicketLogs]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .filter((log) => {
        if (expenseTicketBranchId && log.branchId !== expenseTicketBranchId) return false;
        if (expenseTicketAssignee && log.assignee !== expenseTicketAssignee) return false;
        if (expenseTicketPayment && log.paymentMethod !== expenseTicketPayment) return false;
        if (expenseTicketLevel) {
          const level = (log.category || "") === "Branch Expense" ? "BRANCH" : "ADMIN";
          if (level !== expenseTicketLevel) return false;
        }
        return true;
      });
  }, [expenseTicketLogs, expenseTicketBranchId, expenseTicketAssignee, expenseTicketPayment, expenseTicketLevel]);

  const expenseTicketPageSize = 5;
  const expenseTicketTotalPages = Math.max(1, Math.ceil(filteredExpenseTickets.length / expenseTicketPageSize));
  const expenseTicketStartIndex = (expenseTicketPage - 1) * expenseTicketPageSize;
  const pagedExpenseTickets = filteredExpenseTickets.slice(
    expenseTicketStartIndex,
    expenseTicketStartIndex + expenseTicketPageSize
  );

  useEffect(() => {
    setExpenseTicketPage(1);
  }, [expenseTicketBranchId, expenseTicketAssignee, expenseTicketPayment, expenseTicketLevel]);

  useEffect(() => {
    setExpenseTicketPage((prev) => Math.min(prev, expenseTicketTotalPages));
  }, [expenseTicketTotalPages]);

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

        <div className="weekly-chart">
          {chartSeries.map((point) => (
            <div key={point.week} className="weekly-chart__bar">
              <div
                style={{
                  height: `${Math.round((point.total / maxValue) * 140)}px`,
                  background: "linear-gradient(180deg, #2563eb, #0ea5e9)",
                  borderRadius: "0.5rem",
                  marginBottom: "0.5rem"
                }}
                title={`Rs ${point.total.toFixed(2)}`}
              />
              <div className="weekly-chart__label">{point.week}</div>
              <div className="weekly-chart__value">Rs {point.total.toFixed(2)}</div>
            </div>
          ))}
          {chartSeries.length === 0 && <p className="muted-text">No data available for the selected series.</p>}
        </div>
      </section>

      <section className="section-card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h4 className="section-title">Branch Expenses</h4>
            <p className="muted-text">Total distributed and daily ticket costs per branch.</p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.85rem", color: "#475569", fontWeight: 600, alignSelf: "center" }}>Date range</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div className="table-wrapper" style={{ marginTop: "1rem" }}>
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                {branchList.map((b) => (
                  <th key={b.id}>{b.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Weekly Distribution</td>
                {branchList.map((b) => (
                  <td key={b.id}>Rs {Number(branchExpenseTotals.get(b.id)?.distributed || 0).toFixed(2)}</td>
                ))}
              </tr>
              <tr>
                <td>Daily Sheet</td>
                {branchList.map((b) => (
                  <td key={b.id}>Rs {Number(branchExpenseTotals.get(b.id)?.daily || 0).toFixed(2)}</td>
                ))}
              </tr>
              <tr>
                <td>Misc Expense</td>
                {branchList.map((b) => (
                  <td key={b.id}>Rs {Number(branchExpenseTotals.get(b.id)?.other || 0).toFixed(2)}</td>
                ))}
              </tr>
              <tr>
                <td>Branch Level</td>
                {branchList.map((b) => (
                  <td key={b.id}>Rs {Number(branchExpenseTotals.get(b.id)?.branchExpenses || 0).toFixed(2)}</td>
                ))}
              </tr>
              <tr>
                <td>Admin Level</td>
                {branchList.map((b) => (
                  <td key={b.id}>Rs {Number(branchExpenseTotals.get(b.id)?.expenseTickets || 0).toFixed(2)}</td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Grand Total</td>
                {branchList.map((b) => (
                  <td key={b.id} style={{ fontWeight: 600 }}>
                    Rs {Number((branchExpenseTotals.get(b.id)?.distributed || 0) + (branchExpenseTotals.get(b.id)?.daily || 0) + (branchExpenseTotals.get(b.id)?.other || 0) + (branchExpenseTotals.get(b.id)?.expenseTickets || 0) + (branchExpenseTotals.get(b.id)?.branchExpenses || 0)).toFixed(2)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Grand Total (All branches)</td>
                <td style={{ fontWeight: 700 }} colSpan={branchList.length}>
                  Rs {Number(expenseGrandTotals.distributed + expenseGrandTotals.daily + expenseGrandTotals.other + expenseGrandTotals.expenseTickets + expenseGrandTotals.branchExpenses).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h4 className="section-title">Expense Logs</h4>
            <p className="muted-text">Admin level and Branch level expenses that were not based on request.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={loadExpenseTicketLogs}>
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
          <select value={expenseTicketBranchId} onChange={(e) => setExpenseTicketBranchId(e.target.value)} style={{ minWidth: 180 }}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select value={expenseTicketAssignee} onChange={(e) => setExpenseTicketAssignee(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">All assignees</option>
            {["Vivek", "Harman", "Bhashit"].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select value={expenseTicketPayment} onChange={(e) => setExpenseTicketPayment(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">All payments</option>
            {["UPI", "Cash", "Paid by assignee"].map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
          <select value={expenseTicketLevel} onChange={(e) => setExpenseTicketLevel(e.target.value)} style={{ minWidth: 150 }}>
            <option value="">Ticket Type</option>
            <option value="ADMIN">Admin Level</option>
            <option value="BRANCH">Branch Level</option>
          </select>
        </div>
        {filteredExpenseTickets.length === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No expense logs yet.</p>}
        <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
          {pagedExpenseTickets.map((log) => {
            const isOpen = expandedExpenseTicketId === log.id;
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
                  onClick={() => setExpandedExpenseTicketId(isOpen ? null : log.id)}
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
                    {log.category} · {branches.find((b) => b.id === log.branchId)?.name || log.branchId} · {log.date}
                  </span>
                  <span>Rs {Number(log.amount || 0).toFixed(2)} {isOpen ? "v" : "+"}</span>
                </button>
                {isOpen && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <div className="muted-text">
                      {log.assignee || "Unassigned"} · {log.paymentMethod || "No payment method"}
                    </div>
                    {log.employeeName && <div className="muted-text">Employee: {log.employeeName}</div>}
                    {log.source && <div className="muted-text">Source: {log.source}</div>}
                    {log.note && <div className="muted-text">Note: {log.note}</div>}
                    {Array.isArray(log.items) && log.items.length > 0 && (
                      <div className="muted-text">
                        Items: {log.items.map((item) => `${item.name} (${item.qty})`).join(", ")}
                      </div>
                    )}
                    {log.attachmentName && (
                      <div className="muted-text">
                        Attachment:{" "}
                        {log.attachmentData ? (
                          <a href={log.attachmentData} download={log.attachmentName}>
                            {log.attachmentName}
                          </a>
                        ) : (
                          log.attachmentName
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {filteredExpenseTickets.length > expenseTicketPageSize && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setExpenseTicketPage((prev) => Math.max(1, prev - 1))}
              disabled={expenseTicketPage === 1}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setExpenseTicketPage((prev) => Math.min(expenseTicketTotalPages, prev + 1))}
              disabled={expenseTicketPage === expenseTicketTotalPages}
            >
              Next
            </button>
          </div>
        )}
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
                                <tr key={`${branch.branchId}-${item.itemId}`} className={item.status === "UNAVAILABLE" ? "row-unavailable" : ""}>
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
