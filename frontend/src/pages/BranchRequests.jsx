import React, { useEffect, useState } from "react";
import axios from "axios";

function BranchRequests() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [request, setRequest] = useState(null);
  const [requestItems, setRequestItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasDraftItems = Object.values(quantities).some(qty => qty > 0);
  const historyPageSize = 5;

  useEffect(() => {
    loadMaster();
    loadCurrentRequest();
    loadHistory();
  }, []);

  const composePayload = () =>
    Object.entries(quantities)
      .filter(([_, qty]) => qty > 0)
      .map(([itemId, qty]) => ({ itemId, requestedQty: qty }));

  const loadMaster = async () => {
    const [catRes] = await Promise.all([axios.get("/api/categories")]);
    setCategories(catRes.data);
  };

  const loadCurrentRequest = async () => {
    const res = await axios.get("/api/requests/current");
    setRequest(res.data.request);
    setRequestItems(res.data.items);
    const q = {};
    res.data.items.forEach((it) => {
      q[it.itemId] = it.requestedQty;
    });
    setQuantities(q);
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

  const currentTotal = requestItems.reduce((sum, it) => sum + it.totalPrice, 0);
  const sortedHistory = [...history].sort((a, b) => (b.weekStartDate || "").localeCompare(a.weekStartDate || ""));
  const historyTotalPages = Math.max(1, Math.ceil(sortedHistory.length / historyPageSize));
  const historyStartIndex = (historyPage - 1) * historyPageSize;
  const pagedHistory = sortedHistory.slice(historyStartIndex, historyStartIndex + historyPageSize);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section className="section-card">
        <h3 className="section-title">Branch Weekly Request</h3>
        {request && (
          <p className="muted-text">
            Week starting <strong style={{ color: "#0f172a" }}>{request.weekStartDate}</strong> · Status{" "}
            <span className="stats-pill">{request.status}</span>
          </p>
        )}
      </section>

      <section className="section-card">
        <h4 className="section-title">1. Choose Category</h4>
        <p className="muted-text">Pick a category to load recommended SKUs.</p>
        <div className="chip-row" style={{ marginTop: "0.75rem" }}>
          {categories.map((cat) => (
            <button
              type="button"
              className={`chip ${activeCategory === cat.id ? "chip--active" : ""}`}
              key={cat.id}
              onClick={() => loadItemsForCategory(cat.id)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </section>

      {activeCategory && (
        <section className="section-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h4 className="section-title">2. Set Quantities</h4>
            {request && request.status === "DRAFT" && (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="btn btn-secondary" onClick={saveItems}>
                  Save Draft
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setShowSubmitModal(true)} disabled={!hasDraftItems}>
                  Submit
                </button>
              </div>
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
          <span className="stats-pill">
            Est. total <strong style={{ color: "#0f172a" }}>₹{currentTotal}</strong>
          </span>
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
                <th>Week</th>
                <th>Status</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {pagedHistory.map((h) => (
                <tr key={h.id}>
                  <td>{h.weekStartDate}</td>
                  <td>{h.status}</td>
                  <td>₹{h.total}</td>
                </tr>
              ))}
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
