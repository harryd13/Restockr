import React, { useEffect, useRef, useState } from "react";

function AdminTools({ reportStartDate, onRefresh, allowWeeklyOverride, onWeeklyOverrideChange }) {
  const [date, setDate] = useState(reportStartDate || "");
  const [showSuccess, setShowSuccess] = useState(false);
  const bannerTimer = useRef(null);

  useEffect(() => {
    if (reportStartDate) {
      setDate(reportStartDate);
    }
  }, [reportStartDate]);

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
    </div>
  );
}

export default AdminTools;
