import { COLLECTIONS } from "../config.js";

export function createCashManagementRepository(database) {
  return {
    cashTallies: () => database.collection(COLLECTIONS.CASH_TALLIES),
    expenseTicketLogs: () => database.collection(COLLECTIONS.EXPENSE_TICKET_LOGS),
    branches: () => database.collection(COLLECTIONS.BRANCHES),
    expenseLogs: () => database.collection(COLLECTIONS.EXPENSE_LOGS),
    cashReports: () => database.collection(COLLECTIONS.CASH_REPORTS),
    combinedPurchaseLogs: () => database.collection(COLLECTIONS.COMBINED_PURCHASE_LOGS),
    dueClearanceLogs: () => database.collection(COLLECTIONS.DUE_CLEARANCE_LOGS)
  };
}

