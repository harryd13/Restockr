import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../components/Modal";

function formatCurrency(value) {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}

function sanitizeNumericInput(value) {
  const raw = String(value || "");
  const cleaned = raw.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function getDiscrepancyTone(value, resolved = false) {
  if (Number(value || 0) === 0) return "cash-discrepancy-card cash-discrepancy-card--ok";
  if (resolved) return "cash-discrepancy-card cash-discrepancy-card--resolved";
  return "cash-discrepancy-card cash-discrepancy-card--alert";
}

const EXPENSE_TICKET_PREFILL_KEY = "foffee_expense_ticket_prefill";

function AdminCashManagement({ onNavigate }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [branches, setBranches] = useState([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState([]);
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({
    onlineSales: 0,
    cashSales: 0,
    onlineExpense: 0,
    cashExpense: 0,
    onlinePresent: 0,
    cashPresent: 0,
    submittedBranches: 0
  });
  const [accounts, setAccounts] = useState({ cashAccount: 0, onlineAccount: 0 });
  const [errorBanner, setErrorBanner] = useState("");
  const [successBanner, setSuccessBanner] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeRow, setActiveRow] = useState(null);
  const [verifiedCashPresent, setVerifiedCashPresent] = useState("");
  const [verifiedOnlinePresent, setVerifiedOnlinePresent] = useState("");
  const [remarks, setRemarks] = useState("");
  const [resolutionReason, setResolutionReason] = useState("");
  const [showResolveModal, setShowResolveModal] = useState(false);

  const selectedRows = useMemo(() => rows.filter((row) => selectedBranchIds.includes(row.branchId)), [rows, selectedBranchIds]);

  const loadSummary = async (targetDate = date, branchIds = selectedBranchIds, preserveSelection = false) => {
    try {
      setIsLoading(true);
      setErrorBanner("");
      const params = { date: targetDate };
      if (branchIds.length) params.branchIds = branchIds.join(",");
      const res = await axios.get("/api/admin/cash-management/summary", { params });
      const branchList = res.data?.branches || [];
      const nextSelected = preserveSelection && branchIds.length ? branchIds : res.data?.selectedBranchIds || branchList.map((branch) => branch.id);
      const nextRows = (res.data?.rows || []).filter((row) => nextSelected.includes(row.branchId));
      setBranches(branchList);
      setSelectedBranchIds(nextSelected);
      setRows(nextRows);
      setTotals(
        nextRows.reduce(
          (acc, row) => ({
            onlineSales: acc.onlineSales + Number(row.onlineSales || 0),
            cashSales: acc.cashSales + Number(row.cashSales || 0),
            onlineExpense: acc.onlineExpense + Number(row.onlineExpense || 0),
            cashExpense: acc.cashExpense + Number(row.cashExpense || 0),
            onlinePresent: acc.onlinePresent + Number(row.onlinePresent || 0),
            cashPresent: acc.cashPresent + Number(row.cashPresent || 0),
            submittedBranches: acc.submittedBranches + (row.submitted ? 1 : 0)
          }),
          {
            onlineSales: 0,
            cashSales: 0,
            onlineExpense: 0,
            cashExpense: 0,
            onlinePresent: 0,
            cashPresent: 0,
            submittedBranches: 0
          }
        )
      );
      setAccounts(res.data?.accounts || { cashAccount: 0, onlineAccount: 0 });
    } catch (err) {
      setErrorBanner("Could not load admin cash management.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!date) return;
    loadSummary(date, [], false);
  }, [date]);

  const toggleBranch = (branchId) => {
    setSelectedBranchIds((prev) => (prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]));
  };

  const openVerifyModal = (row) => {
    if (!row.submitted) {
      setErrorBanner("This branch has not submitted its tally for the selected date.");
      return;
    }
    setErrorBanner("");
    setActiveRow(row);
    setVerifiedCashPresent(String(row.report?.verifiedCashPresent ?? row.cashPresent ?? ""));
    setVerifiedOnlinePresent(String(row.report?.verifiedOnlinePresent ?? row.onlinePresent ?? ""));
    setRemarks(row.report?.remarks || "");
    setResolutionReason(row.report?.resolutionReason || "");
    setShowResolveModal(false);
  };

  const closeVerifyModal = () => {
    if (isSaving) return;
    setActiveRow(null);
    setShowResolveModal(false);
  };

  const saveVerification = async () => {
    if (!activeRow) return;
    try {
      setIsSaving(true);
      setErrorBanner("");
      const res = await axios.post("/api/admin/cash-management/verify", {
        date,
        branchId: activeRow.branchId,
        verifiedCashPresent: Number.parseFloat(verifiedCashPresent) || 0,
        verifiedOnlinePresent: Number.parseFloat(verifiedOnlinePresent) || 0,
        remarks,
        resolutionReason
      });
      setAccounts(res.data?.accounts || { cashAccount: 0, onlineAccount: 0 });
      setSuccessBanner(`Cash report verified for ${activeRow.branchName}.`);
      setActiveRow(null);
      await loadSummary(date, selectedBranchIds, true);
    } catch (err) {
      setErrorBanner(err?.response?.data?.message || "Could not verify branch cash report.");
    } finally {
      setIsSaving(false);
    }
  };

  const openExpenseTicketForDiscrepancy = (paymentMethod, amount) => {
    if (!activeRow || Number(amount || 0) <= 0) return;
    localStorage.setItem(
      EXPENSE_TICKET_PREFILL_KEY,
      JSON.stringify({
        category: "Other",
        branchId: activeRow.branchId,
        assignee: "Vivek",
        paymentMethod,
        status: "LOGGED",
        amount: Number(amount || 0).toFixed(2),
        date,
        note: `Auto-filled from ${paymentMethod} calculation discrepancy for ${activeRow.branchName} on ${date}.`,
        banner: "Expense ticket draft loaded from cash management discrepancy."
      })
    );
    closeVerifyModal();
    onNavigate?.("home");
  };

  const calculationDiscrepancyCash = activeRow ? Number(activeRow.calculationDiscrepancyCash || 0) : 0;
  const calculationDiscrepancyOnline = activeRow ? Number(activeRow.calculationDiscrepancyOnline || 0) : 0;
  const verificationDiscrepancyCash = activeRow ? Number(activeRow.cashPresent || 0) - (Number.parseFloat(verifiedCashPresent) || 0) : 0;
  const verificationDiscrepancyOnline = activeRow ? Number(activeRow.onlinePresent || 0) - (Number.parseFloat(verifiedOnlinePresent) || 0) : 0;
  const hasActiveDiscrepancy =
    calculationDiscrepancyCash !== 0 ||
    calculationDiscrepancyOnline !== 0 ||
    verificationDiscrepancyCash !== 0 ||
    verificationDiscrepancyOnline !== 0;
  const discrepancyResolved = !hasActiveDiscrepancy || !!resolutionReason.trim();
  const verifyDisabled = isSaving || (hasActiveDiscrepancy && !resolutionReason.trim());

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
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

      <section className="section-card">
        <div className="cash-management__header">
          <div>
            <h3 className="section-title">Admin Cash Management</h3>
            <p className="muted-text">Review and verify each branch tally for the selected day.</p>
          </div>
          <label style={{ display: "grid", gap: "0.35rem", minWidth: 180 }}>
            <span className="muted-text field-label">Date</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        <div className="cash-management__metrics">
          <div className="cash-metric">
            <span className="cash-metric__label">Cash Account</span>
            <strong>{formatCurrency(accounts.cashAccount)}</strong>
          </div>
          <div className="cash-metric">
            <span className="cash-metric__label">Online Account</span>
            <strong>{formatCurrency(accounts.onlineAccount)}</strong>
          </div>
          <div className="cash-metric">
            <span className="cash-metric__label">Selected Branches</span>
            <strong>{selectedBranchIds.length}</strong>
          </div>
          <div className="cash-metric">
            <span className="cash-metric__label">Submitted Tallies</span>
            <strong>{totals.submittedBranches}</strong>
          </div>
        </div>

        <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary cash-action-btn" onClick={() => loadSummary(date, selectedBranchIds, true)} disabled={isLoading}>
            {isLoading ? "Loading..." : "Refresh Summary"}
          </button>
          <button type="button" className="btn btn-ghost cash-action-btn" onClick={() => setSelectedBranchIds(branches.map((branch) => branch.id))} disabled={!branches.length}>
            Select all
          </button>
        </div>
      </section>

      <section className="section-card">
        <h4 className="section-title">Branches</h4>
        <div className="chip-row" style={{ marginTop: "0.75rem" }}>
          {branches.map((branch) => (
            <label key={branch.id} className={`cash-branch-chip ${selectedBranchIds.includes(branch.id) ? "cash-branch-chip--active" : ""}`}>
              <input type="checkbox" checked={selectedBranchIds.includes(branch.id)} onChange={() => toggleBranch(branch.id)} />
              <span>{branch.name}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="section-card">
        <div className="cash-management__header">
          <div>
            <h4 className="section-title">Branch Summary</h4>
            <p className="muted-text">Every branch must be reviewed and verified separately for the day.</p>
          </div>
          <span className="stats-pill">{date}</span>
        </div>

        <div className="table-wrapper" style={{ marginTop: "1rem" }}>
          <table>
            <thead>
              <tr>
                <th>Branch</th>
                <th>Online Sales</th>
                <th>Cash Sales</th>
                <th>Online Expense</th>
                <th>Cash Expense</th>
                <th>Online Present</th>
                <th>Cash Present</th>
                <th>Calc Status</th>
                <th>Handover Status</th>
                <th>Verified</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {selectedRows.map((row) => (
                <tr key={row.branchId}>
                  <td>{row.branchName}</td>
                  <td>{formatCurrency(row.onlineSales)}</td>
                  <td>{formatCurrency(row.cashSales)}</td>
                  <td>{formatCurrency(row.onlineExpense)}</td>
                  <td>{formatCurrency(row.cashExpense)}</td>
                  <td>{formatCurrency(row.onlinePresent)}</td>
                  <td>{formatCurrency(row.cashPresent)}</td>
                  <td>
                    {row.calculationDiscrepancyCash === 0 && row.calculationDiscrepancyOnline === 0 ? "OK" : "Mismatch"}
                  </td>
                  <td>
                    {row.report
                      ? row.report.verificationDiscrepancyCash === 0 && row.report.verificationDiscrepancyOnline === 0
                        ? "Matched"
                        : row.report.resolutionReason
                        ? "Resolved"
                        : "Mismatch"
                      : "Pending"}
                  </td>
                  <td>{row.report ? "Yes" : row.submitted ? "Pending" : "Not submitted"}</td>
                  <td>
                    <button type="button" className="btn btn-secondary ticket-card__btn" onClick={() => openVerifyModal(row)} disabled={!row.submitted}>
                      {row.report ? "Review again" : "Review & Verify"}
                    </button>
                  </td>
                </tr>
              ))}
              {!selectedRows.length && (
                <tr>
                  <td colSpan={11} className="muted-text">No branches selected.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="cash-mobile-list" style={{ marginTop: "1rem" }}>
          {selectedRows.map((row) => (
            <article key={`mobile-${row.branchId}`} className="cash-mobile-card">
              <div className="cash-mobile-card__header">
                <strong>{row.branchName}</strong>
                <span className="stats-pill">{row.report ? "Verified" : row.submitted ? "Pending" : "Not submitted"}</span>
              </div>
              <div className="cash-mobile-card__grid">
                <div><span className="cash-mobile-card__label">Online Sales</span><strong>{formatCurrency(row.onlineSales)}</strong></div>
                <div><span className="cash-mobile-card__label">Cash Sales</span><strong>{formatCurrency(row.cashSales)}</strong></div>
                <div><span className="cash-mobile-card__label">Online Expense</span><strong>{formatCurrency(row.onlineExpense)}</strong></div>
                <div><span className="cash-mobile-card__label">Cash Expense</span><strong>{formatCurrency(row.cashExpense)}</strong></div>
                <div><span className="cash-mobile-card__label">Online Present</span><strong>{formatCurrency(row.onlinePresent)}</strong></div>
                <div><span className="cash-mobile-card__label">Cash Present</span><strong>{formatCurrency(row.cashPresent)}</strong></div>
              </div>
              <div className="cash-mobile-card__status">
                <span>Calc: {row.calculationDiscrepancyCash === 0 && row.calculationDiscrepancyOnline === 0 ? "OK" : "Mismatch"}</span>
                <span>
                  Handover: {row.report
                    ? row.report.verificationDiscrepancyCash === 0 && row.report.verificationDiscrepancyOnline === 0
                      ? "Matched"
                      : row.report.resolutionReason
                      ? "Resolved"
                      : "Mismatch"
                    : "Pending"}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary cash-action-btn"
                onClick={() => openVerifyModal(row)}
                disabled={!row.submitted}
              >
                {row.report ? "Review again" : "Review & Verify"}
              </button>
            </article>
          ))}
          {!selectedRows.length && <p className="muted-text">No branches selected.</p>}
        </div>

        <div className="cash-summary-grid" style={{ marginTop: "1rem" }}>
          <div className="cash-summary-card">
            <span className="cash-summary-card__label">Online Sales</span>
            <strong>{formatCurrency(totals.onlineSales)}</strong>
          </div>
          <div className="cash-summary-card">
            <span className="cash-summary-card__label">Cash Sales</span>
            <strong>{formatCurrency(totals.cashSales)}</strong>
          </div>
          <div className="cash-summary-card">
            <span className="cash-summary-card__label">Online Present</span>
            <strong>{formatCurrency(totals.onlinePresent)}</strong>
          </div>
          <div className="cash-summary-card">
            <span className="cash-summary-card__label">Cash Present</span>
            <strong>{formatCurrency(totals.cashPresent)}</strong>
          </div>
        </div>
      </section>

      <Modal
        open={!!activeRow}
        title={activeRow ? `Review ${activeRow.branchName}` : "Review branch"}
        onClose={closeVerifyModal}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeVerifyModal} disabled={isSaving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowResolveModal(true)}
              disabled={!hasActiveDiscrepancy || isSaving}
            >
              Resolve Discrepancy
            </button>
            <button type="button" className="btn btn-primary" onClick={saveVerification} disabled={verifyDisabled}>
              {isSaving ? "Verifying..." : "Verify"}
            </button>
          </>
        }
      >
        {activeRow && (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <div className="cash-verify-row">
              <span>Online Sales</span>
              <strong>{formatCurrency(activeRow.onlineSales)}</strong>
            </div>
            <div className="cash-verify-row">
              <span>Cash Sales</span>
              <strong>{formatCurrency(activeRow.cashSales)}</strong>
            </div>
            <div className="cash-verify-row">
              <span>Online Expense</span>
              <strong>{formatCurrency(activeRow.onlineExpense)}</strong>
            </div>
            <div className="cash-verify-row">
              <span>Cash Expense</span>
              <strong>{formatCurrency(activeRow.cashExpense)}</strong>
            </div>
            <div className="cash-verify-row">
              <span>Online Present</span>
              <strong>{formatCurrency(activeRow.onlinePresent)}</strong>
            </div>
            <div className="cash-verify-row">
              <span>Cash Present</span>
              <strong>{formatCurrency(activeRow.cashPresent)}</strong>
            </div>
            <label className="cash-field">
              <span className="muted-text field-label">Present Cash Verified</span>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                value={verifiedCashPresent}
                onChange={(e) => setVerifiedCashPresent(sanitizeNumericInput(e.target.value))}
                placeholder="0"
              />
            </label>
            <label className="cash-field">
              <span className="muted-text field-label">Present Online Verified</span>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                value={verifiedOnlinePresent}
                onChange={(e) => setVerifiedOnlinePresent(sanitizeNumericInput(e.target.value))}
                placeholder="0"
              />
            </label>
            <label className="cash-field">
              <span className="muted-text field-label">Remarks (Optional)</span>
              <textarea className="input" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </label>
            <div className={getDiscrepancyTone(calculationDiscrepancyCash)}>
              <span>Cash Calculation Discrepancy</span>
              <strong>{formatCurrency(calculationDiscrepancyCash)}</strong>
            </div>
            {calculationDiscrepancyCash > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => openExpenseTicketForDiscrepancy("Cash", calculationDiscrepancyCash)}
              >
                Create Cash Expense Ticket
              </button>
            )}
            <div className={getDiscrepancyTone(calculationDiscrepancyOnline)}>
              <span>Online Calculation Discrepancy</span>
              <strong>{formatCurrency(calculationDiscrepancyOnline)}</strong>
            </div>
            {calculationDiscrepancyOnline > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => openExpenseTicketForDiscrepancy("UPI", calculationDiscrepancyOnline)}
              >
                Create Online Expense Ticket
              </button>
            )}
            <div className={getDiscrepancyTone(verificationDiscrepancyCash, !!resolutionReason.trim())}>
              <span>Cash Verification Discrepancy</span>
              <strong>{formatCurrency(verificationDiscrepancyCash)}</strong>
            </div>
            <div className={getDiscrepancyTone(verificationDiscrepancyOnline, !!resolutionReason.trim())}>
              <span>Online Verification Discrepancy</span>
              <strong>{formatCurrency(verificationDiscrepancyOnline)}</strong>
            </div>
            <div className={discrepancyResolved ? "cash-verify-row" : "cash-verify-row cash-verify-row--alert"}>
              <span>Resolution Status</span>
              <strong>
                {!hasActiveDiscrepancy ? "Resolved automatically" : resolutionReason.trim() ? "Resolved with reason" : "Pending resolution"}
              </strong>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={showResolveModal}
        title="Resolve discrepancy"
        onClose={() => {
          if (!isSaving) setShowResolveModal(false);
        }}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setShowResolveModal(false)} disabled={isSaving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowResolveModal(false)}
              disabled={!resolutionReason.trim() || isSaving}
            >
              Save reason
            </button>
          </>
        }
      >
        <label className="cash-field">
          <span className="muted-text field-label">Reason for resolving discrepancy</span>
          <textarea
            className="input"
            rows={4}
            value={resolutionReason}
            onChange={(e) => setResolutionReason(e.target.value)}
            placeholder="Explain why this discrepancy is being accepted."
          />
        </label>
      </Modal>
    </div>
  );
}

export default AdminCashManagement;
