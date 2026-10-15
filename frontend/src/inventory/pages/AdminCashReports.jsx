import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

function formatCurrency(value) {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}

function AdminCashReports() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [logDateFilter, setLogDateFilter] = useState("");
  const [reports, setReports] = useState([]);
  const [rangeTotals, setRangeTotals] = useState({
    onlineSales: 0,
    cashSales: 0,
    onlineExpense: 0,
    cashExpense: 0,
    dueAmount: 0,
    onlinePresent: 0,
    cashPresent: 0,
    verifiedCashPresent: 0,
    verifiedOnlinePresent: 0,
    calculationDiscrepancyCash: 0,
    calculationDiscrepancyOnline: 0,
    totalCalculationDiscrepancy: 0,
    verificationDiscrepancyCash: 0,
    verificationDiscrepancyOnline: 0
  });
  const [accounts, setAccounts] = useState({ cashAccount: 0, onlineAccount: 0, dueAccount: 0 });
  const [errorBanner, setErrorBanner] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const today = new Date();
    const end = today.toISOString().slice(0, 10);
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end);
  }, []);

  useEffect(() => {
    if (!startDate || !endDate) return;
    loadReports(startDate, endDate);
  }, [startDate, endDate]);

  const loadReports = async (start, end) => {
    try {
      setIsLoading(true);
      setErrorBanner("");
      const res = await axios.get("/api/admin/cash-reports", { params: { startDate: start, endDate: end } });
      setReports(res.data?.reports || []);
      setRangeTotals(res.data?.rangeTotals || {});
      setAccounts(res.data?.accounts || { cashAccount: 0, onlineAccount: 0, dueAccount: 0 });
    } catch (err) {
      setErrorBanner("Could not load cash reports.");
    } finally {
      setIsLoading(false);
    }
  };

  const reportRows = useMemo(() => reports || [], [reports]);
  const availableLogDates = useMemo(
    () => Array.from(new Set((reports || []).map((report) => report.date).filter(Boolean))).sort((a, b) => b.localeCompare(a)),
    [reports]
  );
  const filteredReportRows = useMemo(
    () => (logDateFilter ? reportRows.filter((report) => report.date === logDateFilter) : reportRows),
    [logDateFilter, reportRows]
  );
  const totalSales = Number(rangeTotals.onlineSales || 0) + Number(rangeTotals.cashSales || 0);
  const totalExpense = Number(rangeTotals.onlineExpense || 0) + Number(rangeTotals.cashExpense || 0);

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {errorBanner && (
        <div className="banner banner--warning">
          <strong>Warning:</strong> {errorBanner}
        </div>
      )}

      <section className="section-card">
        <div className="cash-management__header cash-reports__header">
          <div>
            <h3 className="section-title">Cash Reports</h3>
            <p className="muted-text">Review verified tally reports for any date range.</p>
          </div>
          <div className="date-range-row cash-reports__filters">
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span className="muted-text field-label">Start date</span>
              <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span className="muted-text field-label">End date</span>
              <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="cash-management__metrics cash-reports__metrics">
          <div className="cash-metric">
            <span className="cash-metric__label">Cash Account</span>
            <strong>{formatCurrency(accounts.cashAccount)}</strong>
          </div>
          <div className="cash-metric">
            <span className="cash-metric__label">Online Account</span>
            <strong>{formatCurrency(accounts.onlineAccount)}</strong>
          </div>
          <div className="cash-metric">
            <span className="cash-metric__label">Due Account</span>
            <strong>{formatCurrency(accounts.dueAccount)}</strong>
          </div>
          <div className="cash-metric">
            <span className="cash-metric__label">Reports In Range</span>
            <strong>{reportRows.length}</strong>
          </div>
        </div>
      </section>

      <section className="section-card">
        <h4 className="section-title">Range Summary</h4>
        <div className="cash-summary-grid cash-summary-grid--reports cash-reports__summary" style={{ marginTop: "1rem" }}>
          <div className="cash-summary-card cash-reports__summary-card">
            <span className="cash-summary-card__label">Online Sales</span>
            <strong>{formatCurrency(rangeTotals.onlineSales)}</strong>
          </div>
          <div className="cash-summary-card cash-reports__summary-card">
            <span className="cash-summary-card__label">Cash Sales</span>
            <strong>{formatCurrency(rangeTotals.cashSales)}</strong>
          </div>
          <div className="cash-summary-card cash-reports__summary-card cash-reports__summary-card--highlight">
            <span className="cash-summary-card__label">Total Sales</span>
            <strong>{formatCurrency(totalSales)}</strong>
          </div>
          <div className="cash-summary-card cash-reports__summary-card">
            <span className="cash-summary-card__label">Online Expense</span>
            <strong>{formatCurrency(rangeTotals.onlineExpense)}</strong>
          </div>
          <div className="cash-summary-card cash-reports__summary-card">
            <span className="cash-summary-card__label">Cash Expense</span>
            <strong>{formatCurrency(rangeTotals.cashExpense)}</strong>
          </div>
          <div className="cash-summary-card cash-reports__summary-card cash-reports__summary-card--highlight">
            <span className="cash-summary-card__label">Total Expense</span>
            <strong>{formatCurrency(totalExpense)}</strong>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="cash-management__header cash-reports__logs-header">
          <div>
            <h4 className="section-title">Daily Logs</h4>
            <p className="muted-text">Each row is an admin-verified daily cash report.</p>
          </div>
          <div className="date-range-row cash-reports__logs-controls">
            <label style={{ display: "grid", gap: "0.35rem", minWidth: 180 }}>
              <span className="muted-text field-label">Log date</span>
              <select value={logDateFilter} onChange={(e) => setLogDateFilter(e.target.value)}>
                <option value="">All dates in range</option>
                {availableLogDates.map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-secondary" onClick={() => loadReports(startDate, endDate)} disabled={isLoading}>
              {isLoading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="table-wrapper cash-reports__table cash-reports__table--desktop" style={{ marginTop: "1rem" }}>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Branch</th>
                <th>Cash Present</th>
                <th>Online Present</th>
                <th>Dues</th>
                <th>Cash Verified</th>
                <th>Online Verified</th>
                <th>Cash Calc Diff</th>
                <th>Online Calc Diff</th>
                <th>Total Calc Diff</th>
                <th>Cash Verify Diff</th>
                <th>Online Verify Diff</th>
                <th>Resolution</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {filteredReportRows.map((report) => (
                <tr key={report.id || `${report.branchId}-${report.date}`}>
                  <td>{report.date}</td>
                  <td>{report.branchName || report.branchId}</td>
                  <td>{formatCurrency(report.totals?.cashPresent)}</td>
                  <td>{formatCurrency(report.totals?.onlinePresent)}</td>
                  <td>{formatCurrency(report.totals?.dueAmount)}</td>
                  <td>{formatCurrency(report.verifiedCashPresent)}</td>
                  <td>{formatCurrency(report.verifiedOnlinePresent)}</td>
                  <td>{formatCurrency(report.calculationDiscrepancyCash)}</td>
                  <td>{formatCurrency(report.calculationDiscrepancyOnline)}</td>
                  <td>{formatCurrency(report.totalCalculationDiscrepancy)}</td>
                  <td>{formatCurrency(report.verificationDiscrepancyCash)}</td>
                  <td>{formatCurrency(report.verificationDiscrepancyOnline)}</td>
                  <td>{report.resolutionReason || (report.hasDiscrepancy ? "-" : "Auto-resolved")}</td>
                  <td>{report.remarks || "-"}</td>
                </tr>
              ))}
              {!filteredReportRows.length && (
                <tr>
                  <td colSpan={14} className="muted-text">No cash reports found for the selected date range.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="cash-reports__mobile-table" style={{ marginTop: "1rem" }}>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Branch</th>
                <th>Present</th>
                <th>Verified</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredReportRows.map((report) => {
                const status = report.hasDiscrepancy
                  ? report.resolutionReason
                    ? "Resolved"
                    : "Mismatch"
                  : "OK";
                return (
                  <tr key={`mobile-row-${report.id || `${report.branchId}-${report.date}`}`}>
                    <td>{report.date}</td>
                    <td>{report.branchName || report.branchId}</td>
                    <td>{`C ${formatCurrency(report.totals?.cashPresent)} / O ${formatCurrency(report.totals?.onlinePresent)} / D ${formatCurrency(report.totals?.dueAmount)}`}</td>
                    <td>{`C ${formatCurrency(report.verifiedCashPresent)} / O ${formatCurrency(report.verifiedOnlinePresent)}`}</td>
                    <td>{status}</td>
                  </tr>
                );
              })}
              {!filteredReportRows.length && (
                <tr>
                  <td colSpan={5} className="muted-text">No cash reports found for the selected date range.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default AdminCashReports;
