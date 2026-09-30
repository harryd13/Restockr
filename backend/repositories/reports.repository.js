import { COLLECTIONS } from "../config.js";

export function createReportsRepository(getDb) {
  return {
    weeklyRequests: () => getDb().collection(COLLECTIONS.WEEKLY_REQUESTS),
    weeklyRequestItems: () => getDb().collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS),
    purchaseLogs: () => getDb().collection(COLLECTIONS.PURCHASE_LOGS)
  };
}
