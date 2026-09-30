const IST_OFFSET_MS = 330 * 60 * 1000;

export function formatDateLocal(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatShiftedUtcDate(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getCurrentDateInIST(date = new Date()) {
  return formatShiftedUtcDate(new Date(date.getTime() + IST_OFFSET_MS));
}

export function getPreviousDateInIST(date = new Date()) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  shifted.setUTCDate(shifted.getUTCDate() - 1);
  return formatShiftedUtcDate(shifted);
}

export function parseStartDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed.toISOString();
}

export function startOfWeek(date = new Date()) {
  const today = new Date(date);
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() - ((today.getDay() - 4 + 7) % 7));
  return formatDateLocal(today);
}

export function isWeeklyWindow(date = new Date()) {
  const now = new Date(date);
  return now.getDay() === 4 || (now.getDay() === 5 && now.getHours() < 12);
}

export function isValidReportStartDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
