import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../components/Modal";

function DistributionRun() {
  const [runs, setRuns] = useState([]);
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [reasons, setReasons] = useState({});
  const [errorBanner, setErrorBanner] = useState("");
  const [closingRunId, setClosingRunId] = useState("");
  const [isClosing, setIsClosing] = useState(false);

  const defaultMismatchReason = (row) => {
    if (row.mismatchReason) return row.mismatchReason;
    if (row.reconciliationConflict) return "Delivered Qty > Initial";
    const receiptDefaultQty = Number(row.receiptDefaultQty ?? row.approvedQty ?? 0);
    const receivedQty = Number(row.deliveredQty ?? row.approvedQty ?? 0);
    return Number(row.requestedQty || 0) > 0 && receiptDefaultQty === 0 && receivedQty === 0
      ? "Wasn't available for procurement"
      : "";
  };

  useEffect(() => {
    loadQueue();
    loadBranches();
  }, []);

  const loadBranches = async () => {
    const res = await axios.get("/api/branches");
    setBranches(res.data || []);
  };

  const loadQueue = async (silent = false) => {
    try {
      const res = await axios.get("/api/distribution-queue");
      const nextRows = res.data.items || [];
      setRuns(res.data.runs || []);
      setRows(nextRows);
      setReasons((prev) => Object.fromEntries(nextRows.map((row) => [
        row.id,
        String(prev[row.id] || "").trim() ? prev[row.id] : defaultMismatchReason(row)
      ])));
      if (!silent) setErrorBanner("");
    } catch (err) {
      if (!silent) setErrorBanner("Failed to load distribution queue.");
    }
  };

  const lookupBranchName = (id) => branches.find((branch) => branch.id === id)?.name || id;
  const rowsByRun = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      if (!map.has(row.runId)) map.set(row.runId, []);
      map.get(row.runId).push(row);
    });
    return map;
  }, [rows]);

  const groupedRuns = useMemo(() => {
    const map = new Map();
    runs.forEach((run) => {
      if (!map.has(run.branchId)) map.set(run.branchId, []);
      map.get(run.branchId).push(run);
    });
    return Array.from(map.entries());
  }, [runs]);

  const deliveredQty = (row) => Number(row.deliveredQty ?? row.approvedQty ?? row.requestedQty ?? 0);
  const isMismatch = (row) => !!row.reconciliationConflict || Number(row.requestedQty || 0) !== deliveredQty(row);
  const runIsReady = (run) => run.status === "RECEIVED_PENDING_REVIEW";

  const openCloseModal = (run) => {
    const runRows = rowsByRun.get(run.id) || [];
    const missingReason = runRows.some((row) => isMismatch(row) && !String(reasons[row.id] || "").trim());
    if (missingReason) {
      setErrorBanner("Enter a reason for every requested-versus-delivered mismatch.");
      return;
    }
    setErrorBanner("");
    setClosingRunId(run.id);
  };

  const closeDistribution = async () => {
    if (!closingRunId) return;
    try {
      setIsClosing(true);
      const runRows = rowsByRun.get(closingRunId) || [];
      await axios.post(`/api/distribution-run/${closingRunId}/close`, {
        items: runRows.map((row) => ({ id: row.id, mismatchReason: String(reasons[row.id] || "").trim() }))
      });
      setClosingRunId("");
      await loadQueue();
    } catch (err) {
      setErrorBanner(err?.response?.data?.message || "Could not close distribution.");
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {errorBanner && <div className="banner banner--warning"><strong>Warning:</strong> {errorBanner}</div>}

      <section className="section-card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="section-title">Distribution Run</h3>
            <p className="muted-text">Branch-confirmed deliveries are read-only. Add reasons for mismatches, then close each distribution.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => loadQueue()}>Refresh</button>
        </div>
        {runs.length === 0 && <p className="muted-text" style={{ marginTop: "0.75rem" }}>No pending distributions.</p>}
      </section>

      {groupedRuns.map(([branchId, branchRuns]) => (
        <section className="section-card" key={branchId}>
          <h4 className="section-title">{lookupBranchName(branchId)}</h4>
          {branchRuns.map((run) => {
            const runRows = rowsByRun.get(run.id) || [];
            const ready = runIsReady(run);
            const conflictRows = runRows.filter((row) => row.reconciliationConflict);
            return (
              <div key={run.id} style={{ padding: "0.75rem 0", borderTop: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div style={{ fontWeight: 600 }}>Request {run.requestId || run.id} {run.weekStartDate ? `(${run.weekStartDate})` : ""}</div>
                  <span className="stats-pill">{ready ? "Ready to close" : "Awaiting branch verification"}</span>
                </div>
                {conflictRows.length > 0 && (
                  <div className="banner banner--warning" style={{ marginBottom: "0.75rem" }}>
                    <strong>Inventory conflict:</strong> Combined branch receipts exceed initial inventory for {conflictRows.map((row) => row.itemName).join(", ")}.
                  </div>
                )}
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr><th>Item</th><th>Category</th><th>Requested</th><th>Delivered</th><th>Mismatch Reason</th></tr>
                    </thead>
                    <tbody>
                      {runRows.map((row) => {
                        const mismatch = ready && isMismatch(row);
                        return (
                          <tr key={row.id} className={mismatch ? "row-unavailable" : ""}>
                            <td>{row.itemName}</td>
                            <td>{row.categoryName}</td>
                            <td>{row.requestedQty}</td>
                            <td>{ready ? deliveredQty(row) : Number(row.receiptDefaultQty ?? row.approvedQty ?? 0)}</td>
                            <td>
                              {!ready ? "Waiting for branch" : mismatch ? (
                                <input
                                  type="text"
                                  required
                                  value={reasons[row.id] || ""}
                                  onChange={(event) => setReasons((prev) => ({ ...prev, [row.id]: event.target.value }))}
                                  placeholder="Reason required"
                                />
                              ) : "Matched"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {ready && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" }}>
                    <button type="button" className="btn btn-primary" onClick={() => openCloseModal(run)}>Close Distribution</button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      <Modal
        open={!!closingRunId}
        title="Close distribution?"
        onClose={() => setClosingRunId("")}
        actions={<>
          <button type="button" className="btn btn-ghost" onClick={() => setClosingRunId("")} disabled={isClosing}>Keep open</button>
          <button type="button" className="btn btn-primary" onClick={closeDistribution} disabled={isClosing}>{isClosing ? "Closing..." : "Close Distribution"}</button>
        </>}
      >
        <p className="muted-text" style={{ margin: 0 }}>This locks the branch delivery and records every mismatch reason.</p>
      </Modal>
    </div>
  );
}

export default DistributionRun;
