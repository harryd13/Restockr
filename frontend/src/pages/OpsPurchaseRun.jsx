import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import Modal from "../components/Modal";

function OpsPurchaseRun() {
  const [week, setWeek] = useState("");
  const [rows, setRows] = useState([]);
  const [requestIds, setRequestIds] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selectedBranches, setSelectedBranches] = useState([]);
  const [combinedView, setCombinedView] = useState(false);
  const [sortConfig, setSortConfig] = useState({ column: "branchId", direction: "asc" });
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [successBanner, setSuccessBanner] = useState("");

  useEffect(() => {
    load();
    loadBranches();
  }, []);

  const loadBranches = async () => {
    const res = await axios.get("/api/branches");
    setBranches(res.data);
    setSelectedBranches(res.data.map((b) => b.id));
  };

  const load = async (w) => {
    const res = await axios.get("/api/purchase-run", { params: { week: w } });
    setWeek(res.data.weekStartDate);
    setRows(res.data.rows);
    setRequestIds(res.data.requestIds || []);
  };

  const changeRow = (id, field, value) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        if (field === "status" && value === "UNAVAILABLE") {
          updated.approvedQty = 0;
          updated.totalPrice = 0;
          return updated;
        }
        const qty = field === "approvedQty" ? value : updated.approvedQty;
        const price = field === "unitPrice" ? value : updated.unitPrice;
        updated.totalPrice = qty * price;
        return updated;
      })
    );
  };

  const saveUpdates = async () => {
    if (!requestIds.length) return;
    const grouped = rows.reduce((acc, row) => {
      if (!acc[row.requestId]) acc[row.requestId] = [];
      acc[row.requestId].push({
        id: row.id,
        approvedQty: row.approvedQty,
        unitPrice: row.unitPrice,
        status: row.status
      });
      return acc;
    }, {});

    let nextRows = [...rows];
    for (const [reqId, items] of Object.entries(grouped)) {
      const res = await axios.post(`/api/purchase-run/${reqId}/update-items`, { items });
      nextRows = nextRows.map((row) => {
        if (row.requestId !== reqId) return row;
        const updated = res.data.find((r) => r.id === row.id) || row;
        return { ...row, ...updated };
      });
    }
    setRows(nextRows);
  };

  const finalize = async () => {
    const allBranchesSelected = branches.length > 0 && selectedBranches.length === branches.length;
    if (!requestIds.length || !rows.length || !allBranchesSelected) return;
    try {
      setIsFinalizing(true);
      await saveUpdates();
      await axios.post(`/api/purchase-run/finalize-multi`, { requestIds });
      setRows([]);
      setRequestIds([]);
      setShowFinalizeModal(false);
      setSuccessBanner("Purchase run finalized and logged.");
      setTimeout(() => setSuccessBanner(""), 3000);
    } finally {
      setIsFinalizing(false);
    }
  };

  const openFinalizeModal = () => {
    if (!canFinalize) return;
    setShowFinalizeModal(true);
  };

  const closeFinalizeModal = () => {
    if (isFinalizing) return;
    setShowFinalizeModal(false);
  };

  const toggleBranch = (id) => {
    setSelectedBranches((prev) => {
      if (prev.includes(id)) {
        return prev.filter((b) => b !== id);
      }
      return [...prev, id];
    });
  };

  const selectAllBranches = () => {
    if (selectedBranches.length === branches.length) {
      setSelectedBranches([]);
    } else {
      setSelectedBranches(branches.map((b) => b.id));
    }
  };

  const filteredRows = useMemo(() => {
    if (!selectedBranches.length) return rows;
    return rows.filter((r) => selectedBranches.includes(r.branchId));
  }, [rows, selectedBranches]);

  const combinedRows = useMemo(() => {
    if (!combinedView) return filteredRows;
    const map = new Map();
    filteredRows.forEach((row) => {
      const key = row.itemId || `${row.itemName}-${row.unitPrice}`;
      if (!map.has(key)) {
        map.set(key, {
          ...row,
          id: key,
          branchId: "COMBINED",
          requestedQty: 0,
          approvedQty: 0,
          totalPrice: 0
        });
      }
      const agg = map.get(key);
      agg.requestedQty += row.requestedQty || 0;
      agg.approvedQty += row.approvedQty || 0;
      agg.totalPrice += row.totalPrice || 0;
    });
    return Array.from(map.values()).map((row) => ({
      ...row,
      unitPrice: row.approvedQty ? Number((row.totalPrice / row.approvedQty).toFixed(2)) : row.unitPrice
    }));
  }, [filteredRows, combinedView]);

  const displayRows = combinedView ? combinedRows : filteredRows;

  const sortedRows = useMemo(() => {
    if (!sortConfig?.column) return displayRows;
    const sorted = [...displayRows].sort((a, b) => {
      const dir = sortConfig.direction === "asc" ? 1 : -1;
      const getValue = (row) => {
        switch (sortConfig.column) {
          case "categoryName":
            return row.categoryName || "";
          case "branchId":
            return row.branchId || "";
          case "itemName":
            return row.itemName || "";
          case "requestedQty":
            return row.requestedQty || 0;
          default:
            return "";
        }
      };
      const valA = getValue(a);
      const valB = getValue(b);
      if (typeof valA === "number" && typeof valB === "number") {
        return (valA - valB) * dir;
      }
      return String(valA).localeCompare(String(valB)) * dir;
    });
    return sorted;
  }, [displayRows, sortConfig]);

  const total = sortedRows.reduce((sum, r) => sum + (r.totalPrice || 0), 0);
  const allBranchesSelected = branches.length > 0 && selectedBranches.length === branches.length;
  const canFinalize = rows.length > 0 && allBranchesSelected && !isFinalizing;

  const toggleSort = (column) => {
    setSortConfig((prev) => {
      if (prev?.column === column) {
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { column, direction: "asc" };
    });
  };

  const exportPdf = () => {
    if (!sortedRows.length) return;
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(`Purchase Run • Week ${week}`, 14, 16);
    autoTable(doc, {
      startY: 22,
      head: [
        [
          ...(!combinedView ? ["Branch"] : []),
          "Item",
          "Category",
          "Requested",
          "Approved",
          "Unit Price",
          "Status",
          "Total"
        ]
      ],
      body: sortedRows.map((r) => [
        ...(!combinedView ? [r.branchId] : []),
        r.itemName,
        r.categoryName,
        r.requestedQty,
        r.approvedQty,
        r.unitPrice,
        combinedView ? "-" : r.status,
        r.totalPrice
      ])
    });
    doc.save(`purchase-run-${week || "current"}.pdf`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {successBanner && (
        <div className="banner banner--success">
          <strong>Success:</strong> {successBanner}
        </div>
      )}
      <section className="section-card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="section-title">Purchase Run</h3>
            <p className="muted-text">Review weekly requirements and confirm final purchase plan.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: 220 }}>
            <label style={{ fontSize: "0.85rem", color: "#475569", fontWeight: 600 }}>Week starting</label>
            <input
              type="date"
              value={week}
              onChange={(e) => {
                const v = e.target.value;
                setWeek(v);
                load(v);
              }}
            />
          </div>
        </div>

        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <span className="stats-pill">
            Total spend <strong style={{ color: "#0f172a" }}>₹{total.toFixed(2)}</strong>
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "0.9rem" }}>Branches</strong>
              <button type="button" className="btn btn-ghost" style={{ padding: "0.25rem 0.75rem" }} onClick={selectAllBranches}>
                {selectedBranches.length === branches.length ? "Clear all" : "Select all"}
              </button>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginLeft: "auto" }}>
                <input type="checkbox" checked={combinedView} onChange={(e) => setCombinedView(e.target.checked)} />
                <span>Combine identical items</span>
              </label>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {branches.map((b) => (
                <label key={b.id} style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <input type="checkbox" checked={selectedBranches.includes(b.id)} onChange={() => toggleBranch(b.id)} />
                  <span>{b.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" onClick={exportPdf} disabled={!sortedRows.length}>
              Download PDF
            </button>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                {!combinedView && (
                  <th onClick={() => toggleSort("branchId")} style={{ cursor: "pointer" }}>
                    Branch {sortConfig.column === "branchId" ? (sortConfig.direction === "asc" ? "↑" : "↓") : ""}
                  </th>
                )}
                <th onClick={() => toggleSort("itemName")} style={{ cursor: "pointer" }}>
                  Item {sortConfig.column === "itemName" ? (sortConfig.direction === "asc" ? "↑" : "↓") : ""}
                </th>
                <th onClick={() => toggleSort("categoryName")} style={{ cursor: "pointer" }}>
                  Category {sortConfig.column === "categoryName" ? (sortConfig.direction === "asc" ? "↑" : "↓") : ""}
                </th>
                <th onClick={() => toggleSort("requestedQty")} style={{ cursor: "pointer" }}>
                  Requested {sortConfig.column === "requestedQty" ? (sortConfig.direction === "asc" ? "↑" : "↓") : ""}
                </th>
                <th>Approved</th>
                <th>Unit Price</th>
                <th>Status</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.id}>
                  {!combinedView && <td>{r.branchId}</td>}
                  <td>{r.itemName}</td>
                  <td>{r.categoryName}</td>
                  <td>{r.requestedQty}</td>
                  <td>
                    {!combinedView ? (
                      <input
                        type="number"
                        value={r.approvedQty}
                        min={0}
                        onChange={(e) => changeRow(r.id, "approvedQty", Number(e.target.value))}
                        disabled={r.status === "UNAVAILABLE"}
                        style={{
                          width: "5rem",
                          backgroundColor: r.status === "UNAVAILABLE" ? "#f1f5f9" : "#fff",
                          color: r.status === "UNAVAILABLE" ? "#94a3b8" : "#0f172a"
                        }}
                      />
                    ) : (
                      r.approvedQty
                    )}
                  </td>
                  <td>
                    {!combinedView ? (
                      <input
                        type="number"
                        value={r.unitPrice}
                        min={0}
                        onChange={(e) => changeRow(r.id, "unitPrice", Number(e.target.value))}
                        style={{ width: "6rem" }}
                      />
                    ) : (
                      r.unitPrice
                    )}
                  </td>
                  <td>
                    {!combinedView ? (
                      <select value={r.status} onChange={(e) => changeRow(r.id, "status", e.target.value)}>
                        <option value="AVAILABLE">Available</option>
                        <option value="UNAVAILABLE">Unavailable</option>
                      </select>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>₹{Number(r.totalPrice || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <button
            className="btn btn-primary"
            onClick={openFinalizeModal}
            disabled={!canFinalize}
            style={{ opacity: canFinalize ? 1 : 0.5, cursor: canFinalize ? "pointer" : "not-allowed" }}
          >
            Finalize
          </button>
        </div>
      </section>

      <Modal
        open={showFinalizeModal}
        title="Finalize purchase run?"
        onClose={closeFinalizeModal}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeFinalizeModal} disabled={isFinalizing}>
              Keep editing
            </button>
            <button type="button" className="btn btn-primary" onClick={finalize} disabled={isFinalizing}>
              {isFinalizing ? "Finalizing..." : "Finalize now"}
            </button>
          </>
        }
      >
        <p className="muted-text" style={{ margin: 0 }}>
          Finalizing locks approvals and records spend for the selected week.
        </p>
      </Modal>
    </div>
  );
}

export default OpsPurchaseRun;

