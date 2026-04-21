import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../components/Modal";

const INITIAL_FORM = {
  onlineSales: "",
  cashSales: "",
  cashPresent: "",
  onlinePresent: "",
  dueAmount: ""
};

const MONEY_FIELDS = [
  { key: "onlineSales", label: "Online Sales", hint: "Total online collections for today." },
  { key: "cashSales", label: "Cash Sales", hint: "Total cash collections for today." },
  { key: "cashPresent", label: "Cash Present", hint: "Cash physically available now." },
  { key: "onlinePresent", label: "Online Present", hint: "Online balance available now." },
  { key: "dueAmount", label: "Dues", hint: "Sales given on credit and not collected today." }
];

function sanitizeNumericInput(value) {
  const raw = String(value || "");
  const cleaned = raw.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function formatCurrency(value) {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}

function BranchCashManagement() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [errorBanner, setErrorBanner] = useState("");
  const [successBanner, setSuccessBanner] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [todayDate, setTodayDate] = useState("");
  const [savedTally, setSavedTally] = useState(null);

  const parsedValues = useMemo(
    () =>
      Object.fromEntries(
        MONEY_FIELDS.map(({ key }) => [key, Number.parseFloat(form[key]) || 0])
      ),
    [form]
  );

  const loadToday = async () => {
    try {
      setIsLoading(true);
      setFieldErrors({});
      const res = await axios.get("/api/cash-management/branch/today");
      const tally = res.data?.tally || null;
      setTodayDate(res.data?.date || "");
      setSavedTally(tally);
      if (tally) {
        setForm({
          onlineSales: String(tally.onlineSales ?? ""),
          cashSales: String(tally.cashSales ?? ""),
          cashPresent: String(tally.cashPresent ?? ""),
          onlinePresent: String(tally.onlinePresent ?? ""),
          dueAmount: String(tally.dueAmount ?? "")
        });
      } else {
        setForm(INITIAL_FORM);
      }
    } catch (err) {
      setErrorBanner("Could not load cash management details.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadToday();
  }, []);

  const validateForm = () => {
    const nextErrors = {};
    MONEY_FIELDS.forEach(({ key, label }) => {
      const raw = String(form[key] || "").trim();
      if (!raw.length) {
        nextErrors[key] = `${label} is required.`;
        return;
      }
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value) || value < 0) {
        nextErrors[key] = `${label} must be a valid number.`;
      }
    });
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: sanitizeNumericInput(value) }));
    setFieldErrors((prev) => ({ ...prev, [key]: "" }));
    setErrorBanner("");
    setSuccessBanner("");
  };

  const handleSubmitClick = () => {
    setErrorBanner("");
    setSuccessBanner("");
    if (!validateForm()) {
      setErrorBanner("Please enter numbers in all fields before continuing.");
      return;
    }
    setShowVerifyModal(true);
  };

  const submitTally = async () => {
    const hadExistingTally = !!savedTally;
    try {
      setIsSaving(true);
      setErrorBanner("");
      const payload = Object.fromEntries(
        MONEY_FIELDS.map(({ key }) => [key, Number.parseFloat(form[key]) || 0])
      );
      const res = await axios.post("/api/cash-management/branch", payload);
      setSavedTally(res.data?.tally || null);
      setSuccessBanner(hadExistingTally ? "Cash management tally updated." : "Cash management tally saved.");
      setShowVerifyModal(false);
    } catch (err) {
      setErrorBanner(err?.response?.data?.message || "Could not save cash management tally.");
    } finally {
      setIsSaving(false);
    }
  };

  const pageDescription = todayDate ? `Enter ${todayDate} sales and balance figures.` : "Enter daily sales and balance figures.";

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
            <h3 className="section-title">Cash Management</h3>
            <p className="muted-text">{pageDescription}</p>
          </div>
          {todayDate && <span className="stats-pill">{todayDate}</span>}
        </div>

        <div className="cash-management__metrics">
          <div className="cash-metric">
            <span className="cash-metric__label">Submission Status</span>
            <strong>{savedTally ? "Saved for today" : "Pending for today"}</strong>
            <span className="muted-text">
              {savedTally ? "You can update these values again if needed." : "Submit once all values are ready."}
            </span>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="cash-management__form-grid">
          {MONEY_FIELDS.map((field) => (
            <label key={field.key} className="cash-field">
              <span className="muted-text field-label">{field.label}</span>
              <input
                className={`input ${fieldErrors[field.key] ? "field-error" : ""}`}
                type="text"
                inputMode="decimal"
                value={form[field.key]}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder="0"
                aria-invalid={fieldErrors[field.key] ? "true" : "false"}
              />
              <span className="field-hint">{field.hint}</span>
              {fieldErrors[field.key] && <span className="field-hint field-hint--error">{fieldErrors[field.key]}</span>}
            </label>
          ))}
        </div>

        <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={handleSubmitClick} disabled={isLoading || isSaving}>
            {savedTally ? "Update Tally" : "Submit Tally"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={loadToday} disabled={isLoading || isSaving}>
            {isLoading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </section>

      <Modal
        open={showVerifyModal}
        title={"Verify today's cash tally"}
        onClose={() => {
          if (!isSaving) setShowVerifyModal(false);
        }}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setShowVerifyModal(false)} disabled={isSaving}>
              Edit
            </button>
            <button type="button" className="btn btn-primary" onClick={submitTally} disabled={isSaving}>
              {isSaving ? "Saving..." : "Yes, submit"}
            </button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "0.85rem" }}>
          <p className="muted-text" style={{ margin: 0 }}>
            Please confirm the entered values before saving. If anything looks wrong, click Edit.
          </p>
          <div className="cash-verify-grid">
            {MONEY_FIELDS.map((field) => (
              <div key={field.key} className="cash-verify-row">
                <span>{field.label}</span>
                <strong>{formatCurrency(parsedValues[field.key])}</strong>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default BranchCashManagement;
