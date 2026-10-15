import { COLLECTIONS } from "../config.js";

export function createReportsRepository(getDb) {
  return {
    weeklyRequests: () => getDb().collection(COLLECTIONS.WEEKLY_REQUESTS),
    weeklyRequestItems: () => getDb().collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS),
    purchaseLogs: () => getDb().collection(COLLECTIONS.PURCHASE_LOGS),
    distributionRuns: () => getDb().collection(COLLECTIONS.DISTRIBUTION_RUNS),
    distributionItems: () => getDb().collection(COLLECTIONS.DISTRIBUTION_ITEMS),
    distributionReceipts: () => getDb().collection(COLLECTIONS.DISTRIBUTION_RECEIPTS),
    weeklyPurchaseOrderLogs: () => getDb().collection(COLLECTIONS.WEEKLY_PURCHASE_ORDER_LOGS),
    inventoryCommitmentLogs: () => getDb().collection(COLLECTIONS.INVENTORY_COMMITMENT_LOGS),
    expenseTickets: () => getDb().collection(COLLECTIONS.EXPENSE_TICKETS),
    expenseTicketLogs: () => getDb().collection(COLLECTIONS.EXPENSE_TICKET_LOGS),
    unfulfilledLogs: () => getDb().collection(COLLECTIONS.UNFULFILLED_LOGS),
    weeklyCentralPurchaseLogs: () => getDb().collection(COLLECTIONS.WEEKLY_CENTRAL_PURCHASE_LOGS),
    weeklyDistributionLogs: () => getDb().collection(COLLECTIONS.WEEKLY_DISTRIBUTION_LOGS)
  };
}
