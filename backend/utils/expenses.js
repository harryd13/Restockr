export function summarizeBranchExpenses(logs = []) {
  return logs.reduce((summary, log) => {
    const amount = Number(log?.amount || 0);
    const paymentMethod = String(log?.paymentMethod || "").trim();
    if (amount <= 0) return summary;
    summary.total += amount;
    if (paymentMethod === "Cash") summary.cash += amount;
    else if (paymentMethod === "UPI") summary.online += amount;
    else summary.other += amount;
    return summary;
  }, { total: 0, cash: 0, online: 0, other: 0 });
}

export function summarizeExpenseLogsByBranch(logs = []) {
  const summaryMap = new Map();
  logs.forEach((log) => {
    const branchId = String(log?.branchId || "").trim();
    if (!branchId) return;
    const current = summaryMap.get(branchId) || { total: 0, cash: 0, online: 0, other: 0 };
    const amount = Number(log?.amount || 0);
    const paymentMethod = String(log?.paymentMethod || "").trim();
    if (amount > 0) {
      current.total += amount;
      if (paymentMethod === "Cash") current.cash += amount;
      else if (paymentMethod === "UPI") current.online += amount;
      else current.other += amount;
    }
    summaryMap.set(branchId, current);
  });
  return summaryMap;
}

export function mergeExpenseSummaryMaps(...maps) {
  const merged = new Map();
  maps.forEach((map) => {
    if (!(map instanceof Map)) return;
    map.forEach((value, branchId) => {
      const current = merged.get(branchId) || { total: 0, cash: 0, online: 0, other: 0 };
      current.total += Number(value?.total || 0);
      current.cash += Number(value?.cash || 0);
      current.online += Number(value?.online || 0);
      current.other += Number(value?.other || 0);
      merged.set(branchId, current);
    });
  });
  return merged;
}

export function normalizeBranchIds(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean)));
  }
  return Array.from(new Set(String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean)));
}

export function getExpenseLogBusinessDate(log = {}) {
  return String(log?.completedDate || log?.requestDate || "").trim();
}

export function applyPaymentMethodAmount(acc, paymentMethod, amount, direction = 1) {
  const normalizedAmount = Number(amount || 0);
  if (normalizedAmount <= 0) return acc;
  const normalizedPaymentMethod = String(paymentMethod || "").trim();
  if (normalizedPaymentMethod === "Cash") acc.cashAccount += direction * normalizedAmount;
  else if (normalizedPaymentMethod === "UPI") acc.onlineAccount += direction * normalizedAmount;
  return acc;
}
