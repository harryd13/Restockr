import { COLLECTIONS } from "../config.js";

export function createDistributionRepository(database) {
  return {
    distributionRuns: () => database.collection(COLLECTIONS.DISTRIBUTION_RUNS),
    distributionItems: () => database.collection(COLLECTIONS.DISTRIBUTION_ITEMS),
    distributionReceipts: () => database.collection(COLLECTIONS.DISTRIBUTION_RECEIPTS),
    distributionReconciliations: () => database.collection(COLLECTIONS.DISTRIBUTION_RECONCILIATIONS),
    centralInventory: () => database.collection(COLLECTIONS.CENTRAL_INVENTORY),
    weeklyRequests: () => database.collection(COLLECTIONS.WEEKLY_REQUESTS),
    weeklyRequestItems: () => database.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS),
    purchaseLogs: () => database.collection(COLLECTIONS.PURCHASE_LOGS),
    unfulfilledLogs: () => database.collection(COLLECTIONS.UNFULFILLED_LOGS)
  };
}
