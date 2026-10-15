import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import Modal from "../../shared/components/Modal";

function normalizeNumber(value) {
  if (value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function purchaseTotal(items) {
  return items.reduce(
    (sum, item) => sum + Number(item.orderQty || 0) * Number(item.estimatedUnitPrice || 0),
    0
  );
}

function CombinedPurchaseRun() {
  const [sections, setSections] = useState([]);
  const [weekStartDate, setWeekStartDate] = useState("");
  const [dirtyRuns, setDirtyRuns] = useState(() => new Set());
  const [savingRuns, setSavingRuns] = useState(() => new Set());
  const [pdfRuns, setPdfRuns] = useState(() => new Set());
  const [orderingRunId, setOrderingRunId] = useState("");
  const [orderCandidate, setOrderCandidate] = useState(null);
  const [successBanner, setSuccessBanner] = useState("");
  const [runMessages, setRunMessages] = useState({});
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState("");
  const sectionsRef = useRef([]);
  const autosaveTimersRef = useRef(new Map());
  const savePromisesRef = useRef(new Map());
  const editRevisionsRef = useRef(new Map());

  const loadPurchases = async ({ preserveMessage = false } = {}) => {
    try {
      setLoading(true);
      const res = await axios.get("/api/weekly-purchases");
      const nextSections = res.data?.sections || [];
      sectionsRef.current = nextSections;
      setSections(nextSections);
      setWeekStartDate(res.data?.weekStartDate || "");
      setDirtyRuns(new Set());
      if (!preserveMessage) setRunMessages({});
      setErrorBanner("");
    } catch (error) {
      setErrorBanner(error?.response?.data?.message || "Failed to load branch purchase requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPurchases();
    return () => {
      autosaveTimersRef.current.forEach((timer) => clearTimeout(timer));
      autosaveTimersRef.current.clear();
    };
  }, []);

  const totals = useMemo(() => {
    const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);
    const estimatedSpend = sections.reduce((sum, section) => sum + purchaseTotal(section.items), 0);
    return { itemCount, estimatedSpend };
  }, [sections]);

  const scheduleAutosave = (runId, delay = 650) => {
    const existing = autosaveTimersRef.current.get(runId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      autosaveTimersRef.current.delete(runId);
      saveLatestSection(runId);
    }, delay);
    autosaveTimersRef.current.set(runId, timer);
  };

  const changeItem = (runId, itemId, field, value) => {
    const next = sectionsRef.current.map((section) => {
      if (section.run.id !== runId) return section;
      return {
        ...section,
        items: section.items.map((item) => {
          if (item.itemId !== itemId) return item;
          const updated = { ...item, [field]: value };
          if (field === "centralReservedQty") {
            updated.purchaseRequiredQty = Math.max(0, Number(item.requestedQty || 0) - Number(value || 0));
          }
          return updated;
        })
      };
    });
    sectionsRef.current = next;
    setSections(next);
    editRevisionsRef.current.set(runId, Number(editRevisionsRef.current.get(runId) || 0) + 1);
    setDirtyRuns((current) => new Set(current).add(runId));
    setRunMessages((current) => ({ ...current, [runId]: null }));
    scheduleAutosave(runId);
  };

  async function saveLatestSection(runId) {
    const pendingTimer = autosaveTimersRef.current.get(runId);
    if (pendingTimer) clearTimeout(pendingTimer);
    autosaveTimersRef.current.delete(runId);
    const activeSave = savePromisesRef.current.get(runId);
    if (activeSave) return activeSave;

    const savePromise = (async () => {
      try {
        setSavingRuns((current) => new Set(current).add(runId));
        setRunMessages((current) => ({ ...current, [runId]: null }));

        // One worker owns a branch at a time. If more edits arrive while its
        // request is running, it takes a fresh snapshot and saves again using
        // the version returned by the previous request.
        while (true) {
          const section = sectionsRef.current.find((candidate) => candidate.run.id === runId);
          if (!section) return false;
          const revision = Number(editRevisionsRef.current.get(runId) || 0);
          const payload = {
            version: Number(section.run.version || 0),
            items: section.items.map((item) => ({
              itemId: item.itemId,
              centralReservedQty: Number(item.centralReservedQty || 0),
              orderQty: Number(item.orderQty || 0),
              estimatedUnitPrice: Number(item.estimatedUnitPrice || 0),
              includeInPdf: item.includeInPdf !== false
            }))
          };
          const res = await axios.put(`/api/weekly-purchases/${runId}`, payload);
          const unchangedDuringSave = Number(editRevisionsRef.current.get(runId) || 0) === revision;
          const nextSections = sectionsRef.current.map((candidate) => {
            if (candidate.run.id !== runId) return candidate;
            return unchangedDuringSave
              ? res.data
              : { ...candidate, run: { ...candidate.run, version: res.data.run.version, updatedAt: res.data.run.updatedAt } };
          });
          sectionsRef.current = nextSections;
          setSections(nextSections);

          if (!unchangedDuringSave) continue;
          setDirtyRuns((current) => {
            const next = new Set(current);
            next.delete(runId);
            return next;
          });
          setRunMessages((current) => ({ ...current, [runId]: null }));
          return true;
        }
      } catch (error) {
        const stale = error?.response?.status === 409;
        setRunMessages((current) => ({
          ...current,
          [runId]: {
            type: "error",
            text: error?.response?.data?.message || "Could not save this branch purchase.",
            stale
          }
        }));
        return false;
      } finally {
        setSavingRuns((current) => {
          const next = new Set(current);
          next.delete(runId);
          return next;
        });
      }
    })();
    savePromisesRef.current.set(runId, savePromise);
    try {
      return await savePromise;
    } finally {
      if (savePromisesRef.current.get(runId) === savePromise) savePromisesRef.current.delete(runId);
    }
  }

  const reloadSection = async (runId) => {
    try {
      setSavingRuns((current) => new Set(current).add(runId));
      const res = await axios.get(`/api/weekly-purchases/${runId}`);
      const pendingTimer = autosaveTimersRef.current.get(runId);
      if (pendingTimer) clearTimeout(pendingTimer);
      autosaveTimersRef.current.delete(runId);
      editRevisionsRef.current.set(runId, 0);
      const nextSections = sectionsRef.current.map((section) => section.run.id === runId ? res.data : section);
      sectionsRef.current = nextSections;
      setSections(nextSections);
      setDirtyRuns((current) => {
        const next = new Set(current);
        next.delete(runId);
        return next;
      });
      setRunMessages((current) => ({ ...current, [runId]: null }));
    } catch (error) {
      setRunMessages((current) => ({
        ...current,
        [runId]: { type: "error", text: error?.response?.data?.message || "Could not reload this branch." }
      }));
    } finally {
      setSavingRuns((current) => {
        const next = new Set(current);
        next.delete(runId);
        return next;
      });
    }
  };

  const downloadVendorPdf = async (section) => {
    const runId = section.run.id;
    try {
      setPdfRuns((current) => new Set(current).add(runId));
      setRunMessages((current) => ({ ...current, [runId]: null }));
      const res = await axios.get(`/api/weekly-purchases/${runId}/vendor-pdf`);
      const snapshot = res.data;
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text("Purchase Requirement", 14, 18);
      doc.setFontSize(11);
      doc.text(`Branch: ${snapshot.branch?.name || snapshot.branch?.id || ""}`, 14, 28);
      doc.text(`Week: ${snapshot.weekStartDate || ""}`, 14, 35);
      autoTable(doc, {
        startY: 43,
        head: [["Item", "Purchase requirement"]],
        body: (snapshot.items || []).map((item) => [item.itemName, item.orderQty]),
        styles: { fontSize: 11 },
        headStyles: { fillColor: [30, 64, 175] },
        columnStyles: { 1: { halign: "right" } }
      });
      const branchSlug = String(snapshot.branch?.name || snapshot.branch?.id || "branch")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      doc.save(`${branchSlug || "branch"}-purchase-${snapshot.weekStartDate || "week"}.pdf`);
      setRunMessages((current) => ({ ...current, [runId]: { type: "success", text: "Vendor PDF downloaded from the saved branch purchase." } }));
    } catch (error) {
      setRunMessages((current) => ({
        ...current,
        [runId]: { type: "error", text: error?.response?.data?.message || "Could not generate the vendor PDF." }
      }));
    } finally {
      setPdfRuns((current) => {
        const next = new Set(current);
        next.delete(runId);
        return next;
      });
    }
  };

  const createIdempotencyKey = (runId) => {
    if (globalThis.crypto?.randomUUID) return `weekly-order:${runId}:${globalThis.crypto.randomUUID()}`;
    return `weekly-order:${runId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  };

  const prepareOrder = async (runId) => {
    const saved = await saveLatestSection(runId);
    if (!saved) return;
    const latest = sectionsRef.current.find((section) => section.run.id === runId);
    if (latest) setOrderCandidate(latest);
  };

  const orderBranch = async () => {
    if (!orderCandidate) return;
    const runId = orderCandidate.run.id;
    try {
      setOrderingRunId(runId);
      setRunMessages((current) => ({ ...current, [runId]: null }));
      await axios.post(`/api/weekly-purchases/${runId}/order`, {
        version: Number(orderCandidate.run.version || 0),
        idempotencyKey: createIdempotencyKey(runId)
      });
      const nextSections = sectionsRef.current.filter((section) => section.run.id !== runId);
      sectionsRef.current = nextSections;
      setSections(nextSections);
      setDirtyRuns((current) => {
        const next = new Set(current);
        next.delete(runId);
        return next;
      });
      setSuccessBanner(`${orderCandidate.branch.name} was marked Ordered and moved to Distribution.`);
      setOrderCandidate(null);
    } catch (error) {
      setRunMessages((current) => ({
        ...current,
        [runId]: {
          type: "error",
          text: error?.response?.data?.message || "Could not mark this branch as Ordered.",
          stale: error?.response?.status === 409
        }
      }));
      setOrderCandidate(null);
    } finally {
      setOrderingRunId("");
    }
  };

  return (
    <div className="branch-purchase-page">
      {errorBanner && (
        <div className="banner banner--warning">
          <strong>Warning:</strong> {errorBanner}
        </div>
      )}
      {successBanner && (
        <div className="banner banner--success">
          <span>{successBanner}</span>
          <button type="button" className="btn btn-ghost" onClick={() => setSuccessBanner("")}>Dismiss</button>
        </div>
      )}

      <section className="section-card branch-purchase-summary">
        <div>
          <h3 className="section-title">Branch Purchase Requests</h3>
          <p className="muted-text">Adjust each branch independently. Changes save automatically, and released central stock becomes available to other branches.</p>
        </div>
        <div className="branch-purchase-summary__actions">
          {weekStartDate && <span className="stats-pill">Week <strong>{weekStartDate}</strong></span>}
          <span className="stats-pill">Branches <strong>{sections.length}</strong></span>
          <span className="stats-pill">Items <strong>{totals.itemCount}</strong></span>
          <span className="stats-pill">Estimated <strong>Rs {totals.estimatedSpend.toFixed(2)}</strong></span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => loadPurchases()}
            disabled={loading || dirtyRuns.size > 0 || savingRuns.size > 0}
            title={dirtyRuns.size > 0 || savingRuns.size > 0 ? "Wait for autosave before refreshing" : "Refresh branch purchases"}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </section>

      {!loading && sections.length === 0 && (
        <section className="section-card">
          <p className="muted-text" style={{ margin: 0 }}>No branches currently require purchasing. Fully stock-covered requests move directly to distribution.</p>
        </section>
      )}

      {sections.map((section) => {
        const runId = section.run.id;
        const isDirty = dirtyRuns.has(runId);
        const isSaving = savingRuns.has(runId);
        const isGeneratingPdf = pdfRuns.has(runId);
        const message = runMessages[runId];
        const sectionTotal = purchaseTotal(section.items);
        return (
          <section className="section-card branch-purchase-card" key={runId}>
            <div className="branch-purchase-card__header">
              <div>
                <div className="branch-purchase-card__title-row">
                  <h3 className="section-title">{section.branch.name}</h3>
                  {isSaving
                    ? <span className="stats-pill branch-purchase-card__unsaved">Saving...</span>
                    : isDirty
                      ? <span className="stats-pill branch-purchase-card__unsaved">Waiting to save</span>
                      : <span className="stats-pill">Saved</span>}
                </div>
                <p className="muted-text">
                  Submitted {section.request.submittedAt ? new Date(section.request.submittedAt).toLocaleString() : "—"}
                </p>
              </div>
              <div className="branch-purchase-card__metrics">
                <span className="stats-pill">Rows <strong>{section.items.length}</strong></span>
                <span className="stats-pill">Estimate <strong>Rs {sectionTotal.toFixed(2)}</strong></span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => downloadVendorPdf(section)}
                  disabled={isDirty || isSaving || isGeneratingPdf}
                  title={isDirty ? "Save this branch before downloading its PDF" : "Download vendor PDF"}
                >
                  {isGeneratingPdf ? "Preparing PDF..." : "Download PDF"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => prepareOrder(runId)}
                  disabled={isSaving || isGeneratingPdf || orderingRunId === runId}
                  title={isDirty ? "Save pending changes, then mark Ordered" : "Lock this order and open Distribution"}
                >
                  {orderingRunId === runId ? "Ordering..." : "Ordered"}
                </button>
              </div>
            </div>

            {message && (
              <div className={`banner ${message.type === "success" ? "banner--success" : "banner--warning"}`} style={{ marginTop: "0.85rem" }}>
                <span>{message.text}</span>
                {message.stale && (
                  <button type="button" className="btn btn-ghost" onClick={() => reloadSection(runId)} disabled={isSaving}>
                    Reload branch
                  </button>
                )}
              </div>
            )}

            <div className="table-wrapper branch-purchase-table">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Requested</th>
                    <th>From central</th>
                    <th>Need to purchase</th>
                    <th>Order qty</th>
                    <th>Estimated MRP</th>
                    <th>PDF</th>
                    <th>Estimated total</th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map((item) => (
                    <tr key={item.itemId}>
                      <td>
                        <strong>{item.itemName}</strong>
                        {item.categoryName && <span className="branch-purchase-item__category">{item.categoryName}</span>}
                      </td>
                      <td>{item.requestedQty}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={item.maxCentralQty}
                          step="any"
                          value={item.centralReservedQty}
                          onChange={(event) => changeItem(runId, item.itemId, "centralReservedQty", normalizeNumber(event.target.value))}
                          aria-label={`${item.itemName} from central`}
                        />
                        <span className="branch-purchase-field-help">
                          {item.availableCentralQty} more available
                        </span>
                      </td>
                      <td><strong>{Math.max(0, Number(item.requestedQty || 0) - Number(item.centralReservedQty || 0))}</strong></td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={item.orderQty}
                          onChange={(event) => changeItem(runId, item.itemId, "orderQty", normalizeNumber(event.target.value))}
                          aria-label={`${item.itemName} order quantity`}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={item.estimatedUnitPrice}
                          onChange={(event) => changeItem(runId, item.itemId, "estimatedUnitPrice", normalizeNumber(event.target.value))}
                          aria-label={`${item.itemName} estimated MRP`}
                        />
                      </td>
                      <td className="branch-purchase-checkbox-cell">
                        <input
                          type="checkbox"
                          checked={item.includeInPdf !== false}
                          onChange={(event) => changeItem(runId, item.itemId, "includeInPdf", event.target.checked)}
                          aria-label={`Include ${item.itemName} in PDF`}
                        />
                      </td>
                      <td>Rs {(Number(item.orderQty || 0) * Number(item.estimatedUnitPrice || 0)).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <Modal
        open={!!orderCandidate}
        title={orderCandidate ? `Mark ${orderCandidate.branch.name} as Ordered?` : "Mark branch as Ordered?"}
        onClose={() => { if (!orderingRunId) setOrderCandidate(null); }}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setOrderCandidate(null)} disabled={!!orderingRunId}>
              Keep editing
            </button>
            <button type="button" className="btn btn-primary" onClick={orderBranch} disabled={!!orderingRunId}>
              {orderingRunId ? "Ordering..." : "Confirm Ordered"}
            </button>
          </>
        }
      >
        <p className="muted-text" style={{ margin: 0 }}>
          This creates an immutable order log, locks this branch purchase, opens branch receipt verification, and moves it to Distribution.
        </p>
      </Modal>
    </div>
  );
}

export default CombinedPurchaseRun;
