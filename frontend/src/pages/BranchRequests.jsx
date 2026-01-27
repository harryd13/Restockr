import React, { useEffect, useRef, useState } from "react";
import axios from "axios";

function isWeeklyWindow(date = new Date()) {
  const now = new Date(date);
  const day = now.getDay();
  if (day === 4) return true;
  if (day === 5 && now.getHours() < 12) return true;
  return false;
}

function BranchRequests({ allowWeeklyOverride = false }) {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [request, setRequest] = useState(null);
  const [requestItems, setRequestItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [expandedHistoryId, setExpandedHistoryId] = useState("");
  const [historyItems, setHistoryItems] = useState({});
  const [historyStatus, setHistoryStatus] = useState({});
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showWeeklyBanner, setShowWeeklyBanner] = useState(false);
  const autosaveTimer = useRef(null);
  const bannerTimer = useRef(null);
  const allowWeeklyAnyDay = String(import.meta.env.VITE_WEEKLY_ALLOW_ANY_DAY || "").toLowerCase() === "true";
  const weeklyEnabled = allowWeeklyAnyDay || allowWeeklyOverride || isWeeklyWindow();

  const hasDraftItems = Object.values(quantities).some(qty => qty > 0);
  const historyPageSize = 5;

  useEffect(() => {
    loadMaster();
    loadCurrentRequest();
    loadHistory();
  }, []);

  useEffect(() => {
    return () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    };
  }, []);

  const composePayload = () =>
    Object.entries(quantities)
      .filter(([_, qty]) => qty > 0)
      .map(([itemId, qty]) => ({ itemId, requestedQty: qty }));

  const loadMaster = async () => {
    const [catRes] = await Promise.all([axios.get("/api/categories")]);
    const cleaned = (catRes.data || []).filter(
      (cat) => String(cat.name || "").toLowerCase() !== "daily"
    );
    setCategories(cleaned);
  };

  const loadCurrentRequest = async () => {
    const res = await axios.get("/api/requests/current");
    setRequest(res.data.request || null);
    setRequestItems(res.data.items || []);
    const q = {};
    (res.data.items || []).forEach((it) => {
      q[it.itemId] = it.requestedQty;
    });
    setQuantities(q);
  };

  const createCurrentRequest = async () => {
    const res = await axios.post("/api/requests/current");
    setRequest(res.data.request || null);
    setRequestItems(res.data.items || []);
    setQuantities({});
  };

  const loadItemsForCategory = async (categoryId) => {
    setActiveCategory(categoryId);
    const res = await axios.get("/api/items", { params: { categoryId } });
    setItems(res.data);
  };

  const changeQty = (itemId, delta) => {
    setQuantities((prev) => {
      const current = prev[itemId] || 0;
      const next = Math.max(0, current + delta);
      return { ...prev, [itemId]: next };
    });
  };

  const saveItems = async () => {
    if (!request) return;
    const payloadItems = composePayload();
    const res = await axios.post(`/api/requests/${request.id}/items`, { items: payloadItems });
    setRequestItems(res.data.items);
  };

  const submitRequest = async () => {
    if (!request) return;
    try {
      setIsSubmitting(true);
      const payloadItems = composePayload();
      if (!payloadItems.length) {
        setIsSubmitting(false);
        setShowSubmitModal(false);
        return;
      }
      await axios.post(`/api/requests/${request.id}/items`, { items: payloadItems });
      await axios.post(`/api/requests/${request.id}/submit`);
      await loadCurrentRequest();
      await loadHistory();
    } finally {
      setIsSubmitting(false);
      setShowSubmitModal(false);
    }
  };

  const loadHistory = async () => {
    const res = await axios.get("/api/requests/history");
    setHistory(res.data);
    setHistoryPage(1);
  };

  const loadHistoryItems = async (requestId) => {
    if (!requestId) return;
    const res = await axios.get(`/api/requests/history/${requestId}/items`);
    setHistoryItems((prev) => ({ ...prev, [requestId]: res.data.items || [] }));
    setHistoryStatus((prev) => ({ ...prev, [requestId]: res.data.status || "" }));
  };

  useEffect(() => {
    if (!request || request.status !== "DRAFT") return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      saveItems();
    }, 500);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [quantities, request]);

  const currentTotal = requestItems.reduce((sum, it) => sum + it.totalPrice, 0);
  const sortedHistory = [...history].sort((a, b) => (b.weekStartDate || "").localeCompare(a.weekStartDate || ""));
  const historyTotalPages = Math.max(1, Math.ceil(sortedHistory.length / historyPageSize));
  const historyStartIndex = (historyPage - 1) * historyPageSize;
  const pagedHistory = sortedHistory.slice(historyStartIndex, historyStartIndex + historyPageSize);
  const weeklyStartDisabled = !weeklyEnabled;

  const handleWeeklyStartClick = () => {
    if (!weeklyStartDisabled) {
      createCurrentRequest();
      return;
    }
    setShowWeeklyBanner(true);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setShowWeeklyBanner(false), 5000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section className="section-card">
        <h3 className="section-title">Branch Weekly Request</h3>
        {showWeeklyBanner && weeklyStartDisabled && (
          <div className="notice-banner notice-banner--warning" role="status">
            Weekly requests are only allowed on THURSDAY.
            <button type="button" className="notice-banner__close" onClick={() => setShowWeeklyBanner(false)}>
              Dismiss
            </button>
          </div>
        )}
        {request ? (
          <p className="muted-text">
            Week starting <strong style={{ color: "#0f172a" }}>{request.weekStartDate}</strong> · Status{" "}
            <span className="stats-pill">{request.status}</span>
          </p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <p className="muted-text" style={{ margin: 0 }}>
              {weeklyEnabled
                ? "No weekly request started for this week."
                : "Weekly requests are available on Thursday or before 12pm Friday."}
            </p>
            <button
              type="button"
              className={`btn btn-primary ${weeklyStartDisabled ? "btn--disabled" : ""}`}
              onClick={handleWeeklyStartClick}
              aria-disabled={weeklyStartDisabled}
            >
              Start weekly request
            </button>
          </div>
        )}
      </section>

      <section className="section-card" style={{ opacity: request && weeklyEnabled ? 1 : 0.6 }}>
        <h4 className="section-title">1. Choose Category</h4>
        <p className="muted-text">Pick a category to load recommended SKUs.</p>
        <div className="chip-row" style={{ marginTop: "0.75rem" }}>
          {categories.map((cat) => (
            <button
              type="button"
              className={`chip ${activeCategory === cat.id ? "chip--active" : ""}`}
              key={cat.id}
              onClick={() => request && weeklyEnabled && loadItemsForCategory(cat.id)}
              disabled={!request || !weeklyEnabled}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </section>

      {activeCategory && request && (
        <section className="section-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h4 className="section-title">2. Set Quantities</h4>
            {request && request.status === "DRAFT" && (
              <span className="muted-text">Autosaving...</span>
            )}
          </div>

          <div className="grid-cards">
            {items.map((item) => (
              <div key={item.id} className="item-card">
                <div style={{ minHeight: "2.2rem", fontWeight: 600 }}>{item.name}</div>
                <div className="item-counter">
                  <button type="button" className="btn btn-secondary" style={{ padding: "0.35rem 0.8rem" }} onClick={() => changeQty(item.id, -1)}>
                    -
                  </button>
                  <strong style={{ fontSize: "1.1rem" }}>{quantities[item.id] || 0}</strong>
                  <button type="button" className="btn btn-primary" style={{ padding: "0.35rem 0.8rem" }} onClick={() => changeQty(item.id, 1)}>
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <h4 className="section-title">Current Week Summary</h4>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span className="stats-pill">
              Est. total <strong style={{ color: "#0f172a" }}>₹{currentTotal}</strong>
            </span>
            {request && request.status === "DRAFT" && (
              <button type="button" className="btn btn-primary" onClick={() => setShowSubmitModal(true)} disabled={!hasDraftItems}>
                Submit
              </button>
            )}
          </div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {requestItems.map((it) => (
                <tr key={it.id}>
                  <td>{it.itemName}</td>
                  <td>{it.categoryName}</td>
                  <td>{it.requestedQty}</td>
                  <td>₹{it.unitPrice}</td>
                  <td>₹{it.totalPrice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-card">
        <h4 className="section-title">History</h4>
        <p className="muted-text">Track approvals and spend across previous weeks.</p>
        <div className="table-wrapper" style={{ marginTop: "0.5rem" }}>
          <table>
            <thead>
              <tr>
                <th>Details</th>
                <th>Week</th>
                <th>Status</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {pagedHistory.map((h) => {
                const isOpen = expandedHistoryId === h.id;
                const itemsForHistory = historyItems[h.id] || [];
                const statusForHistory = historyStatus[h.id] || h.status;
                return (
                  <React.Fragment key={h.id}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={async () => {
                            if (isOpen) {
                              setExpandedHistoryId("");
                              return;
                            }
                            if (!historyItems[h.id]) {
                              await loadHistoryItems(h.id);
                            }
                            setExpandedHistoryId(h.id);
                          }}
                        >
                          {isOpen ? "Hide" : "View"}
                        </button>
                      </td>
                      <td>{h.weekStartDate}</td>
                      <td>{h.status}</td>
                      <td>₹{h.total}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={4}>
                          <div className="table-wrapper" style={{ marginTop: "0.5rem" }}>
                            <table>
                              <thead>
                                <tr>
                                  <th>Item</th>
                                  <th>Category</th>
                                  <th>Requested</th>
                                  <th>Approved</th>
                                </tr>
                              </thead>
                              <tbody>
                                {itemsForHistory.map((item) => {
                                  const isUndistributed =
                                    statusForHistory === "DISTRIBUTED" && Number(item.approvedQty || 0) < Number(item.requestedQty || 0);
                                  return (
                                    <tr key={`${h.id}-${item.itemId}`} className={isUndistributed ? "row-unavailable" : ""}>
                                      <td>{item.itemName}</td>
                                      <td>{item.categoryName}</td>
                                      <td>{item.requestedQty}</td>
                                      <td>{item.approvedQty}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
            disabled={historyPage === 1}
          >
            Prev
          </button>
          <span className="muted-text">
            Page {historyPage} of {historyTotalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
            disabled={historyPage === historyTotalPages}
          >
            Next
          </button>
        </div>
      </section>

      {showSubmitModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
            padding: "1rem"
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "1rem",
              width: "min(420px, 100%)",
              padding: "1.75rem",
              boxShadow: "0 25px 60px rgba(15, 23, 42, 0.35)"
            }}
          >
            <h4 className="section-title" style={{ marginBottom: "0.5rem" }}>
              Submit weekly request?
            </h4>
            <p className="muted-text" style={{ marginBottom: "1.5rem" }}>
              Once submitted, Ops will begin procurement and this draft can no longer be edited.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowSubmitModal(false)} disabled={isSubmitting}>
                Not yet
              </button>
              <button type="button" className="btn btn-primary" onClick={submitRequest} disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Confirm Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BranchRequests;
