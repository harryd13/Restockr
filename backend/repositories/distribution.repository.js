import { COLLECTIONS } from "../config.js";

export function createDistributionRepository(database) {
  return {
    distributionRuns: () => database.collection(COLLECTIONS.DISTRIBUTION_RUNS),
    distributionItems: () => database.collection(COLLECTIONS.DISTRIBUTION_ITEMS),
    distributionReceipts: () => database.collection(COLLECTIONS.DISTRIBUTION_RECEIPTS),
    distributionReconciliations: () => database.collection(COLLECTIONS.DISTRIBUTION_RECONCILIATIONS),
    inventoryCommitmentLogs: () => database.collection(COLLECTIONS.INVENTORY_COMMITMENT_LOGS),
    weeklyCentralPurchaseLogs: () => database.collection(COLLECTIONS.WEEKLY_CENTRAL_PURCHASE_LOGS),
    weeklyDistributionLogs: () => database.collection(COLLECTIONS.WEEKLY_DISTRIBUTION_LOGS),
    items: () => database.collection(COLLECTIONS.ITEMS),
    centralInventory: () => database.collection(COLLECTIONS.CENTRAL_INVENTORY),
    weeklyRequests: () => database.collection(COLLECTIONS.WEEKLY_REQUESTS),
    weeklyRequestItems: () => database.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS),
    purchaseLogs: () => database.collection(COLLECTIONS.PURCHASE_LOGS),
    unfulfilledLogs: () => database.collection(COLLECTIONS.UNFULFILLED_LOGS),
    expenseTickets: () => database.collection(COLLECTIONS.EXPENSE_TICKETS),
    expenseTicketLogs: () => database.collection(COLLECTIONS.EXPENSE_TICKET_LOGS),
    weeklyPurchaseOrderLogs: () => database.collection(COLLECTIONS.WEEKLY_PURCHASE_ORDER_LOGS)
  };
}
