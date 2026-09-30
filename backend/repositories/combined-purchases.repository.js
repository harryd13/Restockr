import { COLLECTIONS } from "../config.js";

export function createCombinedPurchasesRepository(database) {
  return {
    combinedPurchaseRuns: () => database.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS),
    combinedPurchaseItems: () => database.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS),
    combinedPurchaseLogs: () => database.collection(COLLECTIONS.COMBINED_PURCHASE_LOGS),
    expenseTickets: () => database.collection(COLLECTIONS.EXPENSE_TICKETS),
    distributionRuns: () => database.collection(COLLECTIONS.DISTRIBUTION_RUNS),
    distributionItems: () => database.collection(COLLECTIONS.DISTRIBUTION_ITEMS),
    distributionReconciliations: () => database.collection(COLLECTIONS.DISTRIBUTION_RECONCILIATIONS),
    weeklyRequests: () => database.collection(COLLECTIONS.WEEKLY_REQUESTS),
    weeklyRequestItems: () => database.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS),
    items: () => database.collection(COLLECTIONS.ITEMS),
    categories: () => database.collection(COLLECTIONS.CATEGORIES)
  };
}
