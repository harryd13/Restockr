import { COLLECTIONS } from "../config.js";

export function createSettingsService(getDb) {
  return {
    async getWeeklyOverrideSetting() {
      const doc = await getDb().collection(COLLECTIONS.SETTINGS).findOne({ key: "weeklyOverride" });
      return !!doc?.value;
    },
    async getReportStartDateSetting(userId) {
      if (!userId) return "";
      const doc = await getDb().collection(COLLECTIONS.SETTINGS).findOne({ key: `reportStartDate:${userId}` });
      return doc?.value || "";
    },
    async getInitialCashBalancesSetting() {
      const doc = await getDb().collection(COLLECTIONS.SETTINGS).findOne({ key: "initialCashBalances" });
      return {
        mode: doc?.value?.mode === "rebase" ? "rebase" : "base_date",
        cashAccount: Number(doc?.value?.cashAccount || 0),
        onlineAccount: Number(doc?.value?.onlineAccount || 0),
        effectiveDate: String(doc?.value?.effectiveDate || "").trim(),
        resetAt: String(doc?.value?.resetAt || "").trim()
      };
    },
    async getDueBalanceSetting() {
      const doc = await getDb().collection(COLLECTIONS.SETTINGS).findOne({ key: "dueBalanceConfig" });
      return {
        dueAccount: Number(doc?.value?.dueAccount || 0),
        resetAt: String(doc?.value?.resetAt || "").trim()
      };
    }
  };
}
