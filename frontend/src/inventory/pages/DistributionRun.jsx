import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../../shared/components/Modal";

function DistributionRun() {
  const [runs, setRuns] = useState([]);
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [reasons, setReasons] = useState({});
  const [reviewedQuantities, setReviewedQuantities] = useState({});
  const [errorBanner, setErrorBanner] = useState("");
  const [closingRunId, setClosingRunId] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const [paymentDirtyRuns, setPaymentDirtyRuns] = useState(() => new Set());
  const [savingPaymentRuns, setSavingPaymentRuns] = useState(() => new Set());
  const [runMessages, setRunMessages] = useState({});

  const defaultMismatchReason = (row) => {
    if (row.mismatchReason) return row.mismatchReason;
    if (row.reconciliationConflict) return "Branch received more than expected";
    const receiptDefaultQty = Number(row.requestedQty || 0);
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
      setPaymentDirtyRuns(new Set());
      setReasons((prev) => Object.fromEntries(nextRows.map((row) => [
        row.id,
        String(prev[row.id] || "").trim() ? prev[row.id] : defaultMismatchReason(row)
      ])));
      setReviewedQuantities(Object.fromEntries(nextRows.map((row) => [
        row.id,
        Number(row.deliveredQty ?? row.approvedQty ?? row.receiptDefaultQty ?? 0)
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

  const branchReportedQty = (row) => Number(row.branchReportedQty ?? row.deliveredQty ?? row.approvedQty ?? 0);
  const reviewedQty = (row) => Number(reviewedQuantities[row.id] ?? row.deliveredQty ?? row.approvedQty ?? 0);
  const isMismatch = (row) => !!row.reconciliationConflict
    || Number(row.requestedQty || 0) !== reviewedQty(row)
    || branchReportedQty(row) !== reviewedQty(row);
  const isSupplyImpossible = (row) => Math.max(branchReportedQty(row), reviewedQty(row))
    > Number(row.centralReservedQty || 0) + Number(row.actualPurchaseQty ?? row.orderedQty ?? 0);
  const runIsReady = (run) => run.status === "RECEIVED_PENDING_REVIEW";

  const changePayment = (runId, rowId, field, value) => {
    setRows((current) => current.map((row) => {
      if (row.id !== rowId) return row;
      const updated = { ...row, [field]: value };
      if (field === "paymentStatus" && value === "NOT_RECORDED") updated.paymentMethod = "";
      return updated;
    }));
    setPaymentDirtyRuns((current) => new Set(current).add(runId));
    setRunMessages((current) => ({ ...current, [runId]: null }));
  };

  const paymentStatusLabel = (status) => {
    if (status === "EXPENSE_RECORDED") return "Paid - expense recorded";
    if (status === "PENDING_TICKET_OPEN") return "Pending ticket open";
    if (status === "PENDING_TICKET_CLOSED") return "Paid - ticket closed";
    if (status === "PAID") return "Paid";
    if (status === "PENDING") return "Pending";
    if (status === "NOT_APPLICABLE") return "Not applicable";
    return "Not recorded";
  };

  const paymentRowsValid = (runId) => (rowsByRun.get(runId) || []).every((row) => {
    if (Number(row.actualPurchaseQty ?? row.orderedQty ?? 0) <= 0) return true;
    const price = Number(row.estimatedUnitPrice ?? row.unitPrice ?? 0);
    if (!Number.isFinite(price) || price < 0) return false;
    if (["PAID", "PENDING", "PENDING_TICKET_OPEN"].includes(row.paymentStatus) && price <= 0) return false;
    if (!["PAID", "PENDING", "PENDING_TICKET_OPEN", "EXPENSE_RECORDED", "PENDING_TICKET_CLOSED"].includes(row.paymentStatus)) return false;
    return !!String(row.paymentMethod || "").trim();
  });

  const editablePaymentStatus = (status) => status === "PENDING_TICKET_OPEN" ? "PENDING" : status || "NOT_RECORDED";

  const savePayments = async (run) => {
    const runRows = rowsByRun.get(run.id) || [];
    if (!paymentRowsValid(run.id)) {
      setRunMessages((current) => ({ ...current, [run.id]: { type: "error", text: "Enter a positive final price and payment method for every Paid or Pending purchase." } }));
      return;
    }
    try {
      setSavingPaymentRuns((current) => new Set(current).add(run.id));
      const res = await axios.put(`/api/distribution-run/${run.id}/payments`, {
        version: Number(run.version || 0),
        idempotencyKey: globalThis.crypto?.randomUUID
          ? `weekly-payment:${run.id}:${globalThis.crypto.randomUUID()}`
          : `weekly-payment:${run.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        items: runRows.map((row) => ({
          id: row.id,
          actualPurchaseQty: Number(row.actualPurchaseQty ?? row.orderedQty ?? 0),
          estimatedUnitPrice: Number(row.estimatedUnitPrice ?? row.unitPrice ?? 0),
          paymentStatus: editablePaymentStatus(row.paymentStatus || (Number(row.orderedQty || 0) > 0 ? "NOT_RECORDED" : "NOT_APPLICABLE")),
          paymentMethod: row.paymentMethod || ""
        }))
      });
      setRuns((current) => current.map((candidate) => candidate.id === run.id ? res.data.run : candidate));
      const updatedById = new Map((res.data.items || []).map((item) => [item.id, item]));
      setRows((current) => current.map((row) => updatedById.get(row.id) || row));
      setPaymentDirtyRuns((current) => {
        const next = new Set(current);
        next.delete(run.id);
        return next;
      });
      const expenseCount = (res.data.expenseLogs || []).length;
      const pendingTicketOpen = res.data.pendingTicket?.status === "PENDING";
      setRunMessages((current) => ({
        ...current,
        [run.id]: {
          type: "success",
          text: expenseCount
            ? `Payment controls updated and ${expenseCount} expense record${expenseCount === 1 ? "" : "s"} created.`
            : pendingTicketOpen
              ? "Payment controls updated and the branch pending ticket is ready in Tickets."
              : "Payment controls updated."
        }
      }));
    } catch (error) {
      setRunMessages((current) => ({
        ...current,
        [run.id]: { type: "error", text: error?.response?.data?.message || "Could not update payment controls." }
      }));
    } finally {
      setSavingPaymentRuns((current) => {
        const next = new Set(current);
        next.delete(run.id);
        return next;
      });
    }
  };

  const openCloseModal = (run) => {
    const runRows = rowsByRun.get(run.id) || [];
    if (paymentDirtyRuns.has(run.id) || savingPaymentRuns.has(run.id) || !paymentRowsValid(run.id)) {
      setErrorBanner("Save a final purchase quantity, price, payment status, and payment method for every purchased item before closing.");
      return;
    }
    if (runRows.some(isSupplyImpossible)) {
      setErrorBanner("A branch received more than the recorded central and purchased quantities. Correct the highlighted row's actual purchase quantity before closing.");
      return;
    }
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
        version: Number(runs.find((run) => run.id === closingRunId)?.version || 0),
        items: runRows.map((row) => ({
          id: row.id,
          deliveredQty: reviewedQty(row),
          mismatchReason: String(reasons[row.id] || "").trim()
        }))
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
            <p className="muted-text">Record what was actually purchased, its final price, payment status, and payment method. After branch verification, resolve delivery mismatches and close the distribution.</p>
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
            const paymentsEditable = ["DRAFT", "AWAITING_RECEIPT", "RECEIVED_PENDING_REVIEW"].includes(run.status);
            const paymentDirty = paymentDirtyRuns.has(run.id);
            const savingPayments = savingPaymentRuns.has(run.id);
            const runMessage = runMessages[run.id];
            const conflictRows = runRows.filter((row) => row.reconciliationConflict);
            const impossibleRows = ready ? runRows.filter(isSupplyImpossible) : [];
            return (
              <div key={run.id} style={{ padding: "0.75rem 0", borderTop: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div style={{ fontWeight: 600 }}>Request {run.requestId || run.id} {run.weekStartDate ? `(${run.weekStartDate})` : ""}</div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                    {paymentDirty && <span className="stats-pill" style={{ background: "#fef3c7", color: "#92400e" }}>Unsaved payment changes</span>}
                    <span className="stats-pill">{ready ? "Ready to close" : "Awaiting branch verification"}</span>
                  </div>
                </div>
                {runMessage && (
                  <div className={`banner ${runMessage.type === "success" ? "banner--success" : "banner--warning"}`} style={{ marginBottom: "0.75rem" }}>
                    {runMessage.text}
                  </div>
                )}
                {conflictRows.length > 0 && (
                  <div className="banner banner--warning" style={{ marginBottom: "0.75rem" }}>
                    <strong>Receipt conflict:</strong> Branch quantities exceed the expected distribution for {conflictRows.map((row) => row.itemName).join(", ")}.
                  </div>
                )}
                {impossibleRows.length > 0 && (
                  <div className="banner banner--warning" style={{ marginBottom: "0.75rem", background: "rgba(239, 68, 68, 0.12)", borderColor: "rgba(239, 68, 68, 0.45)" }}>
                    <strong>Impossible supply:</strong> Branch receipt exceeds central stock plus the recorded actual purchase for {impossibleRows.map((row) => row.itemName).join(", ")}. Correct the red row before closing.
                  </div>
                )}
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th><th>Requested</th><th>From central</th><th>Ordered</th><th>Actually purchased</th><th>Expected</th>
                        <th>Final price</th><th>Payment status</th><th>Payment method</th><th>Branch received</th><th>Final received</th><th>Mismatch Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runRows.map((row) => {
                        const mismatch = ready && isMismatch(row);
                        const impossible = ready && isSupplyImpossible(row);
                        return (
                          <tr key={row.id} className={mismatch || impossible ? "row-unavailable" : ""} style={impossible ? { background: "rgba(239, 68, 68, 0.14)" } : undefined}>
                            <td>{row.itemName}</td>
                            <td>{row.requestedQty}</td>
                            <td>{Number(row.centralReservedQty || 0)}</td>
                            <td>{Number(row.orderedQty || 0)}</td>
                            <td>
                              {paymentsEditable && row.paymentStatus !== "PENDING_TICKET_CLOSED" ? (
                                <input type="number" min={0} step="any" value={row.actualPurchaseQty ?? row.orderedQty ?? 0} onChange={(event) => changePayment(run.id, row.id, "actualPurchaseQty", event.target.value)} aria-label={`${row.itemName} actual purchase quantity`} style={{ width: "5.5rem" }} />
                              ) : Number(row.actualPurchaseQty ?? row.orderedQty ?? 0)}
                            </td>
                            <td>{Number(row.requestedQty || 0)}</td>
                            <td>
                              {paymentsEditable && Number(row.actualPurchaseQty ?? row.orderedQty ?? 0) > 0 && row.paymentStatus !== "PENDING_TICKET_CLOSED" ? (
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={row.estimatedUnitPrice ?? row.unitPrice ?? 0}
                                  onChange={(event) => changePayment(run.id, row.id, "estimatedUnitPrice", event.target.value)}
                                  aria-label={`${row.itemName} final unit price`}
                                  style={{ width: "6.5rem" }}
                                />
                              ) : `Rs ${Number(row.estimatedUnitPrice ?? row.unitPrice ?? 0).toFixed(2)}`}
                            </td>
                            <td>
                              {paymentsEditable && Number(row.actualPurchaseQty ?? row.orderedQty ?? 0) > 0 && !["EXPENSE_RECORDED", "PENDING_TICKET_CLOSED"].includes(row.paymentStatus) ? (
                                <select
                                  value={editablePaymentStatus(row.paymentStatus)}
                                  onChange={(event) => changePayment(run.id, row.id, "paymentStatus", event.target.value)}
                                  aria-label={`${row.itemName} payment status`}
                                >
                                  <option value="NOT_RECORDED">Not recorded</option>
                                  <option value="PAID">Paid</option>
                                  <option value="PENDING">Pending</option>
                                </select>
                              ) : paymentStatusLabel(Number(row.actualPurchaseQty ?? row.orderedQty ?? 0) > 0 ? row.paymentStatus : "NOT_APPLICABLE")}
                            </td>
                            <td>
                              {paymentsEditable && Number(row.actualPurchaseQty ?? row.orderedQty ?? 0) > 0 && !["EXPENSE_RECORDED", "PENDING_TICKET_CLOSED"].includes(row.paymentStatus) ? (
                                <select
                                  value={row.paymentMethod || ""}
                                  onChange={(event) => changePayment(run.id, row.id, "paymentMethod", event.target.value)}
                                  aria-label={`${row.itemName} payment method`}
                                >
                                  <option value="">Select...</option>
                                  <option value="Cash">Cash</option>
                                  <option value="UPI">UPI</option>
                                </select>
                              ) : row.paymentMethod || "—"}
                            </td>
                            <td>{ready ? branchReportedQty(row) : "Waiting for branch"}</td>
                            <td>
                              {ready ? (
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={reviewedQuantities[row.id] ?? ""}
                                  onChange={(event) => setReviewedQuantities((current) => ({
                                    ...current,
                                    [row.id]: Math.max(0, Number(event.target.value) || 0)
                                  }))}
                                  aria-label={`${row.itemName} final received quantity`}
                                  style={{ width: "5rem" }}
                                />
                              ) : "Waiting for branch"}
                            </td>
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
                {paymentsEditable && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => savePayments(run)}
                      disabled={!paymentDirty || savingPayments || !paymentRowsValid(run.id)}
                    >
                      {savingPayments ? "Updating..." : "Update payments"}
                    </button>
                  </div>
                )}
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
        <p className="muted-text" style={{ margin: 0 }}>This commits reserved central stock, releases unused reservations, records mismatch decisions, and permanently closes the distribution.</p>
      </Modal>
    </div>
  );
}

export default DistributionRun;
