import { COLLECTIONS } from "../config.js";

export function createCombinedPurchasesRepository(database) {
  return {
    combinedPurchaseRuns: () => database.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS),
    combinedPurchaseItems: () => database.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS),
    combinedPurchaseLogs: () => database.collection(COLLECTIONS.COMBINED_PURCHASE_LOGS),
    weeklyPurchaseOrderLogs: () => database.collection(COLLECTIONS.WEEKLY_PURCHASE_ORDER_LOGS),
    weeklyCentralPurchaseLogs: () => database.collection(COLLECTIONS.WEEKLY_CENTRAL_PURCHASE_LOGS),
    expenseTickets: () => database.collection(COLLECTIONS.EXPENSE_TICKETS),
    distributionRuns: () => database.collection(COLLECTIONS.DISTRIBUTION_RUNS),
    distributionItems: () => database.collection(COLLECTIONS.DISTRIBUTION_ITEMS),
    distributionReconciliations: () => database.collection(COLLECTIONS.DISTRIBUTION_RECONCILIATIONS),
    weeklyRequests: () => database.collection(COLLECTIONS.WEEKLY_REQUESTS),
    weeklyRequestItems: () => database.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS),
    centralInventory: () => database.collection(COLLECTIONS.CENTRAL_INVENTORY),
    branches: () => database.collection(COLLECTIONS.BRANCHES),
    items: () => database.collection(COLLECTIONS.ITEMS),
    categories: () => database.collection(COLLECTIONS.CATEGORIES)
  };
}
