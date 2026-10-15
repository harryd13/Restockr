import React, { useEffect, useRef, useState } from "react";
import axios from "axios";

function DailyRequests() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [request, setRequest] = useState(null);
  const [requestItems, setRequestItems] = useState([]);
  const [errorBanner, setErrorBanner] = useState("");
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autosaveTimer = useRef(null);

  const selectedItemsCount = Object.values(quantities).filter((qty) => qty > 0).length;
  const hasDraftItems = selectedItemsCount > 0;

  useEffect(() => {
    loadMaster();
    loadCurrentRequest();
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
    const res = await axios.get("/api/daily-requests/current");
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
      if (delta > 0 && current === 0 && selectedItemsCount >= 10) {
        setErrorBanner("Daily requests allow a maximum of 10 items. Submit to create another request for today.");
        return prev;
      }
      const next = Math.max(0, current + delta);
      return { ...prev, [itemId]: next };
    });
  };

  const saveItems = async () => {
    if (!request) return;
    const payloadItems = composePayload();
    try {
      const res = await axios.post(`/api/daily-requests/${request.id}/items`, { items: payloadItems });
      setRequestItems(res.data.items);
      setErrorBanner("");
    } catch (err) {
      const message = err?.response?.data?.message || "Could not save daily request.";
      setErrorBanner(message);
    }
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
      await axios.post(`/api/daily-requests/${request.id}/items`, { items: payloadItems });
      await axios.post(`/api/daily-requests/${request.id}/submit`);
      await loadCurrentRequest();
      setErrorBanner("");
    } finally {
      setIsSubmitting(false);
      setShowSubmitModal(false);
    }
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

  const currentTotal = requestItems.reduce((sum, it) => sum + (it.requestedQty || 0) * (it.unitPrice || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {errorBanner && (
        <div className="banner banner--warning">
          <strong>Notice:</strong> {errorBanner}
        </div>
      )}
      <section className="section-card">
        <h3 className="section-title">Daily Request</h3>
        {request && (
          <p className="muted-text">
            Date <strong style={{ color: "#0f172a" }}>{request.requestDate}</strong> Status{" "}
            <span className="stats-pill">{request.status}</span>
          </p>
        )}
      </section>

      <section className="section-card">
        <h4 className="section-title">1. Choose Category</h4>
        <p className="muted-text">Pick a category to load daily SKUs.</p>
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
            {request && request.status === "DRAFT" && <span className="muted-text">Autosaving...</span>}
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
          <h4 className="section-title">Current Day Summary</h4>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span className="stats-pill">Items {selectedItemsCount}/10</span>
            <span className="stats-pill">
              Est. total <strong style={{ color: "#0f172a" }}>Rs {currentTotal.toFixed(2)}</strong>
            </span>
            {request && request.status === "DRAFT" && (
              <button type="button" className="btn btn-primary" onClick={() => setShowSubmitModal(true)} disabled={!hasDraftItems}>
                Submit
              </button>
            )}
          </div>
        </div>
        <p className="muted-text" style={{ marginTop: "-0.25rem" }}>
          Max 10 items per daily request. Submit to start another request for today.
        </p>
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
                  <td>Rs {Number(it.unitPrice || 0).toFixed(2)}</td>
                  <td>Rs {Number((it.requestedQty || 0) * (it.unitPrice || 0)).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
              Submit daily request?
            </h4>
            <p className="muted-text" style={{ marginBottom: "1.5rem" }}>
              This will create a ticket for Admin to process.
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

export default DailyRequests;
