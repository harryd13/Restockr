import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import Modal from "../components/Modal";

function AdminTools({ reportStartDate, onRefresh, allowWeeklyOverride, onWeeklyOverrideChange }) {
  const [date, setDate] = useState(reportStartDate || "");
  const [initialCashAccount, setInitialCashAccount] = useState("");
  const [initialOnlineAccount, setInitialOnlineAccount] = useState("");
  const [initialBalanceMode, setInitialBalanceMode] = useState("base_date");
  const [initialBalanceEffectiveDate, setInitialBalanceEffectiveDate] = useState("");
  const [initialBalanceSuccess, setInitialBalanceSuccess] = useState("");
  const [initialBalanceError, setInitialBalanceError] = useState("");
  const [isSavingInitialBalances, setIsSavingInitialBalances] = useState(false);
  const [dueRebaseMode, setDueRebaseMode] = useState("hard_zero");
  const [dueRebaseValue, setDueRebaseValue] = useState("");
  const [dueRebaseSuccess, setDueRebaseSuccess] = useState("");
  const [dueRebaseError, setDueRebaseError] = useState("");
  const [isRebasingDue, setIsRebasingDue] = useState(false);
  const [cashAccounts, setCashAccounts] = useState({ cashAccount: 0, onlineAccount: 0, dueAccount: 0 });
  const [dueClearAmount, setDueClearAmount] = useState("");
  const [dueClearMode, setDueClearMode] = useState("Cash");
  const [dueClearNote, setDueClearNote] = useState("");
  const [dueClearSuccess, setDueClearSuccess] = useState("");
  const [dueClearError, setDueClearError] = useState("");
  const [isClearingDue, setIsClearingDue] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showFlushModal, setShowFlushModal] = useState(false);
  const [flushReason, setFlushReason] = useState("");
  const [flushError, setFlushError] = useState("");
  const [flushSuccess, setFlushSuccess] = useState("");
  const [isFlushing, setIsFlushing] = useState(false);
  const [cashReportSuccess, setCashReportSuccess] = useState("");
  const [cashReportError, setCashReportError] = useState("");
  const [isSendingCashReport, setIsSendingCashReport] = useState(false);
  const bannerTimer = useRef(null);

  useEffect(() => {
    if (reportStartDate) {
      setDate(reportStartDate);
    }
  }, [reportStartDate]);

  useEffect(() => {
    loadInitialBalances();
    loadCashAccountSummary();
    loadDueBalance();
  }, []);

  useEffect(() => {
    return () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    };
  }, []);

  const handleRefresh = () => {
    if (!date) return;
    onRefresh(date);
    setShowSuccess(true);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setShowSuccess(false), 4000);
  };

  const openFlushModal = () => {
    setFlushReason("");
    setFlushError("");
    setFlushSuccess("");
    setShowFlushModal(true);
  };

  const closeFlushModal = () => {
    if (isFlushing) return;
    setShowFlushModal(false);
  };

  const submitFlush = async () => {
    if (!flushReason.trim()) {
      setFlushError("Reason is required.");
      return;
    }
    try {
      setIsFlushing(true);
      setFlushError("");
      const res = await axios.post("/api/central-inventory/flush", { reason: flushReason });
      setFlushSuccess(`Central inventory flushed (${res.data?.flushed || 0} items).`);
      setShowFlushModal(false);
      onRefresh?.(date || "");
    } catch (err) {
      setFlushError("Could not flush inventory.");
    } finally {
      setIsFlushing(false);
    }
  };

  const sendPreviousDayCashReport = async () => {
    try {
      setIsSendingCashReport(true);
      setCashReportError("");
      const res = await axios.post("/api/admin/cash-reports/send-previous-day");
      setCashReportSuccess(`Cash report sent for ${res.data?.date || "previous day"}.`);
    } catch (err) {
      setCashReportError(err?.response?.data?.message || "Could not send previous day cash report.");
    } finally {
      setIsSendingCashReport(false);
    }
  };

  const loadInitialBalances = async () => {
    try {
      setInitialBalanceError("");
      const res = await axios.get("/api/admin/settings/initial-cash-balances");
      setInitialBalanceMode(res.data?.mode === "rebase" ? "rebase" : "base_date");
      setInitialCashAccount(String(res.data?.cashAccount ?? 0));
      setInitialOnlineAccount(String(res.data?.onlineAccount ?? 0));
      setInitialBalanceEffectiveDate(String(res.data?.effectiveDate || ""));
    } catch (err) {
      setInitialBalanceError("Could not load initial balances.");
    }
  };

  const saveInitialBalances = async () => {
    try {
      setIsSavingInitialBalances(true);
      setInitialBalanceError("");
      const res = await axios.post("/api/admin/settings/initial-cash-balances", {
        mode: initialBalanceMode,
        cashAccount: Number(initialCashAccount || 0),
        onlineAccount: Number(initialOnlineAccount || 0),
        effectiveDate: initialBalanceMode === "base_date" ? initialBalanceEffectiveDate : ""
      });
      setInitialBalanceMode(res.data?.mode === "rebase" ? "rebase" : "base_date");
      setInitialCashAccount(String(res.data?.cashAccount ?? 0));
      setInitialOnlineAccount(String(res.data?.onlineAccount ?? 0));
      setInitialBalanceEffectiveDate(String(res.data?.effectiveDate || ""));
      setInitialBalanceSuccess(initialBalanceMode === "rebase" ? "Balances rebased successfully." : "Opening balances updated.");
    } catch (err) {
      setInitialBalanceError(err?.response?.data?.message || "Could not update initial balances.");
    } finally {
      setIsSavingInitialBalances(false);
    }
  };

  const loadCashAccountSummary = async () => {
    try {
      const res = await axios.get("/api/admin/cash-account-summary");
      setCashAccounts(res.data || { cashAccount: 0, onlineAccount: 0, dueAccount: 0 });
    } catch (err) {
      // Keep the tool functional even if this summary load fails.
    }
  };

  const loadDueBalance = async () => {
    try {
      const res = await axios.get("/api/admin/settings/due-balance");
      setDueRebaseValue(String(res.data?.dueAccount ?? 0));
    } catch (err) {
      // Ignore to avoid blocking the tools page.
    }
  };

  const clearDueAmount = async () => {
    try {
      setIsClearingDue(true);
      setDueClearError("");
      const res = await axios.post("/api/admin/due-clearances", {
        amount: Number(dueClearAmount || 0),
        paymentMethod: dueClearMode,
        note: dueClearNote
      });
      setCashAccounts(res.data?.accounts || { cashAccount: 0, onlineAccount: 0, dueAccount: 0 });
      setDueClearAmount("");
      setDueClearNote("");
      setDueClearSuccess("Due cleared successfully.");
    } catch (err) {
      setDueClearError(err?.response?.data?.message || "Could not clear due amount.");
    } finally {
      setIsClearingDue(false);
    }
  };

  const rebaseDueBalance = async () => {
    try {
      setIsRebasingDue(true);
      setDueRebaseError("");
      const res = await axios.post("/api/admin/settings/due-balance", {
        mode: dueRebaseMode,
        dueAccount: dueRebaseMode === "set_value" ? Number(dueRebaseValue || 0) : 0
      });
      setDueRebaseValue(String(res.data?.dueAccount ?? 0));
      setDueRebaseSuccess(dueRebaseMode === "set_value" ? "Due balance rebased to the new value." : "Due balance reset to zero.");
      loadCashAccountSummary();
    } catch (err) {
      setDueRebaseError(err?.response?.data?.message || "Could not rebase due balance.");
    } finally {
      setIsRebasingDue(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {showSuccess && (
        <div className="banner banner--success">
          <strong>Updated:</strong> Reports refreshed from {date}.
        </div>
      )}
      <section className="section-card" style={{ maxWidth: 560, width: "100%" }}>
        <h3 className="section-title">Admin Tools</h3>
        <p className="muted-text">Refresh reports and logs starting from a specific date.</p>

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap", marginTop: "1rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span className="muted-text field-label">Start date</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary" onClick={handleRefresh} disabled={!date}>
            Refresh reports
          </button>
        </div>
        {reportStartDate && (
          <p className="muted-text" style={{ marginTop: "0.6rem" }}>
            Last refresh was made for date - {reportStartDate}.
          </p>
        )}
        <p className="muted-text" style={{ marginTop: "0.75rem" }}>
          Reports and logs will include data on or after the selected date.
        </p>
      </section>

      <section className="section-card" style={{ maxWidth: 560, width: "100%" }}>
        <h4 className="section-title">Allow Weekly Request</h4>
        <p className="muted-text">Enable weekly requests outside the normal schedule.</p>
        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.75rem" }}>
          <input
            type="checkbox"
            checked={!!allowWeeklyOverride}
            onChange={(e) => onWeeklyOverrideChange?.(e.target.checked)}
          />
          <span className="muted-text">Weekly requests enabled</span>
        </label>
      </section>

      <section className="section-card" style={{ maxWidth: 560, width: "100%" }}>
        <h4 className="section-title">Central Inventory</h4>
        <p className="muted-text">Flush all items from central inventory (manual adjustment log will be created).</p>
        {flushSuccess && (
          <div className="banner banner--success" style={{ marginTop: "0.75rem" }}>
            <strong>Success:</strong> {flushSuccess}
          </div>
        )}
        <div style={{ marginTop: "0.75rem" }}>
          <button type="button" className="btn btn-primary" onClick={openFlushModal}>
            Flush Inventory
          </button>
        </div>
      </section>

      <section className="section-card" style={{ maxWidth: 560, width: "100%" }}>
        <h4 className="section-title">Cash Report</h4>
        <p className="muted-text">Send the previous day&apos;s cash report to Slack immediately.</p>
        {cashReportSuccess && (
          <div className="banner banner--success" style={{ marginTop: "0.75rem" }}>
            <strong>Success:</strong> {cashReportSuccess}
          </div>
        )}
        {cashReportError && (
          <div className="banner banner--warning" style={{ marginTop: "0.75rem" }}>
            <strong>Warning:</strong> {cashReportError}
          </div>
        )}
        <div style={{ marginTop: "0.75rem" }}>
          <button type="button" className="btn btn-primary" onClick={sendPreviousDayCashReport} disabled={isSendingCashReport}>
            {isSendingCashReport ? "Sending..." : "Send Previous Day Cash Report"}
          </button>
        </div>
      </section>

      <section className="section-card" style={{ maxWidth: 560, width: "100%" }}>
        <h4 className="section-title">Initial Cash Balances</h4>
        <p className="muted-text">Set shared cash and online balances either as an opening base date or as a full rebase.</p>
        {initialBalanceSuccess && (
          <div className="banner banner--success" style={{ marginTop: "0.75rem" }}>
            <strong>Success:</strong> {initialBalanceSuccess}
          </div>
        )}
        {initialBalanceError && (
          <div className="banner banner--warning" style={{ marginTop: "0.75rem" }}>
            <strong>Warning:</strong> {initialBalanceError}
          </div>
        )}
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
            <input
              type="radio"
              name="initial-balance-mode"
              checked={initialBalanceMode === "base_date"}
              onChange={() => setInitialBalanceMode("base_date")}
            />
            <span className="muted-text">
              <strong style={{ color: "#0f172a" }}>Opening balance as base date</strong>
              <br />
              Only transactions on or after the effective date are applied.
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
            <input
              type="radio"
              name="initial-balance-mode"
              checked={initialBalanceMode === "rebase"}
              onChange={() => setInitialBalanceMode("rebase")}
            />
            <span className="muted-text">
              <strong style={{ color: "#0f172a" }}>Hard reset / rebase</strong>
              <br />
              Previous financial history is ignored and the new values become the current base now.
            </span>
          </label>
        </div>
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
          {initialBalanceMode === "base_date" && (
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span className="muted-text field-label">Effective date</span>
              <input className="input" type="date" value={initialBalanceEffectiveDate} onChange={(e) => setInitialBalanceEffectiveDate(e.target.value)} />
            </label>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span className="muted-text field-label">Cash account</span>
            <input className="input" type="number" min={0} value={initialCashAccount} onChange={(e) => setInitialCashAccount(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span className="muted-text field-label">Online account</span>
            <input className="input" type="number" min={0} value={initialOnlineAccount} onChange={(e) => setInitialOnlineAccount(e.target.value)} />
          </label>
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          <button type="button" className="btn btn-primary" onClick={saveInitialBalances} disabled={isSavingInitialBalances}>
            {isSavingInitialBalances ? "Saving..." : "Save Initial Balances"}
          </button>
        </div>
      </section>

      <section className="section-card" style={{ maxWidth: 560, width: "100%" }}>
        <h4 className="section-title">Clear Dues</h4>
        <p className="muted-text">Move collected dues into cash or online and reduce the due balance.</p>
        {dueClearSuccess && (
          <div className="banner banner--success" style={{ marginTop: "0.75rem" }}>
            <strong>Success:</strong> {dueClearSuccess}
          </div>
        )}
        {dueClearError && (
          <div className="banner banner--warning" style={{ marginTop: "0.75rem" }}>
            <strong>Warning:</strong> {dueClearError}
          </div>
        )}
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
          <div className="cash-management__metrics">
            <div className="cash-metric">
              <span className="cash-metric__label">Current Due Balance</span>
              <strong>{`Rs ${Number(cashAccounts.dueAccount || 0).toFixed(2)}`}</strong>
            </div>
            <div className="cash-metric">
              <span className="cash-metric__label">Cash Account</span>
              <strong>{`Rs ${Number(cashAccounts.cashAccount || 0).toFixed(2)}`}</strong>
            </div>
            <div className="cash-metric">
              <span className="cash-metric__label">Online Account</span>
              <strong>{`Rs ${Number(cashAccounts.onlineAccount || 0).toFixed(2)}`}</strong>
            </div>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span className="muted-text field-label">Amount</span>
            <input className="input" type="number" min={0} step="0.01" value={dueClearAmount} onChange={(e) => setDueClearAmount(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span className="muted-text field-label">Mode</span>
            <select className="input" value={dueClearMode} onChange={(e) => setDueClearMode(e.target.value)}>
              <option value="Cash">Cash</option>
              <option value="UPI">Online</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span className="muted-text field-label">Note (Optional)</span>
            <input className="input" type="text" value={dueClearNote} onChange={(e) => setDueClearNote(e.target.value)} />
          </label>
        </div>
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={clearDueAmount} disabled={isClearingDue || !Number(dueClearAmount || 0)}>
            {isClearingDue ? "Clearing..." : "Clear Dues"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={loadCashAccountSummary} disabled={isClearingDue}>
            Refresh Balances
          </button>
        </div>
      </section>

      <section className="section-card" style={{ maxWidth: 560, width: "100%" }}>
        <h4 className="section-title">Rebase Dues</h4>
        <p className="muted-text">Reset due balance independently from cash and online balances.</p>
        {dueRebaseSuccess && (
          <div className="banner banner--success" style={{ marginTop: "0.75rem" }}>
            <strong>Success:</strong> {dueRebaseSuccess}
          </div>
        )}
        {dueRebaseError && (
          <div className="banner banner--warning" style={{ marginTop: "0.75rem" }}>
            <strong>Warning:</strong> {dueRebaseError}
          </div>
        )}
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
            <input type="radio" name="due-rebase-mode" checked={dueRebaseMode === "hard_zero"} onChange={() => setDueRebaseMode("hard_zero")} />
            <span className="muted-text">
              <strong style={{ color: "#0f172a" }}>Set due to 0</strong>
              <br />
              Hard reset the due balance to zero.
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
            <input type="radio" name="due-rebase-mode" checked={dueRebaseMode === "set_value"} onChange={() => setDueRebaseMode("set_value")} />
            <span className="muted-text">
              <strong style={{ color: "#0f172a" }}>Set initial due value</strong>
              <br />
              Rebase dues to a new starting value.
            </span>
          </label>
          {dueRebaseMode === "set_value" && (
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span className="muted-text field-label">Due balance</span>
              <input className="input" type="number" min={0} step="0.01" value={dueRebaseValue} onChange={(e) => setDueRebaseValue(e.target.value)} />
            </label>
          )}
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          <button type="button" className="btn btn-primary" onClick={rebaseDueBalance} disabled={isRebasingDue}>
            {isRebasingDue ? "Saving..." : "Save Due Rebase"}
          </button>
        </div>
      </section>

      <Modal
        open={showFlushModal}
        title="Flush Central Inventory?"
        onClose={closeFlushModal}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeFlushModal} disabled={isFlushing}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={submitFlush} disabled={isFlushing || !flushReason.trim()}>
              {isFlushing ? "Flushing..." : "Confirm Flush"}
            </button>
          </>
        }
      >
        <p className="muted-text" style={{ marginBottom: "0.75rem" }}>
          This will remove all items from central inventory. This action is logged as a manual adjustment.
        </p>
        {flushError && (
          <div className="banner banner--warning" style={{ marginBottom: "0.75rem" }}>
            <strong>Warning:</strong> {flushError}
          </div>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <span className="muted-text field-label">Reason</span>
          <input className="input" type="text" value={flushReason} onChange={(e) => setFlushReason(e.target.value)} />
        </label>
      </Modal>
    </div>
  );
}

export default AdminTools;
