import React, { useState } from "react";
import axios from "axios";

function OtherRequests() {
  const [items, setItems] = useState([{ itemName: "", requestedQty: 1, reason: "" }]);
  const [errorBanner, setErrorBanner] = useState("");
  const [successBanner, setSuccessBanner] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateItem = (index, field, value) => {
    setItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item))
    );
  };

  const addRow = () => {
    setItems((prev) => [...prev, { itemName: "", requestedQty: 1, reason: "" }]);
  };

  const removeRow = (index) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const submit = async () => {
    setErrorBanner("");
    setSuccessBanner("");
    const cleaned = items
      .map((item) => ({
        itemName: String(item.itemName || "").trim(),
        requestedQty: Number(item.requestedQty || 0),
        reason: String(item.reason || "").trim()
      }))
      .filter((item) => item.itemName && item.requestedQty > 0);

    if (!cleaned.length) {
      setErrorBanner("Add at least one item with quantity.");
      return;
    }

    try {
      setIsSubmitting(true);
      await axios.post("/api/misc-requests/submit", { items: cleaned });
      setItems([{ itemName: "", requestedQty: 1, reason: "" }]);
      setSuccessBanner("Misc request submitted. A ticket was created.");
    } catch (err) {
      setErrorBanner("Could not submit misc request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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
        <div>
          <h3 className="section-title">Misc Request</h3>
          <p className="muted-text">Log one-off items that are not part of daily or weekly requests.</p>
        </div>
      </section>

      <section className="section-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Reason (optional)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={`other-${idx}`}>
                  <td>
                    <input
                      type="text"
                      value={item.itemName}
                      placeholder="Item name"
                      onChange={(e) => updateItem(idx, "itemName", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={item.requestedQty}
                      onChange={(e) => updateItem(idx, "requestedQty", Number(e.target.value))}
                      style={{ width: "5rem" }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={item.reason}
                      placeholder="Reason"
                      onChange={(e) => updateItem(idx, "reason", e.target.value)}
                    />
                  </td>
                  <td>
                    {items.length > 1 && (
                      <button type="button" className="btn btn-ghost" onClick={() => removeRow(idx)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary" onClick={addRow}>
            Add Item
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default OtherRequests;
