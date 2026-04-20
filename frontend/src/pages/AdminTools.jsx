import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import Modal from "../components/Modal";

function AdminTools({ reportStartDate, onRefresh, allowWeeklyOverride, onWeeklyOverrideChange }) {
  const [date, setDate] = useState(reportStartDate || "");
  const [initialCashAccount, setInitialCashAccount] = useState("");
  const [initialOnlineAccount, setInitialOnlineAccount] = useState("");
  const [initialBalanceSuccess, setInitialBalanceSuccess] = useState("");
  const [initialBalanceError, setInitialBalanceError] = useState("");
  const [isSavingInitialBalances, setIsSavingInitialBalances] = useState(false);
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
      const res = await axios.get("/api/admin/settings/initial-cash-balances");
      setInitialCashAccount(String(res.data?.cashAccount ?? 0));
      setInitialOnlineAccount(String(res.data?.onlineAccount ?? 0));
    } catch (err) {
      setInitialBalanceError("Could not load initial balances.");
    }
  };

  const saveInitialBalances = async () => {
    try {
      setIsSavingInitialBalances(true);
      setInitialBalanceError("");
      const res = await axios.post("/api/admin/settings/initial-cash-balances", {
        cashAccount: Number(initialCashAccount || 0),
        onlineAccount: Number(initialOnlineAccount || 0)
      });
      setInitialCashAccount(String(res.data?.cashAccount ?? 0));
      setInitialOnlineAccount(String(res.data?.onlineAccount ?? 0));
      setInitialBalanceSuccess("Initial balances updated.");
    } catch (err) {
      setInitialBalanceError(err?.response?.data?.message || "Could not update initial balances.");
    } finally {
      setIsSavingInitialBalances(false);
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
        <p className="muted-text">Set the starting shared cash and online balances used by cash reports.</p>
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
