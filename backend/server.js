import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import { connectToDatabase, getClient, getDb } from "./db.js";
import { ALLOW_WEEKLY_ANY_DAY, COLLECTIONS, DAILY_MENTIONS, JWT_SECRET, PORT } from "./config.js";
import { createAuthMiddleware, ensureAdmin } from "./middleware/auth.js";
import {
  formatDateLocal,
  getCurrentDateInIST,
  getPreviousDateInIST,
  isValidReportStartDate,
  isWeeklyWindow,
  parseStartDate,
  startOfWeek
} from "./utils/dates.js";
import { formatMentions } from "./utils/notifications.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMasterDataRoutes } from "./routes/master-data.js";
import { registerReportRoutes } from "./routes/reports.js";
import {
  applyPaymentMethodAmount,
  getExpenseLogBusinessDate,
  mergeExpenseSummaryMaps,
  normalizeBranchIds,
  summarizeBranchExpenses,
  summarizeExpenseLogsByBranch
} from "./utils/expenses.js";
import { createSettingsService } from "./services/settings.js";
import { createCashReportingService } from "./services/cash-reporting.service.js";
import { createInventoryWorkflowService } from "./services/inventory-workflow.service.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerWeeklyRequestRoutes } from "./routes/weekly-requests.js";
import { registerDailyRequestRoutes } from "./routes/daily-requests.js";
import { registerMiscRequestRoutes } from "./routes/misc-requests.js";
import { registerTicketRoutes } from "./routes/tickets.js";
import { registerExpenseTicketRoutes } from "./routes/expense-tickets.js";
import { registerCashManagementRoutes } from "./routes/cash-management.js";
import { registerRequestHistoryRoutes } from "./routes/request-history.js";
import { registerInventoryRoutes } from "./routes/inventory.js";
import { registerCombinedPurchaseRoutes } from "./routes/combined-purchases.js";
import { registerDistributionRoutes } from "./routes/distribution.js";
import { registerPurchaseRoutes } from "./routes/purchase.js";
import { registerAdminRoutes } from "./routes/admin.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "8mb" }));

let db;
const {
  getWeeklyOverrideSetting,
  getReportStartDateSetting,
  getInitialCashBalancesSetting,
  getDueBalanceSetting
} = createSettingsService(() => db);

const {
  buildCashSummaryRows, summarizeCashRows, getCashAccountsSummary, sendSlackWebhook, sendDailyWebhook,
  sendCashReportWebhook, formatMoney, getCashReportPageLink, buildSlackCashDailyMessage,
  buildCashDailyReportsForDate, sendCashDailyReportForDate, scheduleCashReportJob
} = createCashReportingService({ getDb: () => db, COLLECTIONS, getInitialCashBalancesSetting, getDueBalanceSetting,
  applyPaymentMethodAmount, getExpenseLogBusinessDate, summarizeExpenseLogsByBranch, getPreviousDateInIST });

const authMiddleware = createAuthMiddleware(JWT_SECRET);

registerHealthRoutes(app);
registerAuthRoutes(app, { getDb: () => db, jwtSecret: JWT_SECRET, authMiddleware });
registerMasterDataRoutes(app, { getDb: () => db, authMiddleware });
registerReportRoutes(app, { getDb: () => db, authMiddleware });

const database = { collection: (...args) => db.collection(...args) };
const { getCentralInventoryMap, upsertCentralInventory, createCombinedPurchaseRunForRequest } =
  createInventoryWorkflowService({ getDb: () => db, COLLECTIONS, uuidv4, startOfWeek });

registerSettingsRoutes({ app, db: database, COLLECTIONS, authMiddleware, ensureAdmin, isValidReportStartDate, getWeeklyOverrideSetting, getReportStartDateSetting, getInitialCashBalancesSetting, getDueBalanceSetting });

registerWeeklyRequestRoutes({ app, db: database, COLLECTIONS, ALLOW_WEEKLY_ANY_DAY, uuidv4, authMiddleware, isWeeklyWindow, startOfWeek, getWeeklyOverrideSetting, createCombinedPurchaseRunForRequest });

registerDailyRequestRoutes({ app, db: database, COLLECTIONS, DAILY_MENTIONS, uuidv4, authMiddleware, formatDateLocal, formatMentions, sendDailyWebhook });

registerMiscRequestRoutes({ app, db: database, COLLECTIONS, uuidv4, authMiddleware, formatDateLocal });

registerTicketRoutes({ app, db: database, COLLECTIONS, uuidv4, authMiddleware, ensureAdmin, getCurrentDateInIST, parseStartDate, getCentralInventoryMap, upsertCentralInventory });

registerExpenseTicketRoutes({ app, db: database, COLLECTIONS, uuidv4, authMiddleware, ensureAdmin, formatDateLocal, sendSlackWebhook });

registerCashManagementRoutes({ app, db: database, COLLECTIONS, uuidv4, authMiddleware, ensureAdmin, formatDateLocal, getCurrentDateInIST, getPreviousDateInIST, summarizeBranchExpenses, summarizeExpenseLogsByBranch, mergeExpenseSummaryMaps, normalizeBranchIds, getExpenseLogBusinessDate, buildCashSummaryRows, summarizeCashRows, getCashAccountsSummary, sendCashDailyReportForDate });

registerRequestHistoryRoutes({ app, db: database, COLLECTIONS, uuidv4, authMiddleware, getCentralInventoryMap, upsertCentralInventory });

registerInventoryRoutes({ app, db: database, COLLECTIONS, uuidv4, authMiddleware, ensureAdmin, parseStartDate });

registerCombinedPurchaseRoutes({ app, db: database, COLLECTIONS, uuidv4, authMiddleware, ensureAdmin, formatDateLocal, getCurrentDateInIST, parseStartDate, startOfWeek, getCentralInventoryMap, upsertCentralInventory });

registerDistributionRoutes({ app, db: database, COLLECTIONS, uuidv4, authMiddleware, ensureAdmin, getClient, getCentralInventoryMap, upsertCentralInventory });

registerPurchaseRoutes({ app, db: database, COLLECTIONS, uuidv4, authMiddleware, formatDateLocal, startOfWeek });

registerAdminRoutes({ app, db: database, COLLECTIONS, uuidv4, authMiddleware, ensureAdmin });

app.get("/", (req, res) => {
  res.send("Foffee Inventory backend is running.");
});

async function start() {
  try {
    await connectToDatabase();
    db = getDb();
    scheduleCashReportJob();
    app.listen(PORT, () => {
      console.log(`Backend listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server", err);
    process.exit(1);
  }
}

start();
