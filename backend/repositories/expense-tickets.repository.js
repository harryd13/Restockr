import { COLLECTIONS } from "../config.js";

export function createExpenseTicketsRepository(database) {
  return {
    expenseTickets: () => database.collection(COLLECTIONS.EXPENSE_TICKETS),
    expenseTicketLogs: () => database.collection(COLLECTIONS.EXPENSE_TICKET_LOGS),
    branches: () => database.collection(COLLECTIONS.BRANCHES),
    distributionItems: () => database.collection(COLLECTIONS.DISTRIBUTION_ITEMS),
    distributionRuns: () => database.collection(COLLECTIONS.DISTRIBUTION_RUNS),
    weeklyPurchaseOrderLogs: () => database.collection(COLLECTIONS.WEEKLY_PURCHASE_ORDER_LOGS),
    weeklyCentralPurchaseLogs: () => database.collection(COLLECTIONS.WEEKLY_CENTRAL_PURCHASE_LOGS),
    centralProcurements: () => database.collection(COLLECTIONS.CENTRAL_PROCUREMENTS)
  };
}
