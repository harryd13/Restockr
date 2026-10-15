function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function requestKey(entry) {
  return String(entry?.requestId || entry?.distributionRunId || entry?.orderLogId || entry?.branchId || "");
}

function replaceRequest(branches, branch) {
  const key = requestKey(branch);
  const previous = (branches || []).find((entry) => requestKey(entry) === key);
  const merged = previous ? { ...previous, ...branch } : branch;
  return [...(branches || []).filter((entry) => requestKey(entry) !== key), merged]
    .sort((a, b) => {
      const branchOrder = String(a.branchId).localeCompare(String(b.branchId));
      if (branchOrder) return branchOrder;
      const aDate = String(a.requestCreatedAt || a.orderedAt || a.createdAt || "");
      const bDate = String(b.requestCreatedAt || b.orderedAt || b.createdAt || "");
      return aDate.localeCompare(bDate) || requestKey(a).localeCompare(requestKey(b));
    });
}

export async function upsertWeeklyCentralPurchaseLog(collection, weekStartDate, branch, { session } = {}) {
  const existing = await collection.findOne({ weekStartDate }, { session });
  const branches = replaceRequest(existing?.branches, branch);
  const totals = branches.reduce((sum, entry) => ({
    orderedQty: sum.orderedQty + Number(entry.orderedQty || 0),
    purchasedQty: sum.purchasedQty + Number(entry.purchasedQty || 0),
    purchaseAmount: money(sum.purchaseAmount + Number(entry.purchaseAmount || 0)),
    paidAmount: money(sum.paidAmount + Number(entry.paidAmount || 0)),
    pendingAmount: money(sum.pendingAmount + Number(entry.pendingAmount || 0)),
    cashPaid: money(sum.cashPaid + Number(entry.cashPaid || 0)),
    upiPaid: money(sum.upiPaid + Number(entry.upiPaid || 0))
  }), { orderedQty: 0, purchasedQty: 0, purchaseAmount: 0, paidAmount: 0, pendingAmount: 0, cashPaid: 0, upiPaid: 0 });
  const nowIso = new Date().toISOString();
  const document = {
    id: existing?.id || `weekly-central-purchase:${weekStartDate}`,
    weekStartDate,
    status: branches.every((entry) => entry.distributionStatus === "FINALIZED") ? "FINALIZED" : "OPEN",
    branchCount: new Set(branches.map((entry) => entry.branchId)).size,
    requestCount: branches.length,
    branches,
    totals,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso
  };
  await collection.updateOne({ weekStartDate }, { $set: document }, { upsert: true, session });
  return document;
}

export async function upsertWeeklyDistributionLog(collection, weekStartDate, branch, { session } = {}) {
  const existing = await collection.findOne({ weekStartDate }, { session });
  const branches = replaceRequest(existing?.branches, branch);
  const totals = branches.reduce((sum, entry) => ({
    requestedQty: sum.requestedQty + Number(entry.requestedQty || 0),
    finalDeliveredQty: sum.finalDeliveredQty + Number(entry.finalDeliveredQty || 0),
    centralCommittedQty: sum.centralCommittedQty + Number(entry.centralCommittedQty || 0),
    purchasedDeliveredQty: sum.purchasedDeliveredQty + Number(entry.purchasedDeliveredQty || 0),
    purchasedSurplusQty: sum.purchasedSurplusQty + Number(entry.purchasedSurplusQty || 0),
    purchasedDistributedValue: money(sum.purchasedDistributedValue + Number(entry.purchasedDistributedValue || 0))
  }), { requestedQty: 0, finalDeliveredQty: 0, centralCommittedQty: 0, purchasedDeliveredQty: 0, purchasedSurplusQty: 0, purchasedDistributedValue: 0 });
  const nowIso = new Date().toISOString();
  const document = {
    id: existing?.id || `weekly-distribution:${weekStartDate}`,
    weekStartDate,
    status: branches.every((entry) => entry.status === "FINALIZED") ? "FINALIZED" : "OPEN",
    branchCount: new Set(branches.map((entry) => entry.branchId)).size,
    requestCount: branches.length,
    branches,
    totals,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso
  };
  await collection.updateOne({ weekStartDate }, { $set: document }, { upsert: true, session });
  return document;
}
