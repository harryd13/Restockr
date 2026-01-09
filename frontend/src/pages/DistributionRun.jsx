import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../components/Modal";

function DistributionRun() {
  const [runs, setRuns] = useState([]);
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [inventoryMap, setInventoryMap] = useState(new Map());
  const [errorBanner, setErrorBanner] = useState("");
  const [finalizeRunId, setFinalizeRunId] = useState("");
  const [isFinalizing, setIsFinalizing] = useState(false);

  useEffect(() => {
    loadQueue();
    loadBranches();
    loadInventory();
  }, []);

  const loadBranches = async () => {
    const res = await axios.get("/api/branches");
    setBranches(res.data || []);
  };

  const loadQueue = async (silent = false) => {
    try {
      const res = await axios.get("/api/distribution-queue");
      setRuns(res.data.runs || []);
      setRows(res.data.items || []);
      if (!silent) setErrorBanner("");
    } catch (err) {
      if (!silent) setErrorBanner("Failed to load distribution queue.");
    }
  };

  const loadInventory = async () => {
    try {
      const res = await axios.get("/api/central-inventory");
      const map = new Map();
      (res.data?.rows || []).forEach((row) => {
        map.set(row.itemId, Number(row.onHand || 0));
      });
      setInventoryMap(map);
    } catch (err) {
      setInventoryMap(new Map());
    }
  };

  const lookupBranchName = (id) => branches.find((b) => b.id === id)?.name || id;

  const runMap = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);

  const normalizeRows = (inputRows, inventory) => {
    const remaining = new Map();
    inputRows.forEach((row) => {
      if (!remaining.has(row.itemId)) {
        remaining.set(row.itemId, inventory.get(row.itemId) || 0);
      }
    });
    return inputRows.map((row) => {
      const available = remaining.get(row.itemId) || 0;
      const nextQty = Math.max(0, Math.min(Number(row.approvedQty || 0), available));
      remaining.set(row.itemId, available - nextQty);
      return { ...row, approvedQty: nextQty };
    });
  };

  const getMaxAllowed = (row, allRows) => {
    const onHand = inventoryMap.get(row.itemId) || 0;
    const usedByOthers = allRows.reduce((sum, r) => {
      if (r.itemId !== row.itemId) return sum;
      if (r.id === row.id) return sum;
      return sum + Number(r.approvedQty || 0);
    }, 0);
    return Math.max(0, onHand - usedByOthers);
  };

  const changeRow = (id, value) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const maxAllowed = getMaxAllowed(r, prev);
        const nextValue = Math.max(0, Math.min(maxAllowed, value));
        return { ...r, approvedQty: nextValue };
      })
    );
  };

  const grouped = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      if (!map.has(row.branchId)) map.set(row.branchId, new Map());
      const branchMap = map.get(row.branchId);
      if (!branchMap.has(row.runId)) branchMap.set(row.runId, []);
      branchMap.get(row.runId).push(row);
    });
    return Array.from(map.entries());
  }, [rows]);

  const saveUpdatesForRuns = async (runIds, sourceRows = rows) => {
    const runGroups = sourceRows.reduce((acc, row) => {
      if (!runIds.includes(row.runId)) return acc;
      if (!acc[row.runId]) acc[row.runId] = [];
      acc[row.runId].push({ id: row.id, approvedQty: Number(row.approvedQty || 0) });
      return acc;
    }, {});
    const updatedRows = [];
    for (const [runId, items] of Object.entries(runGroups)) {
      if (!items.length) continue;
      const res = await axios.post(`/api/distribution-run/${runId}/items`, { items });
      updatedRows.push(...(res.data || []));
    }
    if (updatedRows.length) {
      setRows((prev) => prev.map((row) => updatedRows.find((u) => u.id === row.id) || row));
    }
  };

  const saveBranchUpdates = async (branchId) => {
    const runIds = Array.from(new Set(rows.filter((r) => r.branchId === branchId).map((r) => r.runId)));
    if (!runIds.length) return;
    const normalized = normalizeRows(rows, inventoryMap);
    setRows(normalized);
    await saveUpdatesForRuns(runIds, normalized);
  };

  const finalizeAll = async () => {
    if (!finalizeRunId) return;
    try {
      setIsFinalizing(true);
      const normalized = normalizeRows(rows, inventoryMap);
      setRows(normalized);
      await saveUpdatesForRuns(runs.map((r) => r.id), normalized);
      await axios.post(`/api/distribution-run/finalize-multi`, { runIds: runs.map((r) => r.id) });
      setFinalizeRunId("");
      await loadQueue();
      await loadInventory();
    } finally {
      setIsFinalizing(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {errorBanner && (
        <div className="banner banner--warning">
          <strong>Warning:</strong> {errorBanner}
        </div>
      )}

      <section className="section-card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="section-title">Distribution Run</h3>
            <p className="muted-text">Allocate available items to each branch as requests come in.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => loadQueue()}>
            Refresh
          </button>
        </div>
        {runs.length === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No pending distributions.</p>}
      </section>

      {grouped.map(([branchId, runMapForBranch]) => (
        <section className="section-card" key={branchId}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <h4 className="section-title">{lookupBranchName(branchId)}</h4>
            <button type="button" className="btn btn-secondary" onClick={() => saveBranchUpdates(branchId)} disabled={!rows.length}>
              Save Updates
            </button>
          </div>
          {Array.from(runMapForBranch.entries()).map(([runId, items]) => {
            const run = runMap.get(runId);
            return (
              <div key={runId} style={{ padding: "0.75rem 0", borderTop: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div style={{ fontWeight: 600 }}>
                    Request {run?.requestId || runId} {run?.weekStartDate ? `(${run.weekStartDate})` : ""}
                  </div>
                  <span className="muted-text">Pending</span>
                </div>
                <div className="table-wrapper">
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
                      {items.map((row) => (
                        <tr key={row.id} className={row.status === "UNAVAILABLE" ? "row-unavailable" : ""}>
                          <td>{row.itemName}</td>
                          <td>{row.categoryName}</td>
                          <td>{row.requestedQty}</td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              max={getMaxAllowed(row, rows)}
                              value={Number(row.approvedQty || 0)}
                              onChange={(e) => changeRow(row.id, Number(e.target.value))}
                              style={{ width: "5rem" }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </section>
      ))}

      {runs.length > 0 && (
        <section className="section-card">
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={() => setFinalizeRunId("all")} disabled={!rows.length}>
              Finalize All
            </button>
          </div>
        </section>
      )}

      <Modal
        open={!!finalizeRunId}
        title="Finalize distribution?"
        onClose={() => setFinalizeRunId("")}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setFinalizeRunId("")} disabled={isFinalizing}>
              Keep editing
            </button>
            <button type="button" className="btn btn-primary" onClick={finalizeAll} disabled={isFinalizing}>
              {isFinalizing ? "Finalizing..." : "Finalize"}
            </button>
          </>
        }
      >
        <p className="muted-text" style={{ margin: 0 }}>
          Finalizing updates central inventory and logs unfulfilled items for all pending requests.
        </p>
      </Modal>
    </div>
  );
}

export default DistributionRun;
