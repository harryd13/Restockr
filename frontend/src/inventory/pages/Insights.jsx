import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

function Insights({ reportStartDate = "", reportRefreshKey = 0 }) {
  const [branches, setBranches] = useState([]);
  const [users, setUsers] = useState([]);
  const [purchaseLogs, setPurchaseLogs] = useState([]);
  const [expenseLogs, setExpenseLogs] = useState([]);
  const [expenseTicketLogs, setExpenseTicketLogs] = useState([]);
  const [manualAdjustments, setManualAdjustments] = useState([]);
  const [weeklyOrderAudits, setWeeklyOrderAudits] = useState([]);
  const [weeklyCentralPurchases, setWeeklyCentralPurchases] = useState([]);
  const [weeklyDistributions, setWeeklyDistributions] = useState([]);
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
  const [manualAdjustPage, setManualAdjustPage] = useState(1);
  const [dateRangeInitialized, setDateRangeInitialized] = useState(false);
  const [auditBranchId, setAuditBranchId] = useState("");
  const [auditStatus, setAuditStatus] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [expandedAuditId, setExpandedAuditId] = useState(null);
  const [expandedCentralWeek, setExpandedCentralWeek] = useState(null);
  const [expandedDistributionWeek, setExpandedDistributionWeek] = useState(null);
  const [manualAdjustmentsOpen, setManualAdjustmentsOpen] = useState(false);

  useEffect(() => {
    loadReferenceData();
  }, []);

  useEffect(() => {
    const start = reportStartDate || "";
    if (start) {
      setStartDate(start);
      setEndDate("");
    }
    loadPurchaseLogs(start);
    loadExpenseLogs(start);
    loadExpenseTicketLogs(start);
    loadManualAdjustments(start);
    loadWeeklyOrderAudits(start);
    loadWeeklySummaries(start);
  }, [reportStartDate, reportRefreshKey]);

  const loadReferenceData = async () => {
    const [branchRes, userRes] = await Promise.all([
      axios.get("/api/branches"),
      axios.get("/api/admin/users")
    ]);
    setBranches(branchRes.data || []);
    setUsers(userRes.data || []);
  };

  const assigneeName = (assignee) =>
    users.find((user) => user.id === assignee)?.name || assignee || "Unassigned";

  const loadPurchaseLogs = async (startDateValue) => {
    const params = startDateValue ? { startDate: startDateValue } : undefined;
    const res = await axios.get("/api/reports/purchase-logs", { params });
    setPurchaseLogs(res.data || []);
    setExpandedLogId(null);
    setPurchaseLogsPage(1);
  };

  const loadExpenseLogs = async (startDateValue) => {
    const params = startDateValue ? { startDate: startDateValue } : undefined;
    const res = await axios.get("/api/tickets/expenses", { params });
    setExpenseLogs(res.data || []);
  };

  const loadExpenseTicketLogs = async (startDateValue) => {
    const params = startDateValue ? { startDate: startDateValue } : undefined;
    const res = await axios.get("/api/expense-tickets/logs", { params });
    setExpenseTicketLogs(res.data || []);
  };

  const loadManualAdjustments = async (startDateValue) => {
    const params = startDateValue ? { startDate: startDateValue } : undefined;
    const res = await axios.get("/api/central-inventory/adjustments", { params });
    setManualAdjustments(res.data || []);
    setManualAdjustPage(1);
  };

  const loadWeeklyOrderAudits = async (startDateValue) => {
    const params = startDateValue ? { startDate: startDateValue } : undefined;
    const res = await axios.get("/api/reports/weekly-order-audit", { params });
    setWeeklyOrderAudits(res.data || []);
    setAuditPage(1);
    setExpandedAuditId(null);
  };

  const loadWeeklySummaries = async (startDateValue) => {
    const params = startDateValue ? { startDate: startDateValue } : undefined;
    const [centralRes, distributionRes] = await Promise.all([
      axios.get("/api/reports/weekly-central-purchases", { params }),
      axios.get("/api/reports/weekly-distributions", { params })
    ]);
    setWeeklyCentralPurchases(centralRes.data || []);
    setWeeklyDistributions(distributionRes.data || []);
    setExpandedCentralWeek(null);
    setExpandedDistributionWeek(null);
  };

  const requestDisplay = (log, section) => {
    const sameBranch = (log.branches || []).filter((entry) => entry.branchId === section.branchId);
    const identity = section.requestId || section.distributionRunId || section.orderLogId;
    const position = sameBranch.findIndex((entry) => (entry.requestId || entry.distributionRunId || entry.orderLogId) === identity);
    const createdAt = section.requestCreatedAt || section.orderedAt || section.createdAt || section.finalizedAt;
    const createdLabel = createdAt ? new Date(createdAt).toLocaleDateString() : "Date unavailable";
    return `Request ${position >= 0 ? position + 1 : 1} · Created ${createdLabel}`;
  };

  const branchList = useMemo(() => [...branches, { id: "CENTRAL", name: "Central Inventory" }], [branches]);

  useEffect(() => {
    if (dateRangeInitialized) return;
    const today = new Date();
    const end = today.toISOString().slice(0, 10);
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    const startIso = start.toISOString().slice(0, 10);
    setStartDate(startIso);
    setEndDate(end);
    setDateRangeInitialized(true);
  }, [dateRangeInitialized]);

  const branchExpenseTotals = useMemo(() => {
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (end) end.setHours(23, 59, 59, 999);

    const totals = new Map();
    branchList.forEach((b) =>
      totals.set(b.id, { daily: 0, other: 0, adminExpenses: 0, branchExpenses: 0, centralPurchases: 0, pendingExpenses: 0 })
    );

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
      if (log.status === "DELETED") return;
      const date = log.paidAt || log.date || log.createdAt ? new Date(log.paidAt || log.date || log.createdAt) : null;
      if (start && date && date < start) return;
      if (end && date && date > end) return;
      if (!totals.has(log.branchId)) return;
      const entry = totals.get(log.branchId);
      if (log.sourceType === "WEEKLY_PURCHASE_PAYMENT") {
        entry.centralPurchases += Number(log.amount || 0);
      } else if (log.sourceType === "PENDING_SETTLEMENT") {
        entry.pendingExpenses += Number(log.amount || 0);
      } else if ((log.category || "") === "Branch Expense") {
        entry.branchExpenses = (entry.branchExpenses || 0) + Number(log.amount || 0);
      } else {
        entry.adminExpenses = (entry.adminExpenses || 0) + Number(log.amount || 0);
      }
    });

    return totals;
  }, [expenseLogs, expenseTicketLogs, branchList, startDate, endDate]);

  const expenseGrandTotals = useMemo(() => {
    let daily = 0;
    let other = 0;
    let adminExpenses = 0;
    let branchExpenses = 0;
    let centralPurchases = 0;
    let pendingExpenses = 0;
    branchExpenseTotals.forEach((value) => {
      daily += value.daily || 0;
      other += value.other || 0;
      adminExpenses += value.adminExpenses || 0;
      branchExpenses += value.branchExpenses || 0;
      centralPurchases += value.centralPurchases || 0;
      pendingExpenses += value.pendingExpenses || 0;
    });
    return { daily, other, adminExpenses, branchExpenses, centralPurchases, pendingExpenses };
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

  const purchaseLogsPageSize = 5;
  const purchaseLogsTotalPages = Math.max(1, Math.ceil(purchaseLogs.length / purchaseLogsPageSize));
  const purchaseLogsStartIndex = (purchaseLogsPage - 1) * purchaseLogsPageSize;
  const pagedPurchaseLogs = purchaseLogs.slice(purchaseLogsStartIndex, purchaseLogsStartIndex + purchaseLogsPageSize);

  useEffect(() => {
    setPurchaseLogsPage((prev) => Math.min(prev, purchaseLogsTotalPages));
  }, [purchaseLogsTotalPages]);

  const manualAdjustPageSize = 5;
  const manualAdjustTotalPages = Math.max(1, Math.ceil(manualAdjustments.length / manualAdjustPageSize));
  const manualAdjustStartIndex = (manualAdjustPage - 1) * manualAdjustPageSize;
  const pagedManualAdjustments = manualAdjustments.slice(
    manualAdjustStartIndex,
    manualAdjustStartIndex + manualAdjustPageSize
  );

  useEffect(() => {
    setManualAdjustPage((prev) => Math.min(prev, manualAdjustTotalPages));
  }, [manualAdjustTotalPages]);

  const filteredAudits = useMemo(() => weeklyOrderAudits.filter((audit) => {
    if (auditBranchId && audit.branchId !== auditBranchId) return false;
    if (auditStatus && audit.status !== auditStatus) return false;
    return true;
  }), [weeklyOrderAudits, auditBranchId, auditStatus]);
  const auditPageSize = 5;
  const auditTotalPages = Math.max(1, Math.ceil(filteredAudits.length / auditPageSize));
  const pagedAudits = filteredAudits.slice((auditPage - 1) * auditPageSize, auditPage * auditPageSize);

  useEffect(() => {
    setAuditPage(1);
  }, [auditBranchId, auditStatus]);

  useEffect(() => {
    setAuditPage((page) => Math.min(page, auditTotalPages));
  }, [auditTotalPages]);

  const auditEventLabel = (type) => ({
    REQUEST_SUBMITTED: "Request submitted",
    ORDERED: "Order placed",
    RECEIPT_VERIFIED: "Branch receipt verified",
    PAYMENT_RECORDED: "Payment recorded",
    INVENTORY_COMMITTED: "Inventory committed",
    DISTRIBUTION_CLOSED: "Distribution closed"
  }[type] || type);

  const auditRequestDisplay = (audit) => {
    const sameBranchWeek = weeklyOrderAudits
      .filter((entry) => entry.branchId === audit.branchId && entry.weekStartDate === audit.weekStartDate)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const position = sameBranchWeek.findIndex((entry) => entry.id === audit.id);
    const createdLabel = audit.createdAt ? new Date(audit.createdAt).toLocaleDateString() : "Date unavailable";
    return `Request ${position >= 0 ? position + 1 : 1} · Created ${createdLabel}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section className="section-card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h4 className="section-title">Expense Summary</h4>
            <p className="muted-text hide-on-mobile">Actual expenses by branch. Pending tickets count only when a payment or partial settlement is recorded.</p>
          </div>
          <div className="date-range-row">
            <label style={{ fontSize: "0.85rem", color: "#475569", fontWeight: 600, alignSelf: "center" }}>Date range</label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span className="muted-text field-label">From</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span className="muted-text field-label">To</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
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
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Daily Sheet</td>
                {branchList.map((b) => (
                  <td key={b.id}>Rs {Number(branchExpenseTotals.get(b.id)?.daily || 0).toFixed(2)}</td>
                ))}
                <td>Rs {Number(expenseGrandTotals.daily || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Misc Expense</td>
                {branchList.map((b) => (
                  <td key={b.id}>Rs {Number(branchExpenseTotals.get(b.id)?.other || 0).toFixed(2)}</td>
                ))}
                <td>Rs {Number(expenseGrandTotals.other || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Branch Level</td>
                {branchList.map((b) => (
                  <td key={b.id}>Rs {Number(branchExpenseTotals.get(b.id)?.branchExpenses || 0).toFixed(2)}</td>
                ))}
                <td>Rs {Number(expenseGrandTotals.branchExpenses || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Admin Level</td>
                {branchList.map((b) => (
                  <td key={b.id}>Rs {Number(branchExpenseTotals.get(b.id)?.adminExpenses || 0).toFixed(2)}</td>
                ))}
                <td>Rs {Number(expenseGrandTotals.adminExpenses || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Weekly Central Purchase</td>
                {branchList.map((b) => (
                  <td key={b.id}>Rs {Number(branchExpenseTotals.get(b.id)?.centralPurchases || 0).toFixed(2)}</td>
                ))}
                <td>Rs {Number(expenseGrandTotals.centralPurchases || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Pending Expense</td>
                {branchList.map((b) => (
                  <td key={b.id}>Rs {Number(branchExpenseTotals.get(b.id)?.pendingExpenses || 0).toFixed(2)}</td>
                ))}
                <td>Rs {Number(expenseGrandTotals.pendingExpenses || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Grand Total</td>
                {branchList.map((b) => (
                  <td key={b.id} style={{ fontWeight: 600 }}>
                    Rs {Number((branchExpenseTotals.get(b.id)?.daily || 0) + (branchExpenseTotals.get(b.id)?.other || 0) + (branchExpenseTotals.get(b.id)?.adminExpenses || 0) + (branchExpenseTotals.get(b.id)?.branchExpenses || 0) + (branchExpenseTotals.get(b.id)?.centralPurchases || 0) + (branchExpenseTotals.get(b.id)?.pendingExpenses || 0)).toFixed(2)}
                  </td>
                ))}
                <td style={{ fontWeight: 700 }}>Rs {Number(expenseGrandTotals.daily + expenseGrandTotals.other + expenseGrandTotals.adminExpenses + expenseGrandTotals.branchExpenses + expenseGrandTotals.centralPurchases + expenseGrandTotals.pendingExpenses).toFixed(2)}</td>
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
            <option value="CENTRAL">Central Inventory</option>
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
                    {log.category} · {log.branchId === "CENTRAL" ? "Central Inventory" : branches.find((b) => b.id === log.branchId)?.name || log.branchId} · {log.date}
                  </span>
                  {log.status === "DELETED" && <span className="stats-pill">Deleted</span>}
                  <span>Rs {Number(log.amount || 0).toFixed(2)} {isOpen ? "v" : "+"}</span>
                </button>
                {isOpen && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <div className="muted-text">
                      {assigneeName(log.assignee)} · {log.paymentMethod || "No payment method"}
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

      <section className="section-card" style={{ order: 999 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h4 className="section-title">Manual Adjustments</h4>
            <p className="muted-text">Inventory changes recorded outside purchase tickets.</p>
          </div>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => setManualAdjustmentsOpen((open) => !open)}
            aria-expanded={manualAdjustmentsOpen}
          >
            {manualAdjustmentsOpen ? "Collapse" : "Expand"}
          </button>
        </div>
        {manualAdjustmentsOpen && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" }}>
              <button className="btn btn-secondary" type="button" onClick={loadManualAdjustments}>Refresh</button>
            </div>
        {pagedManualAdjustments.length === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No adjustments logged yet.</p>}
        <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
          {pagedManualAdjustments.map((log) => (
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
                <span>
                  {log.itemName} Â· {log.categoryName || "Uncategorized"} Â· {log.mode}
                </span>
                <span>{new Date(log.createdAt).toLocaleString()}</span>
              </div>
              <div className="muted-text" style={{ marginTop: "0.35rem" }}>
                Delta {log.delta} Â· Before {log.beforeQty} Â· After {log.afterQty}
              </div>
              <div className="muted-text" style={{ marginTop: "0.35rem" }}>
                Reason: {log.reason || "-"}
              </div>
            </div>
          ))}
        </div>
        {manualAdjustments.length > manualAdjustPageSize && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setManualAdjustPage((prev) => Math.max(1, prev - 1))}
              disabled={manualAdjustPage === 1}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setManualAdjustPage((prev) => Math.min(manualAdjustTotalPages, prev + 1))}
              disabled={manualAdjustPage === manualAdjustTotalPages}
            >
              Next
            </button>
          </div>
        )}
          </>
        )}
      </section>

      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
          <div>
            <h4 className="section-title">Central Purchase Logs</h4>
            <p className="muted-text">One live log per week. This is what the admin actually bought and paid for, including stock not sent to a branch.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => loadWeeklySummaries(reportStartDate)}>Refresh</button>
        </div>
        {weeklyCentralPurchases.length === 0 && <p className="muted-text">No weekly purchases ordered yet.</p>}
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
          {weeklyCentralPurchases.map((log) => {
            const isOpen = expandedCentralWeek === log.weekStartDate;
            return (
              <div key={log.id || log.weekStartDate} className="central-purchase-log" style={{ border: "1px solid #e2e8f0", borderRadius: "1rem", padding: "0.75rem 1rem", background: "#f8fafc" }}>
                <button className="weekly-log-toggle" type="button" onClick={() => setExpandedCentralWeek(isOpen ? null : log.weekStartDate)} style={{ width: "100%", border: 0, background: "transparent", cursor: "pointer", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.75rem", textAlign: "left" }}>
                  <span><strong>Week {log.weekStartDate}</strong> · {log.branchCount || 0} branches · {log.requestCount ?? (log.branches || []).length} requests · {log.status}</span>
                  <span>Purchased Rs {Number(log.totals?.purchaseAmount || 0).toFixed(2)} {isOpen ? "v" : "+"}</span>
                </button>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.65rem" }}>
                  <span className="stats-pill">Paid Rs {Number(log.totals?.paidAmount || 0).toFixed(2)}</span>
                  <span className="stats-pill">Pending Rs {Number(log.totals?.pendingAmount || 0).toFixed(2)}</span>
                  <span className="stats-pill">Cash Rs {Number(log.totals?.cashPaid || 0).toFixed(2)}</span>
                  <span className="stats-pill">UPI Rs {Number(log.totals?.upiPaid || 0).toFixed(2)}</span>
                </div>
                {isOpen && (
                  <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {(log.branches || []).map((branch) => (
                  <div key={`${branch.branchId}:${branch.requestId || branch.distributionRunId || branch.orderLogId}`} style={{ padding: "0.5rem 0", borderTop: "1px solid #e2e8f0" }}>
                    <div className="weekly-log-branch-header" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.35rem" }}>
                      <strong>{branches.find((entry) => entry.id === branch.branchId)?.name || branch.branchId} · {requestDisplay(log, branch)}</strong>
                      <span>Rs {Number(branch.purchaseAmount || 0).toFixed(2)} · {branch.status}</span>
                    </div>
                    <div className="table-wrapper weekly-log-table"><table><thead><tr><th>Item</th><th>Ordered</th><th>Actually purchased</th><th>Order estimate</th><th>Final price</th><th>Purchase amount</th><th>Payment</th></tr></thead><tbody>
                      {(branch.items || []).map((item) => <tr key={item.itemId}><td data-label="Item">{item.itemName}</td><td data-label="Ordered">{item.orderedQty}</td><td data-label="Actually purchased">{item.actualPurchaseQty}</td><td data-label="Order estimate">Rs {Number(item.orderedEstimatedUnitPrice || 0).toFixed(2)}</td><td data-label="Final price">Rs {Number(item.finalUnitPrice || 0).toFixed(2)}</td><td data-label="Purchase amount">Rs {Number(item.purchaseAmount || 0).toFixed(2)}</td><td data-label="Payment">{item.paymentStatus}{item.paymentMethod ? ` · ${item.paymentMethod}` : ""}</td></tr>)}
                    </tbody></table></div>
                    <div className="weekly-log-mobile-list">
                      {(branch.items || []).map((item) => (
                        <details className="weekly-log-mobile-item" key={`mobile-${item.itemId}`}>
                          <summary><strong>{item.itemName}</strong><span className="weekly-log-mobile-item__quantities"><b>O {item.orderedQty}</b><b>B {item.actualPurchaseQty}</b></span></summary>
                          <div className="weekly-log-mobile-item__details">
                            <span>Order estimate <b>Rs {Number(item.orderedEstimatedUnitPrice || 0).toFixed(2)}</b></span>
                            <span>Final price <b>Rs {Number(item.finalUnitPrice || 0).toFixed(2)}</b></span>
                            <span>Purchase amount <b>Rs {Number(item.purchaseAmount || 0).toFixed(2)}</b></span>
                            <span>Payment <b>{item.paymentStatus}{item.paymentMethod ? ` · ${item.paymentMethod}` : ""}</b></span>
                          </div>
                        </details>
                      ))}
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

      <section className="section-card">
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
          <div>
            <h4 className="section-title">Weekly Order Audit</h4>
            <p className="muted-text">Trace each branch order from submission through payment, receipt review, inventory commitment, and close.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => loadWeeklyOrderAudits(reportStartDate)}>Refresh</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.75rem" }}>
          <select value={auditBranchId} onChange={(event) => setAuditBranchId(event.target.value)}>
            <option value="">All branches</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
          <select value={auditStatus} onChange={(event) => setAuditStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="AWAITING_RECEIPT">Awaiting receipt</option>
            <option value="RECEIVED_PENDING_REVIEW">Pending admin review</option>
            <option value="FINALIZED">Distributed</option>
          </select>
        </div>
        {pagedAudits.length === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No weekly branch orders found.</p>}
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
          {pagedAudits.map((audit) => {
            const isOpen = expandedAuditId === audit.id;
            const branchName = branches.find((branch) => branch.id === audit.branchId)?.name || audit.branchId;
            return (
              <div key={audit.id} style={{ border: "1px solid #e2e8f0", borderRadius: "1rem", padding: "0.75rem 1rem", background: "#f8fafc" }}>
                <button type="button" onClick={() => setExpandedAuditId(isOpen ? null : audit.id)} style={{ width: "100%", border: 0, background: "transparent", cursor: "pointer", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.75rem", textAlign: "left", color: "#0f172a" }}>
                  <span><strong>{branchName}</strong> · Week {audit.weekStartDate || "-"} · {auditRequestDisplay(audit)}</span>
                  <span><span className="stats-pill">{audit.status}</span> {isOpen ? "v" : "+"}</span>
                </button>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.65rem" }}>
                  <span className="stats-pill">Order Rs {Number(audit.order?.estimatedTotal || 0).toFixed(2)}</span>
                  <span className="stats-pill">Paid Rs {Number(audit.payments?.total || 0).toFixed(2)}</span>
                  <span className="stats-pill">Mismatches {Number(audit.mismatchCount || 0)}</span>
                  {audit.pendingTicket && <span className="stats-pill">Ticket {audit.pendingTicket.status}</span>}
                </div>
                {isOpen && (
                  <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
                    <div className="table-wrapper">
                      <table>
                        <thead><tr><th>Item</th><th>Requested</th><th>Central reserved</th><th>Ordered</th><th>Actually purchased</th><th>Order estimate</th><th>Final price</th><th>Branch received</th><th>Final</th><th>Central committed</th><th>Released</th><th>Purchase sent</th><th>Purchase surplus</th><th>Payment</th><th>Review reason</th></tr></thead>
                        <tbody>
                          {(audit.items || []).map((item) => (
                            <tr key={item.id} className={item.mismatchReason ? "row-unavailable" : ""}>
                              <td>{item.itemName}</td><td>{item.requestedQty}</td><td>{item.centralReservedQty}</td><td>{item.orderedQty}</td><td>{item.actualPurchaseQty}</td><td>Rs {Number(item.orderedEstimatedUnitPrice || 0).toFixed(2)}</td><td>Rs {Number(item.finalUnitPrice || 0).toFixed(2)}</td>
                              <td>{item.branchReportedQty ?? "-"}</td><td>{item.finalDeliveredQty ?? "-"}</td><td>{item.centralCommittedQty}</td><td>{item.centralReleasedQty}</td><td>{item.purchasedDeliveredQty}</td><td>{item.purchasedSurplusQty}</td>
                              <td>{item.paymentStatus}{item.paymentMethod ? ` · ${item.paymentMethod}` : ""}</td><td>{item.mismatchReason || "Matched"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {audit.inventory && (
                      <div className="muted-text">Inventory commitment: {audit.inventory.centralCommittedQty} central committed · {audit.inventory.centralReleasedQty} released · {audit.inventory.purchasedDeliveredQty} vendor delivered</div>
                    )}
                    <div>
                      <strong>Audit timeline</strong>
                      <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.5rem" }}>
                        {(audit.events || []).map((event, index) => (
                          <div className="muted-text" key={`${event.type}-${event.at}-${index}`}>
                            {new Date(event.at).toLocaleString()} · {auditEventLabel(event.type)}
                            {event.amount ? ` · Rs ${Number(event.amount).toFixed(2)}` : ""}
                            {event.paymentMethod ? ` · ${event.paymentMethod}` : ""}
                            {event.by ? ` · by ${assigneeName(event.by)}` : ""}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {filteredAudits.length > auditPageSize && (
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setAuditPage((page) => Math.max(1, page - 1))} disabled={auditPage === 1}>Prev</button>
            <span className="muted-text">Page {auditPage} of {auditTotalPages}</span>
            <button type="button" className="btn btn-ghost" onClick={() => setAuditPage((page) => Math.min(auditTotalPages, page + 1))} disabled={auditPage === auditTotalPages}>Next</button>
          </div>
        )}
      </section>

      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div>
            <h4 className="section-title">Weekly Distribution Logs</h4>
            <p className="muted-text">One finalized weekly log showing exactly what reached each branch. This is stock movement, not cash spend.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => loadWeeklySummaries(reportStartDate)}>
            Refresh
          </button>
        </div>
        {weeklyDistributions.length === 0 && <p className="muted-text">No distributions finalized yet.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {weeklyDistributions.map((log) => {
            const isOpen = expandedDistributionWeek === log.weekStartDate;
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
                  className="weekly-log-toggle"
                  type="button"
                  onClick={() => setExpandedDistributionWeek(isOpen ? null : log.weekStartDate)}
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
                    Week {log.weekStartDate} · {log.branchCount || 0} branches · {log.requestCount ?? (log.branches || []).length} requests · {log.status}
                  </span>
                  <span>{Number(log.totals?.finalDeliveredQty || 0)} units · Rs {Number(log.totals?.purchasedDistributedValue || 0).toFixed(2)} purchased value {isOpen ? "v" : "+"}</span>
                </button>
                {isOpen && (
                  <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {(log.branches || []).map((branch) => (
                      <div key={`${branch.branchId}:${branch.requestId || branch.distributionRunId}`} style={{ padding: "0.5rem 0", borderTop: "1px solid #e2e8f0" }}>
                        <div className="weekly-log-branch-header" style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.35rem" }}>
                          <strong>{branches.find((b) => b.id === branch.branchId)?.name || branch.branchId} · {requestDisplay(log, branch)}</strong>
                          <span>{Number(branch.finalDeliveredQty || 0)} units · Rs {Number(branch.purchasedDistributedValue || 0).toFixed(2)} purchased value</span>
                        </div>
                        <div className="table-wrapper weekly-log-table">
                          <table>
                            <thead>
                              <tr>
                                <th>Item</th>
                                <th>Requested</th>
                                <th>Final delivered</th>
                                <th>From central</th>
                                <th>From purchase</th>
                                <th>Purchase surplus</th>
                                <th>Purchased value sent</th>
                                <th>Mismatch Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {branch.items.map((item) => (
                                <tr key={`${branch.branchId}-${item.itemId}`} className={item.status === "UNAVAILABLE" ? "row-unavailable" : ""}>
                                  <td data-label="Item">{item.itemName}</td>
                                  <td data-label="Requested">{item.requestedQty}</td>
                                  <td data-label="Final delivered">{item.finalDeliveredQty}</td>
                                  <td data-label="From central">{item.centralCommittedQty}</td>
                                  <td data-label="From purchase">{item.purchasedDeliveredQty}</td>
                                  <td data-label="Purchase surplus">{item.purchasedSurplusQty}</td>
                                  <td data-label="Purchased value sent">Rs {Number(item.purchasedDistributedValue || 0).toFixed(2)}</td>
                                  <td data-label="Mismatch reason">{item.mismatchReason || "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="weekly-log-mobile-list">
                          {branch.items.map((item) => (
                            <details className={`weekly-log-mobile-item${item.status === "UNAVAILABLE" ? " weekly-log-mobile-item--warning" : ""}`} key={`mobile-${branch.branchId}-${item.itemId}`}>
                              <summary><strong>{item.itemName}</strong><span>Requested {item.requestedQty} · Delivered {item.finalDeliveredQty}</span></summary>
                              <div className="weekly-log-mobile-item__details">
                                <span>From central <b>{item.centralCommittedQty}</b></span>
                                <span>From purchase <b>{item.purchasedDeliveredQty}</b></span>
                                <span>Purchase surplus <b>{item.purchasedSurplusQty}</b></span>
                                <span>Purchased value sent <b>Rs {Number(item.purchasedDistributedValue || 0).toFixed(2)}</b></span>
                                <span>Mismatch reason <b>{item.mismatchReason || "-"}</b></span>
                              </div>
                            </details>
                          ))}
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
