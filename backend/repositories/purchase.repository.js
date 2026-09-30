import { COLLECTIONS } from "../config.js";

export function createPurchaseRepository(database) {
  return {
    weeklyRequests: () => database.collection(COLLECTIONS.WEEKLY_REQUESTS),
    weeklyRequestItems: () => database.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS),
    purchaseLogs: () => database.collection(COLLECTIONS.PURCHASE_LOGS),
    expenseTickets: () => database.collection(COLLECTIONS.EXPENSE_TICKETS)
  };
}

