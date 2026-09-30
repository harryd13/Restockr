import "dotenv/config";

export const PORT = process.env.PORT || 4000;
export const JWT_SECRET = process.env.JWT_SECRET || "foffee_inventory_secret";
export const ALLOW_WEEKLY_ANY_DAY = String(process.env.WEEKLY_ALLOW_ANY_DAY || "").toLowerCase() === "true";

export const COLLECTIONS = {
  USERS: "users",
  BRANCHES: "branches",
  CATEGORIES: "categories",
  ITEMS: "items",
  WEEKLY_REQUESTS: "weeklyRequests",
  WEEKLY_REQUEST_ITEMS: "weeklyRequestItems",
  DAILY_REQUESTS: "dailyRequests",
  DAILY_REQUEST_ITEMS: "dailyRequestItems",
  MISC_REQUESTS: "miscRequests",
  MISC_REQUEST_ITEMS: "miscRequestItems",
  PURCHASE_LOGS: "purchaseLogs",
  CENTRAL_INVENTORY: "centralInventoryItems",
  COMBINED_PURCHASE_RUNS: "combinedPurchaseRuns",
  COMBINED_PURCHASE_ITEMS: "combinedPurchaseItems",
  DISTRIBUTION_RUNS: "distributionRuns",
  DISTRIBUTION_ITEMS: "distributionItems",
  DISTRIBUTION_RECEIPTS: "distributionReceipts",
  DISTRIBUTION_RECONCILIATIONS: "distributionReconciliations",
  UNFULFILLED_LOGS: "unfulfilledLogs",
  COMBINED_PURCHASE_LOGS: "combinedPurchaseLogs",
  TICKETS: "tickets",
  TICKET_ITEMS: "ticketItems",
  EXPENSE_LOGS: "expenseLogs",
  EXPENSE_TICKETS: "expenseTickets",
  EXPENSE_TICKET_LOGS: "expenseTicketLogs",
  CASH_TALLIES: "cashTallies",
  CASH_REPORTS: "cashReports",
  DUE_CLEARANCE_LOGS: "dueClearanceLogs",
  SETTINGS: "settings",
  MANUAL_ADJUSTMENTS: "manualInventoryAdjustments"
};

export const DAILY_MENTIONS = {
  RP: ["U0A78T3EPLP", "U0A838J0E73"],
  BR: ["U0A838J0E73"],
  RS: ["U0A5RMEA32N", "U0A838J0E73"]
};
