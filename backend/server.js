import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import { connectToDatabase, getDb } from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "foffee_inventory_secret";

app.use(cors());
app.use(bodyParser.json({ limit: "8mb" }));

let db;

const COLLECTIONS = {
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
  UNFULFILLED_LOGS: "unfulfilledLogs",
  COMBINED_PURCHASE_LOGS: "combinedPurchaseLogs",
  TICKETS: "tickets",
  TICKET_ITEMS: "ticketItems",
  EXPENSE_LOGS: "expenseLogs",
  EXPENSE_TICKETS: "expenseTickets",
  EXPENSE_TICKET_LOGS: "expenseTicketLogs",
  SETTINGS: "settings"
};

// --- Helpers ---
function formatDateLocal(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseStartDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed.toISOString();
}

const ALLOW_WEEKLY_ANY_DAY = String(process.env.WEEKLY_ALLOW_ANY_DAY || "").toLowerCase() === "true";

function isWeeklyWindow(date = new Date()) {
  const now = new Date(date);
  const day = now.getDay();
  if (day === 4) return true; // Thursday
  if (day === 5 && now.getHours() < 12) return true; // Friday before noon
  return false;
}

function startOfWeek(date = new Date()) {
  // Business week starts on Thursday.
  const targetDow = 4; // Thursday
  const today = new Date(date);
  today.setHours(0, 0, 0, 0);
  const diff = (today.getDay() - targetDow + 7) % 7;
  today.setDate(today.getDate() - diff);
  return formatDateLocal(today);
}

const DAILY_MENTIONS = {
  RP: ["U0A78T3EPLP", "U0A838J0E73"],
  BR: ["U0A838J0E73"],
  RS: ["U0A5RMEA32N", "U0A838J0E73"]
};

function formatMentions(userIds) {
  if (!userIds || !userIds.length) return "";
  return userIds.map((id) => `<@${id}>`).join(" ");
}

async function getWeeklyOverrideSetting() {
  const settingsCol = db.collection(COLLECTIONS.SETTINGS);
  const doc = await settingsCol.findOne({ key: "weeklyOverride" });
  return !!doc?.value;
}

async function sendSlackWebhook(message) {
  const webhookUrl = String(process.env.WEBHOOK_URL || "").trim();
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message })
    });
  } catch (err) {
    console.error("Slack webhook failed", err?.message || err);
  }
}

async function sendDailyWebhook(message) {
  const webhookUrl = String(process.env.DAILYHOOK || "").trim();
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message })
    });
  } catch (err) {
    console.error("Daily webhook failed", err?.message || err);
  }
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ message: "Missing token" });
  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Invalid token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

function ensureAdmin(req, res) {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ message: "Admin role required" });
    return false;
  }
  return true;
}

app.get("/api/health", (req, res) => {
  const now = new Date();
  res.json({
    ok: true,
    serverTime: now.toISOString(),
    localTime: now.toString(),
    timezoneOffsetMinutes: now.getTimezoneOffset()
  });
});

async function getCentralInventoryMap(itemIds) {
  if (!itemIds.length) return new Map();
  const list = await db
    .collection(COLLECTIONS.CENTRAL_INVENTORY)
    .find({ itemId: { $in: itemIds } })
    .toArray();
  return new Map(list.map((row) => [row.itemId, Number(row.onHand || 0)]));
}

async function upsertCentralInventory(itemId, delta) {
  if (!itemId || !delta) return;
  await db.collection(COLLECTIONS.CENTRAL_INVENTORY).updateOne(
    { itemId },
    { $inc: { onHand: delta }, $set: { updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

async function createCombinedPurchaseRunForRequest(requestId) {
  const runsCol = db.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS);
  const itemsCol = db.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS);
  const distRunsCol = db.collection(COLLECTIONS.DISTRIBUTION_RUNS);
  const distItemsCol = db.collection(COLLECTIONS.DISTRIBUTION_ITEMS);
  const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const reqItemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);
  const masterItemsCol = db.collection(COLLECTIONS.ITEMS);
  const categoriesCol = db.collection(COLLECTIONS.CATEGORIES);

  const targetReq = await requestsCol.findOne({ id: requestId });
  const targetWeek = targetReq?.weekStartDate || startOfWeek();
  const pendingReqs = await requestsCol
    .find({ status: "SUBMITTED", weekStartDate: targetWeek })
    .sort({ createdAt: 1 })
    .toArray();
  if (!pendingReqs.length) return null;

  const runMap = new Map();
  const pendingIds = pendingReqs.map((r) => r.id);
  const staleRuns = await runsCol
    .find({ status: "DRAFT", weekStartDate: targetWeek, requestId: { $nin: pendingIds } })
    .toArray();
  if (staleRuns.length) {
    const staleIds = staleRuns.map((r) => r.id);
    await itemsCol.deleteMany({ runId: { $in: staleIds }, manual: { $ne: true } });
    await runsCol.updateMany({ id: { $in: staleIds } }, { $set: { status: "ARCHIVED", updatedAt: new Date().toISOString() } });
  }
  for (const pendingReq of pendingReqs) {
    let run = await runsCol.findOne({ requestId: pendingReq.id });
    if (run && run.status !== "DRAFT") continue;
    if (!run) {
      run = {
        id: uuidv4(),
        requestId: pendingReq.id,
        branchId: pendingReq.branchId,
        weekStartDate: pendingReq.weekStartDate,
        status: "DRAFT",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await runsCol.insertOne(run);
    }
    runMap.set(pendingReq.id, run);
  }

  const allReqItems = pendingIds.length ? await reqItemsCol.find({ requestId: { $in: pendingIds } }).toArray() : [];
  if (!allReqItems.length) return runMap.get(requestId) || null;

  const itemsByReqId = new Map();
  allReqItems.forEach((row) => {
    if (!itemsByReqId.has(row.requestId)) itemsByReqId.set(row.requestId, []);
    itemsByReqId.get(row.requestId).push(row);
  });

  const itemIds = Array.from(new Set(allReqItems.map((r) => r.itemId)));
  const inventoryMap = await getCentralInventoryMap(itemIds);
  const masterItems = await masterItemsCol.find({ id: { $in: itemIds } }).toArray();
  const masterMap = new Map(masterItems.map((it) => [it.id, it]));
  const categories = await categoriesCol.find({}).toArray();
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  const remainingMap = new Map(inventoryMap);
  const approvedByRequest = new Map();
  const shortfallByRequest = new Map();

  for (const pendingReq of pendingReqs) {
    const reqItems = itemsByReqId.get(pendingReq.id) || [];
    const approvedMap = new Map();
    const shortfallMap = new Map();
    for (const row of reqItems) {
      const requestedQty = Number(row.requestedQty || 0);
      const onHand = remainingMap.get(row.itemId) || 0;
      const allocated = Math.min(requestedQty, onHand);
      if (allocated > 0) approvedMap.set(row.itemId, allocated);
      const shortfall = Math.max(0, requestedQty - allocated);
      if (shortfall > 0) shortfallMap.set(row.itemId, shortfall);
      remainingMap.set(row.itemId, onHand - allocated);
    }
    approvedByRequest.set(pendingReq.id, approvedMap);
    shortfallByRequest.set(pendingReq.id, shortfallMap);
  }

  for (const pendingReq of pendingReqs) {
    const run = runMap.get(pendingReq.id);
    if (!run || run.status !== "DRAFT") continue;
    const reqItems = itemsByReqId.get(pendingReq.id) || [];
    const shortfallMap = shortfallByRequest.get(pendingReq.id) || new Map();
    const autoItems = [];
    for (const [itemId, shortfall] of shortfallMap.entries()) {
      const item = masterMap.get(itemId);
      if (!item) continue;
      autoItems.push({
        id: uuidv4(),
        runId: run.id,
        itemId,
        itemName: item.name,
        categoryName: categoryMap.get(item.categoryId) || "",
        requestedTotal: shortfall,
        approvedQty: shortfall,
        unitPrice: item.defaultPrice || 0,
        status: "AVAILABLE",
        manual: false,
        createdAt: new Date().toISOString()
      });
    }

    await itemsCol.deleteMany({ runId: run.id, manual: { $ne: true } });
    if (autoItems.length) {
      await itemsCol.insertMany(autoItems);
    }
    await runsCol.updateOne({ id: run.id }, { $set: { updatedAt: new Date().toISOString() } });

    if (!autoItems.length) {
      const existingDist = await distRunsCol.findOne({ requestId: pendingReq.id });
      if (!existingDist) {
        const distRun = {
          id: uuidv4(),
          requestId: pendingReq.id,
          branchId: pendingReq.branchId,
          weekStartDate: pendingReq.weekStartDate,
          combinedRunId: run.id,
          status: "DRAFT",
          createdAt: new Date().toISOString()
        };
        await distRunsCol.insertOne(distRun);

        const approvedMap = approvedByRequest.get(pendingReq.id) || new Map();
        const distItems = reqItems.map((row) => {
          const approvedQty = approvedMap.get(row.itemId) || 0;
          return {
            id: uuidv4(),
            runId: distRun.id,
            requestId: pendingReq.id,
            branchId: pendingReq.branchId,
            itemId: row.itemId,
            itemName: row.itemName,
            categoryName: row.categoryName,
            requestedQty: row.requestedQty,
            approvedQty,
            unitPrice: row.unitPrice || 0,
            status: approvedQty > 0 ? "AVAILABLE" : "UNAVAILABLE"
          };
        });

        if (distItems.length) {
          await distItemsCol.insertMany(distItems);
        }
      }
    }
  }

  return runMap.get(requestId) || null;
}

async function ensureIndexes() {
  await db.collection(COLLECTIONS.USERS).createIndex({ email: 1 }, { unique: true });
  await db.collection(COLLECTIONS.ITEMS).createIndex({ categoryId: 1 });
  await db.collection(COLLECTIONS.WEEKLY_REQUESTS).createIndex({ branchId: 1, weekStartDate: 1, status: 1 });
  await db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS).createIndex({ requestId: 1 });
  await db.collection(COLLECTIONS.DAILY_REQUESTS).createIndex({ branchId: 1, requestDate: 1, status: 1 });
  await db.collection(COLLECTIONS.DAILY_REQUEST_ITEMS).createIndex({ requestId: 1 });
  await db.collection(COLLECTIONS.MISC_REQUESTS).createIndex({ branchId: 1, createdAt: -1 });
  await db.collection(COLLECTIONS.MISC_REQUEST_ITEMS).createIndex({ requestId: 1 });
  await db.collection(COLLECTIONS.PURCHASE_LOGS).createIndex({ createdAt: -1 });
  try {
    await db.collection(COLLECTIONS.DISTRIBUTION_RUNS).dropIndex("weekStartDate_1");
  } catch (err) {
    if (err?.codeName !== "IndexNotFound" && err?.codeName !== "NamespaceNotFound" && err?.code !== 26) throw err;
  }
  try {
    await db.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS).dropIndex("weekStartDate_1");
  } catch (err) {
    if (err?.codeName !== "IndexNotFound" && err?.codeName !== "NamespaceNotFound" && err?.code !== 26) throw err;
  }
  await db.collection(COLLECTIONS.CENTRAL_INVENTORY).createIndex({ itemId: 1 }, { unique: true });
  await db.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS).createIndex({ requestId: 1 }, { unique: true });
  await db.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS).createIndex({ runId: 1 });
  await db.collection(COLLECTIONS.DISTRIBUTION_RUNS).createIndex({ requestId: 1 }, { unique: true });
  await db.collection(COLLECTIONS.DISTRIBUTION_ITEMS).createIndex({ runId: 1 });
  await db.collection(COLLECTIONS.UNFULFILLED_LOGS).createIndex({ weekStartDate: 1 });
  await db.collection(COLLECTIONS.COMBINED_PURCHASE_LOGS).createIndex({ createdAt: -1 });
  await db.collection(COLLECTIONS.TICKETS).createIndex({ status: 1, createdAt: -1 });
  await db.collection(COLLECTIONS.TICKET_ITEMS).createIndex({ ticketId: 1 });
  await db.collection(COLLECTIONS.EXPENSE_LOGS).createIndex({ createdAt: -1 });
  await db.collection(COLLECTIONS.EXPENSE_TICKETS).createIndex({ createdAt: -1 });
  await db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS).createIndex({ createdAt: -1 });
}

// --- Auth ---
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await db.collection(COLLECTIONS.USERS).findOne({ email, password });
  if (!user) return res.status(401).json({ message: "Invalid credentials" });
  const token = jwt.sign(
    { id: user.id, role: user.role, branchId: user.branchId, name: user.name },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role, branchId: user.branchId }
  });
});

// --- Master data ---
app.get("/api/me", authMiddleware, async (req, res) => {
  const user = await db.collection(COLLECTIONS.USERS).findOne({ id: req.user.id });
  if (!user) return res.status(404).json({ message: "User not found" });
  res.json({ id: user.id, name: user.name, role: user.role, branchId: user.branchId });
});

app.get("/api/settings/weekly-override", authMiddleware, async (req, res) => {
  const weeklyOverride = await getWeeklyOverrideSetting();
  res.json({ weeklyOverride });
});

app.get("/api/branches", authMiddleware, async (req, res) => {
  const list = await db.collection(COLLECTIONS.BRANCHES).find({}).toArray();
  res.json(list);
});

app.get("/api/categories", authMiddleware, async (req, res) => {
  const list = await db.collection(COLLECTIONS.CATEGORIES).find({}).toArray();
  res.json(list);
});

app.get("/api/items", authMiddleware, async (req, res) => {
  const { categoryId } = req.query;
  const filter = categoryId ? { categoryId } : {};
  const list = await db.collection(COLLECTIONS.ITEMS).find(filter).toArray();
  res.json(list);
});

// --- Branch Requests ---
app.get("/api/requests/current", authMiddleware, async (req, res) => {
  if (req.user.role !== "BRANCH") {
    return res.status(403).json({ message: "Branch role required" });
  }
  const branchId = req.user.branchId;
  const weekStartDate = startOfWeek();
  const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);

  const reqObj = await requestsCol.findOne({ branchId, weekStartDate, status: "DRAFT" });
  if (!reqObj) {
    return res.json({ request: null, items: [] });
  }
  const items = await itemsCol.find({ requestId: reqObj.id }).toArray();
  res.json({ request: reqObj, items });
});

app.post("/api/requests/current", authMiddleware, async (req, res) => {
  if (req.user.role !== "BRANCH") {
    return res.status(403).json({ message: "Branch role required" });
  }
  const weeklyOverride = await getWeeklyOverrideSetting();
  if (!ALLOW_WEEKLY_ANY_DAY && !weeklyOverride && !isWeeklyWindow()) {
    return res.status(400).json({ message: "Weekly requests can only be started on Thursday or before 12pm Friday." });
  }
  const branchId = req.user.branchId;
  const weekStartDate = startOfWeek();
  const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);

  let reqObj = await requestsCol.findOne({ branchId, weekStartDate, status: "DRAFT" });
  if (!reqObj) {
    reqObj = {
      id: uuidv4(),
      branchId,
      weekStartDate,
      status: "DRAFT",
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await requestsCol.insertOne(reqObj);
  }
  const items = await itemsCol.find({ requestId: reqObj.id }).toArray();
  res.status(201).json({ request: reqObj, items });
});

app.post("/api/requests/:id/items", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { items: bodyItems } = req.body; // [{ itemId, requestedQty }]
  const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);
  const masterItemsCol = db.collection(COLLECTIONS.ITEMS);
  const categoriesCol = db.collection(COLLECTIONS.CATEGORIES);

  const reqObj = await requestsCol.findOne({ id });
  if (!reqObj) return res.status(404).json({ message: "Request not found" });
  if (req.user.role !== "BRANCH" || req.user.branchId !== reqObj.branchId) {
    return res.status(403).json({ message: "Not allowed" });
  }
  if (reqObj.status !== "DRAFT") {
    return res.status(400).json({ message: "Cannot edit non-draft request" });
  }

  await itemsCol.deleteMany({ requestId: id });

  const itemIds = (bodyItems || []).filter((bi) => bi.requestedQty > 0).map((bi) => bi.itemId);
  const itemDocs = await masterItemsCol.find({ id: { $in: itemIds } }).toArray();
  const categoryDocs = await categoriesCol.find({}).toArray();
  const categoryMap = new Map(categoryDocs.map((c) => [c.id, c]));

  const newItems = [];
  for (const bi of bodyItems || []) {
    if (bi.requestedQty <= 0) continue;
    const item = itemDocs.find((it) => it.id === bi.itemId);
    if (!item) continue;
    const cat = categoryMap.get(item.categoryId);
    const unitPrice = item.defaultPrice || 0;
    newItems.push({
      id: uuidv4(),
      requestId: id,
      branchId: reqObj.branchId,
      itemId: item.id,
      itemName: item.name,
      categoryName: cat ? cat.name : "",
      requestedQty: bi.requestedQty,
      approvedQty: bi.requestedQty,
      unitPrice,
      totalPrice: unitPrice * bi.requestedQty,
      status: "AVAILABLE"
    });
  }

  if (newItems.length) {
    await itemsCol.insertMany(newItems);
  }
  await requestsCol.updateOne({ id }, { $set: { updatedAt: new Date().toISOString() } });
  const itemsForReq = await itemsCol.find({ requestId: id }).toArray();
  res.json({ request: reqObj, items: itemsForReq });
});

app.post("/api/requests/:id/submit", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);
  const reqObj = await requestsCol.findOne({ id });
  if (!reqObj) return res.status(404).json({ message: "Request not found" });
  if (req.user.role !== "BRANCH" || req.user.branchId !== reqObj.branchId) {
    return res.status(403).json({ message: "Not allowed" });
  }
  if (reqObj.status !== "DRAFT") {
    return res.status(400).json({ message: "Only draft can be submitted" });
  }
  const items = await itemsCol.find({ requestId: id }).toArray();
  if (!items.length) {
    return res.status(400).json({ message: "Cannot submit an empty request" });
  }
  await requestsCol.updateOne(
    { id },
    { $set: { status: "SUBMITTED", updatedAt: new Date().toISOString() } }
  );
  const updated = await requestsCol.findOne({ id });
  await createCombinedPurchaseRunForRequest(updated.id);
  res.json({ request: updated });
});

// --- Daily Requests ---
app.get("/api/daily-requests/current", authMiddleware, async (req, res) => {
  if (req.user.role !== "BRANCH") {
    return res.status(403).json({ message: "Branch role required" });
  }
  const branchId = req.user.branchId;
  const requestDate = formatDateLocal(new Date());
  const requestsCol = db.collection(COLLECTIONS.DAILY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.DAILY_REQUEST_ITEMS);

  let reqObj = await requestsCol.findOne({ branchId, requestDate, status: "DRAFT" });
  if (!reqObj) {
    reqObj = {
      id: uuidv4(),
      branchId,
      requestDate,
      status: "DRAFT",
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await requestsCol.insertOne(reqObj);
  }
  const items = await itemsCol.find({ requestId: reqObj.id }).toArray();
  res.json({ request: reqObj, items });
});

app.post("/api/daily-requests/:id/items", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { items: bodyItems } = req.body; // [{ itemId, requestedQty }]
  const requestsCol = db.collection(COLLECTIONS.DAILY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.DAILY_REQUEST_ITEMS);
  const masterItemsCol = db.collection(COLLECTIONS.ITEMS);
  const categoriesCol = db.collection(COLLECTIONS.CATEGORIES);

  const reqObj = await requestsCol.findOne({ id });
  if (!reqObj) return res.status(404).json({ message: "Request not found" });
  if (req.user.role !== "BRANCH" || req.user.branchId !== reqObj.branchId) {
    return res.status(403).json({ message: "Not allowed" });
  }
  if (reqObj.status !== "DRAFT") {
    return res.status(400).json({ message: "Cannot edit non-draft request" });
  }

  const requestedItems = (bodyItems || []).filter((bi) => bi.requestedQty > 0);
  if (requestedItems.length > 10) {
    return res.status(400).json({ message: "Daily requests allow a maximum of 10 items. Submit to create another request for today." });
  }

  await itemsCol.deleteMany({ requestId: id });

  const itemIds = requestedItems.map((bi) => bi.itemId);
  const itemDocs = await masterItemsCol.find({ id: { $in: itemIds } }).toArray();
  const categoryDocs = await categoriesCol.find({}).toArray();
  const categoryMap = new Map(categoryDocs.map((c) => [c.id, c]));

  const newItems = [];
  for (const bi of bodyItems || []) {
    if (bi.requestedQty <= 0) continue;
    const item = itemDocs.find((it) => it.id === bi.itemId);
    if (!item) continue;
    const cat = categoryMap.get(item.categoryId);
    const unitPrice = item.defaultPrice || 0;
    newItems.push({
      id: uuidv4(),
      requestId: id,
      branchId: reqObj.branchId,
      itemId: item.id,
      itemName: item.name,
      categoryName: cat ? cat.name : "",
      requestedQty: bi.requestedQty,
      unitPrice
    });
  }

  if (newItems.length) {
    await itemsCol.insertMany(newItems);
  }
  await requestsCol.updateOne({ id }, { $set: { updatedAt: new Date().toISOString() } });
  const itemsForReq = await itemsCol.find({ requestId: id }).toArray();
  res.json({ request: reqObj, items: itemsForReq });
});

app.post("/api/daily-requests/:id/submit", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const requestsCol = db.collection(COLLECTIONS.DAILY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.DAILY_REQUEST_ITEMS);
  const ticketsCol = db.collection(COLLECTIONS.TICKETS);
  const ticketItemsCol = db.collection(COLLECTIONS.TICKET_ITEMS);

  const reqObj = await requestsCol.findOne({ id });
  if (!reqObj) return res.status(404).json({ message: "Request not found" });
  if (req.user.role !== "BRANCH" || req.user.branchId !== reqObj.branchId) {
    return res.status(403).json({ message: "Not allowed" });
  }
  if (reqObj.status !== "DRAFT") {
    return res.status(400).json({ message: "Only draft can be submitted" });
  }

  const items = await itemsCol.find({ requestId: id }).toArray();
  if (!items.length) {
    return res.status(400).json({ message: "Cannot submit an empty request" });
  }

  await requestsCol.updateOne(
    { id },
    { $set: { status: "SUBMITTED", updatedAt: new Date().toISOString() } }
  );

  const ticket = {
    id: uuidv4(),
    requestId: id,
    branchId: reqObj.branchId,
    requestDate: reqObj.requestDate,
    status: "OPEN",
    type: "DAILY",
    assignee: "",
    paymentMethod: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await ticketsCol.insertOne(ticket);

  const ticketItems = items.map((it) => ({
    id: uuidv4(),
    ticketId: ticket.id,
    itemId: it.itemId,
    itemName: it.itemName,
    categoryName: it.categoryName,
    requestedQty: it.requestedQty,
    approvedQty: it.requestedQty,
    unitPrice: it.unitPrice || 0,
    fromStock: false
  }));
  await ticketItemsCol.insertMany(ticketItems);

  const branchDoc = await db.collection(COLLECTIONS.BRANCHES).findOne({ id: reqObj.branchId });
  const branchName = branchDoc?.name || reqObj.branchId;
  const mentionLine = formatMentions(DAILY_MENTIONS[reqObj.branchId] || []);
  const itemLines = items
    .map((it) => {
      const qty = Number(it.requestedQty || 0);
      return `${it.itemName} (${qty})`;
    })
    .join("\n");
  const total = items.reduce((sum, it) => sum + Number(it.requestedQty || 0) * Number(it.unitPrice || 0), 0);
  const separator = "_____________________________";
  const totalLine = mentionLine
    ? `Estimated total: Rs ${total.toFixed(2)} ${mentionLine}`
    : `Estimated total: Rs ${total.toFixed(2)}`;
  const dailyMessage = [
    "Daily request submitted.",
    `Branch - ${branchName}`,
    separator,
    "Items:-",
    itemLines || "None",
    separator,
    `Date: ${reqObj.requestDate}`,
    totalLine
  ].join("\n");
  sendDailyWebhook(dailyMessage);

  const updated = await requestsCol.findOne({ id });
  res.json({ request: updated });
});

// --- Misc Requests ---
app.post("/api/misc-requests/submit", authMiddleware, async (req, res) => {
  if (req.user.role !== "BRANCH") {
    return res.status(403).json({ message: "Branch role required" });
  }
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Items are required" });
  }

  const requestsCol = db.collection(COLLECTIONS.MISC_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.MISC_REQUEST_ITEMS);
  const ticketsCol = db.collection(COLLECTIONS.TICKETS);
  const ticketItemsCol = db.collection(COLLECTIONS.TICKET_ITEMS);

  const requestId = uuidv4();
  const requestDate = formatDateLocal(new Date());
  const reqDoc = {
    id: requestId,
    branchId: req.user.branchId,
    requestDate,
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };
  await requestsCol.insertOne(reqDoc);

  const cleanedItems = items
    .map((it) => ({
      itemName: String(it.itemName || "").trim(),
      requestedQty: Number(it.requestedQty || 0),
      reason: String(it.reason || "").trim()
    }))
    .filter((it) => it.itemName && it.requestedQty > 0);

  if (!cleanedItems.length) {
    return res.status(400).json({ message: "Valid items are required" });
  }

  const reqItems = cleanedItems.map((it) => ({
    id: uuidv4(),
    requestId,
    branchId: req.user.branchId,
    itemName: it.itemName,
    requestedQty: it.requestedQty,
    reason: it.reason || ""
  }));
  await itemsCol.insertMany(reqItems);

  const ticket = {
    id: uuidv4(),
    requestId,
    branchId: req.user.branchId,
    requestDate,
    status: "OPEN",
    type: "OTHER",
    assignee: "",
    paymentMethod: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await ticketsCol.insertOne(ticket);

  const ticketItems = reqItems.map((it) => ({
    id: uuidv4(),
    ticketId: ticket.id,
    itemId: uuidv4(),
    itemName: it.itemName,
    categoryName: "",
    requestedQty: it.requestedQty,
    approvedQty: it.requestedQty,
    unitPrice: 0,
    fromStock: false,
    reason: it.reason || ""
  }));
  await ticketItemsCol.insertMany(ticketItems);

  res.status(201).json({ ok: true, requestId });
});

// --- Tickets / Expenses ---
app.get("/api/tickets", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const status = req.query.status || "OPEN";
  const ticketsCol = db.collection(COLLECTIONS.TICKETS);
  const itemsCol = db.collection(COLLECTIONS.TICKET_ITEMS);
  const tickets = await ticketsCol.find({ status }).sort({ createdAt: -1 }).toArray();
  const ticketIds = tickets.map((t) => t.id);
  const items = ticketIds.length ? await itemsCol.find({ ticketId: { $in: ticketIds } }).toArray() : [];
  res.json({ tickets, items });
});

app.post("/api/tickets/:id/delete", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const { reason } = req.body || {};
  const allowedReasons = ["duplicate", "wrong", "stale"];
  if (!allowedReasons.includes(String(reason || "").toLowerCase())) {
    return res.status(400).json({ message: "Valid delete reason required." });
  }

  const ticketsCol = db.collection(COLLECTIONS.TICKETS);
  const ticket = await ticketsCol.findOne({ id });
  if (!ticket) return res.status(404).json({ message: "Ticket not found" });

  await ticketsCol.updateOne(
    { id },
    {
      $set: {
        status: "DELETED",
        deleteReason: String(reason).toLowerCase(),
        deletedAt: new Date().toISOString(),
        deletedBy: req.user.id,
        updatedAt: new Date().toISOString()
      }
    }
  );

  res.json({ ok: true });
});

app.post("/api/tickets/:id/done", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const { assignee, paymentMethod, items } = req.body;
  const ticketsCol = db.collection(COLLECTIONS.TICKETS);
  const itemsCol = db.collection(COLLECTIONS.TICKET_ITEMS);
  const logsCol = db.collection(COLLECTIONS.EXPENSE_LOGS);

  const ticket = await ticketsCol.findOne({ id });
  if (!ticket) return res.status(404).json({ message: "Ticket not found" });
  if (ticket.status !== "OPEN") return res.status(400).json({ message: "Ticket already closed" });
  if (!paymentMethod) return res.status(400).json({ message: "Payment method is required" });

  for (const row of items || []) {
    const update = {};
    if (typeof row.approvedQty === "number") update.approvedQty = row.approvedQty;
    if (typeof row.unitPrice === "number") update.unitPrice = row.unitPrice;
    if (typeof row.fromStock === "boolean") update.fromStock = row.fromStock;
    if (Object.keys(update).length) {
      await itemsCol.updateOne({ id: row.id, ticketId: id }, { $set: update });
    }
  }

  const updatedItems = await itemsCol.find({ ticketId: id }).toArray();
  const inventoryMap = await getCentralInventoryMap(updatedItems.map((row) => row.itemId));
  for (const row of updatedItems) {
    if (row.fromStock) {
      const approvedQty = Number(row.approvedQty || 0);
      const onHand = inventoryMap.get(row.itemId) || 0;
      if (approvedQty > onHand) {
        return res.status(400).json({ message: "From stock quantity exceeds central inventory" });
      }
      if (approvedQty > 0) {
        await upsertCentralInventory(row.itemId, -approvedQty);
      }
    }
  }

  const total = updatedItems.reduce((sum, row) => {
    if (row.fromStock) return sum;
    return sum + (row.approvedQty || 0) * (row.unitPrice || 0);
  }, 0);
  const requestTotal = updatedItems.reduce((sum, row) => sum + (row.approvedQty || 0) * (row.unitPrice || 0), 0);
  await logsCol.insertOne({
    id: uuidv4(),
    ticketId: id,
    branchId: ticket.branchId,
    type: ticket.type || "DAILY",
    requestDate: ticket.requestDate,
    assignee: assignee || ticket.assignee || "",
    paymentMethod: paymentMethod || ticket.paymentMethod || "",
    createdAt: ticket.createdAt,
    completedAt: new Date().toISOString(),
    total,
    requestTotal,
    items: updatedItems
  });

  await ticketsCol.updateOne(
    { id },
    { $set: { status: "DONE", assignee: assignee || "", paymentMethod: paymentMethod || "", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() } }
  );

  res.json({ ok: true });
});

app.post("/api/tickets/:id/partial", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const { assignee, paymentMethod, items } = req.body;
  const ticketsCol = db.collection(COLLECTIONS.TICKETS);
  const itemsCol = db.collection(COLLECTIONS.TICKET_ITEMS);
  const logsCol = db.collection(COLLECTIONS.EXPENSE_LOGS);

  const ticket = await ticketsCol.findOne({ id });
  if (!ticket) return res.status(404).json({ message: "Ticket not found" });
  if (ticket.status !== "OPEN") return res.status(400).json({ message: "Ticket already closed" });
  if (!paymentMethod) return res.status(400).json({ message: "Payment method is required" });

  for (const row of items || []) {
    const update = {};
    if (typeof row.approvedQty === "number") update.approvedQty = row.approvedQty;
    if (typeof row.unitPrice === "number") update.unitPrice = row.unitPrice;
    if (typeof row.fromStock === "boolean") update.fromStock = row.fromStock;
    if (Object.keys(update).length) {
      await itemsCol.updateOne({ id: row.id, ticketId: id }, { $set: update });
    }
  }

  const updatedItems = await itemsCol.find({ ticketId: id }).toArray();
  const completedItems = updatedItems.filter((row) => (row.approvedQty || 0) > 0);
  const remainingItems = updatedItems
    .map((row) => ({
      ...row,
      remainingQty: Math.max(0, (row.requestedQty || 0) - (row.approvedQty || 0))
    }))
    .filter((row) => row.remainingQty > 0);

  if (!completedItems.length) {
    return res.status(400).json({ message: "No approved items to submit" });
  }

  const inventoryMap = await getCentralInventoryMap(completedItems.map((row) => row.itemId));
  for (const row of completedItems) {
    if (row.fromStock) {
      const approvedQty = Number(row.approvedQty || 0);
      const onHand = inventoryMap.get(row.itemId) || 0;
      if (approvedQty > onHand) {
        return res.status(400).json({ message: "From stock quantity exceeds central inventory" });
      }
      if (approvedQty > 0) {
        await upsertCentralInventory(row.itemId, -approvedQty);
      }
    }
  }

  const total = completedItems.reduce((sum, row) => {
    if (row.fromStock) return sum;
    return sum + (row.approvedQty || 0) * (row.unitPrice || 0);
  }, 0);
  const requestTotal = completedItems.reduce((sum, row) => sum + (row.approvedQty || 0) * (row.unitPrice || 0), 0);

  await logsCol.insertOne({
    id: uuidv4(),
    ticketId: id,
    branchId: ticket.branchId,
    type: ticket.type || "DAILY",
    requestDate: ticket.requestDate,
    assignee: assignee || ticket.assignee || "",
    paymentMethod: paymentMethod || ticket.paymentMethod || "",
    createdAt: ticket.createdAt,
    completedAt: new Date().toISOString(),
    total,
    requestTotal,
    items: completedItems
  });

  if (remainingItems.length) {
    await itemsCol.deleteMany({ ticketId: id });
    const resetRemaining = remainingItems.map((row) => ({
      id: uuidv4(),
      ticketId: id,
      itemId: row.itemId,
      itemName: row.itemName,
      categoryName: row.categoryName,
      requestedQty: row.remainingQty,
      approvedQty: 0,
      unitPrice: row.unitPrice || 0,
      fromStock: false
    }));
    await itemsCol.insertMany(resetRemaining);
    await ticketsCol.updateOne(
      { id },
      { $set: { assignee: assignee || "", paymentMethod: paymentMethod || "", updatedAt: new Date().toISOString() } }
    );
  } else {
    await ticketsCol.updateOne(
      { id },
      { $set: { status: "DONE", assignee: assignee || "", paymentMethod: paymentMethod || "", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() } }
    );
  }

  res.json({ ok: true, remaining: remainingItems.length });
});

app.get("/api/tickets/expenses", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const startDate = parseStartDate(req.query.startDate);
  const filter = startDate ? { completedAt: { $gte: startDate } } : {};
  const logs = await db.collection(COLLECTIONS.EXPENSE_LOGS).find(filter).sort({ completedAt: -1 }).toArray();
  res.json(logs);
});

// --- Expense Tickets ---
app.post("/api/expense-tickets", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const {
    category,
    branchId,
    assignee,
    paymentMethod,
    amount,
    date,
    attachmentName,
    attachmentType,
    attachmentData,
    items,
    employeeName,
    source,
    note
  } = req.body;

  const normalizedCategory = String(category || "").trim();
  const normalizedBranchId = String(branchId || "").trim();
  const normalizedAssignee = String(assignee || "").trim();
  const normalizedPayment = String(paymentMethod || "").trim();
  const normalizedDate = String(date || "").trim();
  const normalizedAmount = Number(amount || 0);

  if (!normalizedCategory) return res.status(400).json({ message: "Category is required" });
  if (!normalizedBranchId) return res.status(400).json({ message: "Branch is required" });
  if (!normalizedAssignee) return res.status(400).json({ message: "Assignee is required" });
  if (!normalizedPayment) return res.status(400).json({ message: "Payment method is required" });
  if (!normalizedDate) return res.status(400).json({ message: "Date is required" });
  if (normalizedAmount <= 0) return res.status(400).json({ message: "Amount must be greater than zero" });

  if (normalizedCategory === "Salary" && !String(employeeName || "").trim()) {
    return res.status(400).json({ message: "Employee name is required for Salary" });
  }
  if (normalizedCategory === "Food Expense" && !String(source || "").trim()) {
    return res.status(400).json({ message: "Source is required for Food Expense" });
  }

  const ticketsCol = db.collection(COLLECTIONS.EXPENSE_TICKETS);
  const logsCol = db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS);
  const cleanedItems = Array.isArray(items)
    ? items
        .map((row) => ({
          name: String(row.name || "").trim(),
          qty: Number(row.qty || 0)
        }))
        .filter((row) => row.name && row.qty > 0)
    : [];
  const ticket = {
    id: uuidv4(),
    category: normalizedCategory,
    branchId: normalizedBranchId,
    assignee: normalizedAssignee,
    paymentMethod: normalizedPayment,
    amount: normalizedAmount,
    date: normalizedDate,
    attachmentName: String(attachmentName || "").trim(),
    attachmentType: String(attachmentType || "").trim(),
    attachmentData: String(attachmentData || ""),
    items: cleanedItems,
    employeeName: String(employeeName || "").trim(),
    source: String(source || "").trim(),
    note: String(note || "").trim(),
    status: "LOGGED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await ticketsCol.insertOne(ticket);

  await logsCol.insertOne({
    id: uuidv4(),
    ticketId: ticket.id,
    branchId: ticket.branchId,
    category: ticket.category,
    assignee: ticket.assignee,
    paymentMethod: ticket.paymentMethod,
    amount: ticket.amount,
    date: ticket.date,
    attachmentName: ticket.attachmentName,
    attachmentType: ticket.attachmentType,
    attachmentData: ticket.attachmentData,
    items: ticket.items || [],
    employeeName: ticket.employeeName,
    source: ticket.source,
    note: ticket.note,
    status: ticket.status,
    createdAt: ticket.createdAt
  });

  res.status(201).json({ ok: true, ticketId: ticket.id });
});

app.post("/api/expense-tickets/branch", authMiddleware, async (req, res) => {
  if (req.user?.role !== "BRANCH") {
    return res.status(403).json({ message: "Branch role required" });
  }
  const { items, paymentMethod, amount, date } = req.body;
  const normalizedPayment = String(paymentMethod || "").trim();
  const normalizedDate = String(date || "").trim();
  const normalizedAmount = Number(amount || 0);
  const cleanedItems = Array.isArray(items)
    ? items
        .map((row) => ({
          name: String(row.name || "").trim(),
          qty: Number(row.qty || 0)
        }))
        .filter((row) => row.name && row.qty > 0)
    : [];

  if (!cleanedItems.length) return res.status(400).json({ message: "At least one item is required" });
  if (!normalizedPayment) return res.status(400).json({ message: "Payment method is required" });
  if (!normalizedDate) return res.status(400).json({ message: "Date is required" });
  if (normalizedAmount <= 0) return res.status(400).json({ message: "Amount must be greater than zero" });

  const ticketsCol = db.collection(COLLECTIONS.EXPENSE_TICKETS);
  const logsCol = db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS);
  const ticket = {
    id: uuidv4(),
    category: "Branch Expense",
    branchId: req.user.branchId,
    assignee: "",
    paymentMethod: normalizedPayment,
    amount: normalizedAmount,
    date: normalizedDate,
    attachmentName: "",
    attachmentType: "",
    attachmentData: "",
    items: cleanedItems,
    employeeName: "",
    source: "",
    note: "",
    status: "LOGGED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await ticketsCol.insertOne(ticket);

  await logsCol.insertOne({
    id: uuidv4(),
    ticketId: ticket.id,
    branchId: ticket.branchId,
    category: ticket.category,
    assignee: ticket.assignee,
    paymentMethod: ticket.paymentMethod,
    amount: ticket.amount,
    date: ticket.date,
    attachmentName: ticket.attachmentName,
    attachmentType: ticket.attachmentType,
    attachmentData: ticket.attachmentData,
    items: ticket.items || [],
    employeeName: ticket.employeeName,
    source: ticket.source,
    note: ticket.note,
    status: ticket.status,
    createdAt: ticket.createdAt
  });

  const branchDoc = await db.collection(COLLECTIONS.BRANCHES).findOne({ id: ticket.branchId });
  const branchName = branchDoc?.name || ticket.branchId;
  const itemLines = (ticket.items || []).map((row) => `- ${row.name} (${row.qty})`).join("\n");
  const slackMessage = [
    `Branch expense logged: ${branchName}`,
    `Date: ${ticket.date}`,
    `Amount: Rs ${Number(ticket.amount || 0).toFixed(2)}`,
    `Payment: ${ticket.paymentMethod || "N/A"}`,
    itemLines ? `Items:\n${itemLines}` : "Items: None"
  ].join("\n");
  sendSlackWebhook(slackMessage);

  res.status(201).json({ ok: true, ticketId: ticket.id });
});

app.get("/api/expense-tickets/logs", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const startDate = String(req.query.startDate || "").trim();
  const filter = startDate ? { date: { $gte: startDate } } : {};
  const logs = await db
    .collection(COLLECTIONS.EXPENSE_TICKET_LOGS)
    .find(filter)
    .sort({ createdAt: -1 })
    .toArray();
  res.json(logs);
});

app.get("/api/expense-tickets/branch/history", authMiddleware, async (req, res) => {
  if (req.user?.role !== "BRANCH") {
    return res.status(403).json({ message: "Branch role required" });
  }
  const date = String(req.query.date || formatDateLocal(new Date())).trim();
  const logs = await db
    .collection(COLLECTIONS.EXPENSE_TICKET_LOGS)
    .find({ branchId: req.user.branchId, category: "Branch Expense", date, status: { $ne: "DELETED" } })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(logs);
});

app.post("/api/expense-tickets/branch/:id/update", authMiddleware, async (req, res) => {
  if (req.user?.role !== "BRANCH") {
    return res.status(403).json({ message: "Branch role required" });
  }
  const { id } = req.params;
  const { items, paymentMethod, amount, date } = req.body || {};
  const normalizedPayment = String(paymentMethod || "").trim();
  const normalizedDate = String(date || "").trim();
  const normalizedAmount = Number(amount || 0);
  const cleanedItems = Array.isArray(items)
    ? items
        .map((row) => ({
          name: String(row.name || "").trim(),
          qty: Number(row.qty || 0)
        }))
        .filter((row) => row.name && row.qty > 0)
    : [];

  if (!cleanedItems.length) return res.status(400).json({ message: "At least one item is required" });
  if (!normalizedPayment) return res.status(400).json({ message: "Payment method is required" });
  if (!normalizedDate) return res.status(400).json({ message: "Date is required" });
  if (normalizedAmount <= 0) return res.status(400).json({ message: "Amount must be greater than zero" });

  const ticketsCol = db.collection(COLLECTIONS.EXPENSE_TICKETS);
  const logsCol = db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS);
  const ticket = await ticketsCol.findOne({ id, branchId: req.user.branchId, category: "Branch Expense" });
  if (!ticket) return res.status(404).json({ message: "Expense ticket not found" });
  if (ticket.status === "DELETED") return res.status(400).json({ message: "Ticket already deleted" });

  const createdAt = new Date(ticket.createdAt || 0).getTime();
  const elapsedMs = Date.now() - createdAt;
  if (!(elapsedMs >= 0 && elapsedMs <= 60 * 60 * 1000)) {
    return res.status(400).json({ message: "Editing window has expired" });
  }

  const update = {
    paymentMethod: normalizedPayment,
    amount: normalizedAmount,
    date: normalizedDate,
    items: cleanedItems,
    updatedAt: new Date().toISOString()
  };

  await ticketsCol.updateOne({ id }, { $set: update });
  await logsCol.updateOne(
    { ticketId: id },
    {
      $set: {
        paymentMethod: update.paymentMethod,
        amount: update.amount,
        date: update.date,
        items: update.items,
        updatedAt: update.updatedAt
      }
    }
  );

  const branchDoc = await db.collection(COLLECTIONS.BRANCHES).findOne({ id: ticket.branchId });
  const branchName = branchDoc?.name || ticket.branchId;
  const itemLines = update.items.map((row) => `- ${row.name} (${row.qty})`).join("\n");
  const slackMessage = [
    `Branch expense updated: ${branchName}`,
    `Date: ${update.date}`,
    `Amount: Rs ${Number(update.amount || 0).toFixed(2)}`,
    `Payment: ${update.paymentMethod || "N/A"}`,
    itemLines ? `Items:\n${itemLines}` : "Items: None",
    `Ticket ID: ${id}`
  ].join("\n");
  sendSlackWebhook(slackMessage);

  res.json({ ok: true });
});

app.post("/api/expense-tickets/branch/:id/delete", authMiddleware, async (req, res) => {
  if (req.user?.role !== "BRANCH") {
    return res.status(403).json({ message: "Branch role required" });
  }
  const { id } = req.params;
  const ticketsCol = db.collection(COLLECTIONS.EXPENSE_TICKETS);
  const logsCol = db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS);
  const ticket = await ticketsCol.findOne({ id, branchId: req.user.branchId, category: "Branch Expense" });
  if (!ticket) return res.status(404).json({ message: "Expense ticket not found" });
  if (ticket.status === "DELETED") return res.status(400).json({ message: "Ticket already deleted" });

  const createdAt = new Date(ticket.createdAt || 0).getTime();
  const elapsedMs = Date.now() - createdAt;
  if (!(elapsedMs >= 0 && elapsedMs <= 60 * 60 * 1000)) {
    return res.status(400).json({ message: "Delete window has expired" });
  }

  const nowIso = new Date().toISOString();
  await ticketsCol.updateOne(
    { id },
    { $set: { status: "DELETED", deletedAt: nowIso, deletedBy: req.user.id, updatedAt: nowIso } }
  );
  await logsCol.updateOne(
    { ticketId: id },
    { $set: { status: "DELETED", deletedAt: nowIso, deletedBy: req.user.id, updatedAt: nowIso } }
  );

  const branchDoc = await db.collection(COLLECTIONS.BRANCHES).findOne({ id: ticket.branchId });
  const branchName = branchDoc?.name || ticket.branchId;
  const slackMessage = [
    `Branch expense deleted: ${branchName}`,
    `Date: ${ticket.date}`,
    `Amount: Rs ${Number(ticket.amount || 0).toFixed(2)}`,
    `Payment: ${ticket.paymentMethod || "N/A"}`,
    `Ticket ID: ${id}`
  ].join("\n");
  sendSlackWebhook(slackMessage);

  res.json({ ok: true });
});

app.get("/api/requests/history", authMiddleware, async (req, res) => {
  if (req.user.role !== "BRANCH") {
    return res.status(403).json({ message: "Branch role required" });
  }
  const branchId = req.user.branchId;
  const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);

  const list = await requestsCol
    .find({ branchId, status: { $ne: "DRAFT" } })
    .sort({ createdAt: -1, updatedAt: -1 })
    .toArray();

  const reqIds = list.map((r) => r.id);
  const items = await itemsCol.find({ requestId: { $in: reqIds } }).toArray();
  const totalMap = new Map();
  for (const it of items) {
    totalMap.set(it.requestId, (totalMap.get(it.requestId) || 0) + (it.totalPrice || 0));
  }

  const formatted = list
    .map((r) => ({
      id: r.id,
      weekStartDate: r.weekStartDate,
      status: r.status,
      total: totalMap.get(r.id) || 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }))
    .sort((a, b) => new Date(b.createdAt || b.updatedAt) - new Date(a.createdAt || a.updatedAt))
    .map(({ createdAt, updatedAt, ...rest }) => rest);

  res.json(formatted);
});

app.get("/api/requests/history/:id/items", authMiddleware, async (req, res) => {
  if (req.user.role !== "BRANCH") {
    return res.status(403).json({ message: "Branch role required" });
  }
  const { id } = req.params;
  const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);
  const distItemsCol = db.collection(COLLECTIONS.DISTRIBUTION_ITEMS);

  const reqObj = await requestsCol.findOne({ id, branchId: req.user.branchId });
  if (!reqObj) return res.status(404).json({ message: "Request not found" });

  const items = await itemsCol.find({ requestId: id }).toArray();
  const distItems = await distItemsCol.find({ requestId: id, branchId: req.user.branchId }).toArray();
  const distMap = new Map(distItems.map((row) => [row.itemId, row]));

  const result = items.map((row) => {
    const distRow = distMap.get(row.itemId);
    const approvedQty = distRow ? Number(distRow.approvedQty || 0) : 0;
    return {
      itemId: row.itemId,
      itemName: row.itemName,
      categoryName: row.categoryName,
      requestedQty: row.requestedQty,
      approvedQty,
      unitPrice: row.unitPrice || 0,
      status: distRow?.status || row.status || "AVAILABLE"
    };
  });

  res.json({ status: reqObj.status, items: result });
});

// --- Central Inventory / Combined Purchase / Distribution ---
app.get("/api/central-inventory", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const inventoryCol = db.collection(COLLECTIONS.CENTRAL_INVENTORY);
  const itemsCol = db.collection(COLLECTIONS.ITEMS);
  const categoriesCol = db.collection(COLLECTIONS.CATEGORIES);

  const inventory = await inventoryCol.find({ onHand: { $gt: 0 } }).toArray();
  const itemIds = inventory.map((row) => row.itemId);
  const masterItems = itemIds.length ? await itemsCol.find({ id: { $in: itemIds } }).toArray() : [];
  const categories = await categoriesCol.find({}).toArray();
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const itemMap = new Map(masterItems.map((it) => [it.id, it]));

  const rows = inventory.map((row) => {
      const item = itemMap.get(row.itemId);
      const unitPrice = item?.defaultPrice || 0;
      return {
        itemId: row.itemId,
        onHand: Number(row.onHand || 0),
        itemName: item?.name || row.itemId,
        categoryName: item ? categoryMap.get(item.categoryId) || "" : "",
        unitPrice,
        totalValue: Number(row.onHand || 0) * unitPrice,
        updatedAt: row.updatedAt
      };
    });

  const totalValue = rows.reduce((sum, row) => sum + (row.totalValue || 0), 0);
  res.json({ totalValue, rows });
});

app.get("/api/combined-purchase-runs", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const runs = await db
    .collection(COLLECTIONS.COMBINED_PURCHASE_RUNS)
    .find({ status: "DRAFT" })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(runs);
});

app.get("/api/combined-purchase-run", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const runId = req.query.runId;
  if (!runId) return res.status(400).json({ message: "runId is required" });
  const run = await db.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS).findOne({ id: runId });
  if (!run) return res.status(404).json({ message: "Combined purchase run not found" });
  const items = await db.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS).find({ runId: run.id }).toArray();
  res.json({ run, items });
});

app.get("/api/combined-purchase-queue", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const weekStartDate = String(req.query.week || startOfWeek()).trim();
  const runs = await db
    .collection(COLLECTIONS.COMBINED_PURCHASE_RUNS)
    .find({ status: "DRAFT", weekStartDate })
    .sort({ createdAt: -1 })
    .toArray();
  const runIds = runs.map((r) => r.id);
  const items = runIds.length ? await db.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS).find({ runId: { $in: runIds } }).toArray() : [];

  const combinedMap = new Map();
  for (const row of items) {
    const entry = combinedMap.get(row.itemId) || {
      itemId: row.itemId,
      itemName: row.itemName,
      categoryName: row.categoryName,
      requestedTotal: 0,
      approvedQty: 0,
      unitPrice: row.unitPrice || 0,
      status: "AVAILABLE"
    };
    entry.requestedTotal += Number(row.requestedTotal || 0);
    entry.approvedQty += Number(row.approvedQty || 0);
    if (row.status === "UNAVAILABLE") entry.status = "UNAVAILABLE";
    if (!entry.unitPrice) entry.unitPrice = row.unitPrice || 0;
    combinedMap.set(row.itemId, entry);
  }

  const combined = Array.from(combinedMap.values()).sort((a, b) => a.itemName.localeCompare(b.itemName));
  res.json({ rows: combined, runIds });
});

app.post("/api/combined-purchase-queue/submit", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { rows } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ message: "rows array is required" });

  const runsCol = db.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS);
  const itemsCol = db.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS);
  const logsCol = db.collection(COLLECTIONS.COMBINED_PURCHASE_LOGS);
  const distRunsCol = db.collection(COLLECTIONS.DISTRIBUTION_RUNS);
  const distItemsCol = db.collection(COLLECTIONS.DISTRIBUTION_ITEMS);
  const reqCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const reqItemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);

  const weekStartDate = String(req.query.week || startOfWeek()).trim();
  const draftRuns = await runsCol.find({ status: "DRAFT", weekStartDate }).sort({ createdAt: 1 }).toArray();
  const runIds = draftRuns.map((r) => r.id);

  const logItems = rows.map((row) => ({
    itemId: row.itemId,
    itemName: row.itemName,
    categoryName: row.categoryName,
    requestedTotal: Number(row.requestedTotal || 0),
    approvedQty: Number(row.approvedQty || 0),
    unitPrice: Number(row.unitPrice || 0),
    status: row.status === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE"
  }));
  const logTotal = logItems.reduce((sum, row) => sum + (row.approvedQty || 0) * (row.unitPrice || 0), 0);

  await logsCol.insertOne({
    id: uuidv4(),
    combinedRunIds: runIds,
    weekStartDate,
    requestCount: draftRuns.length,
    createdAt: new Date().toISOString(),
    total: logTotal,
    items: logItems
  });

  for (const item of logItems) {
    if (item.status === "AVAILABLE" && item.approvedQty > 0) {
      await upsertCentralInventory(item.itemId, item.approvedQty);
    }
  }

  if (runIds.length) {
    await runsCol.updateMany({ id: { $in: runIds } }, { $set: { status: "SUBMITTED", submittedAt: new Date().toISOString() } });
  }

  const reqIds = draftRuns.map((r) => r.requestId).filter(Boolean);
  const reqItemsAll = reqIds.length ? await reqItemsCol.find({ requestId: { $in: reqIds } }).toArray() : [];
  const allItemIds = Array.from(new Set(reqItemsAll.map((row) => row.itemId)));
  const inventoryMap = await getCentralInventoryMap(allItemIds);
  const availableMap = new Map(inventoryMap);
  const itemsById = new Map(logItems.map((row) => [row.itemId, row]));

  const existingDistRuns = reqIds.length
    ? await distRunsCol.find({ requestId: { $in: reqIds } }).toArray()
    : [];
  const existingRunIds = existingDistRuns.map((r) => r.id);
  if (existingRunIds.length) {
    const existingItems = await distItemsCol.find({ runId: { $in: existingRunIds } }).toArray();
    for (const row of existingItems) {
      const current = availableMap.get(row.itemId) || 0;
      const next = Math.max(0, current - Number(row.approvedQty || 0));
      availableMap.set(row.itemId, next);
    }
  }

  for (const run of draftRuns) {
    const existingDist = await distRunsCol.findOne({ combinedRunId: run.id });
    if (existingDist) continue;
    const req = await reqCol.findOne({ id: run.requestId });
    if (!req) continue;
    const reqItems = reqItemsAll.filter((row) => row.requestId === req.id);
    const distRun = {
      id: uuidv4(),
      requestId: req.id,
      branchId: req.branchId,
      weekStartDate: req.weekStartDate,
      combinedRunId: run.id,
      status: "DRAFT",
      createdAt: new Date().toISOString()
    };
    await distRunsCol.insertOne(distRun);

    const distItems = [];
    for (const row of reqItems) {
      const purchaseItem = itemsById.get(row.itemId);
      if (purchaseItem && purchaseItem.status === "UNAVAILABLE") {
        const remaining = availableMap.get(row.itemId) || 0;
        const approvedQty = Math.min(row.requestedQty || 0, remaining);
        availableMap.set(row.itemId, remaining - approvedQty);
        distItems.push({
          id: uuidv4(),
          runId: distRun.id,
          requestId: req.id,
          branchId: req.branchId,
          itemId: row.itemId,
          itemName: row.itemName,
          categoryName: row.categoryName,
          requestedQty: row.requestedQty,
          approvedQty,
          unitPrice: purchaseItem?.unitPrice || row.unitPrice || 0,
          status: "UNAVAILABLE"
        });
        continue;
      }
      const remaining = availableMap.get(row.itemId) || 0;
      const approvedQty = Math.min(row.requestedQty || 0, remaining);
      availableMap.set(row.itemId, remaining - approvedQty);
      distItems.push({
        id: uuidv4(),
        runId: distRun.id,
        requestId: req.id,
        branchId: req.branchId,
        itemId: row.itemId,
        itemName: row.itemName,
        categoryName: row.categoryName,
        requestedQty: row.requestedQty,
        approvedQty,
        unitPrice: purchaseItem?.unitPrice || row.unitPrice || 0,
        status: approvedQty > 0 ? "AVAILABLE" : "UNAVAILABLE"
      });
    }
    if (distItems.length) {
      await distItemsCol.insertMany(distItems);
    }
  }

  const updatedRuns = await runsCol.find({ status: "DRAFT" }).toArray();
  res.json({ ok: true, remaining: updatedRuns.length });
});

app.get("/api/combined-purchase-logs", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const startDate = parseStartDate(req.query.startDate);
  const filter = startDate ? { createdAt: { $gte: startDate } } : {};
  const logs = await db
    .collection(COLLECTIONS.COMBINED_PURCHASE_LOGS)
    .find(filter)
    .sort({ createdAt: -1 })
    .toArray();
  res.json(logs);
});

app.post("/api/combined-purchase-run/:id/items", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const { items: bodyItems } = req.body;
  const itemsCol = db.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS);
  const run = await db.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS).findOne({ id });
  if (!run) return res.status(404).json({ message: "Combined purchase run not found" });
  if (run.status !== "DRAFT") return res.status(400).json({ message: "Run is not editable" });

  for (const item of bodyItems || []) {
    const update = {};
    if (typeof item.approvedQty === "number") update.approvedQty = item.approvedQty;
    if (typeof item.unitPrice === "number") update.unitPrice = item.unitPrice;
    if (item.status === "AVAILABLE" || item.status === "UNAVAILABLE") update.status = item.status;
    if (item.status === "UNAVAILABLE") update.approvedQty = 0;
    if (typeof item.requestedTotal === "number") update.requestedTotal = item.requestedTotal;
    if (Object.keys(update).length) {
      await itemsCol.updateOne({ id: item.id, runId: id }, { $set: update });
    }
  }

  const updatedItems = await itemsCol.find({ runId: id }).toArray();
  res.json(updatedItems);
});

app.post("/api/combined-purchase-run/:id/add-item", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const { itemId, approvedQty, unitPrice, status } = req.body;
  if (!itemId) return res.status(400).json({ message: "itemId is required" });
  const runsCol = db.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS);
  const run = await runsCol.findOne({ id });
  if (!run) return res.status(404).json({ message: "Combined purchase run not found" });
  if (run.status !== "DRAFT") return res.status(400).json({ message: "Run is not editable" });

  const itemDoc = await db.collection(COLLECTIONS.ITEMS).findOne({ id: itemId });
  if (!itemDoc) return res.status(400).json({ message: "Invalid itemId" });
  const categoryDoc = await db.collection(COLLECTIONS.CATEGORIES).findOne({ id: itemDoc.categoryId });
  const doc = {
    id: uuidv4(),
    runId: id,
    itemId,
    itemName: itemDoc.name,
    categoryName: categoryDoc?.name || "",
    requestedTotal: Number(approvedQty || 0),
    approvedQty: Number(approvedQty || 0),
    unitPrice: typeof unitPrice === "number" ? unitPrice : itemDoc.defaultPrice || 0,
    status: status === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE",
    manual: true,
    createdAt: new Date().toISOString()
  };
  await db.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS).insertOne(doc);
  res.status(201).json(doc);
});

app.post("/api/combined-purchase-run/:id/submit", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const runsCol = db.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS);
  const itemsCol = db.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS);
  const logsCol = db.collection(COLLECTIONS.COMBINED_PURCHASE_LOGS);
  const run = await runsCol.findOne({ id });
  if (!run) return res.status(404).json({ message: "Combined purchase run not found" });
  if (run.status !== "DRAFT") return res.status(400).json({ message: "Run already submitted" });

  const items = await itemsCol.find({ runId: id }).toArray();
  if (!items.length) return res.status(400).json({ message: "No items to submit" });

  const logItems = items.map((item) => ({
    itemId: item.itemId,
    itemName: item.itemName,
    categoryName: item.categoryName,
    requestedTotal: item.requestedTotal,
    approvedQty: item.approvedQty,
    unitPrice: item.unitPrice,
    status: item.status
  }));
  const logTotal = logItems.reduce((sum, row) => sum + (row.approvedQty || 0) * (row.unitPrice || 0), 0);
  await logsCol.insertOne({
    id: uuidv4(),
    combinedRunId: run.id,
    requestId: run.requestId,
    branchId: run.branchId,
    weekStartDate: run.weekStartDate,
    createdAt: new Date().toISOString(),
    total: logTotal,
    items: logItems
  });

  for (const item of items) {
    if (item.status === "AVAILABLE" && Number(item.approvedQty || 0) > 0) {
      await upsertCentralInventory(item.itemId, Number(item.approvedQty || 0));
    }
  }

  await runsCol.updateOne({ id }, { $set: { status: "SUBMITTED", submittedAt: new Date().toISOString() } });

  const distRunsCol = db.collection(COLLECTIONS.DISTRIBUTION_RUNS);
  const distItemsCol = db.collection(COLLECTIONS.DISTRIBUTION_ITEMS);
  const reqCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const reqItemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);

  const existingDist = await distRunsCol.findOne({ combinedRunId: run.id });
  if (!existingDist) {
    const distRun = {
      id: uuidv4(),
      requestId: run.requestId,
      branchId: submittedReq?.branchId,
      weekStartDate: run.weekStartDate,
      combinedRunId: run.id,
      status: "DRAFT",
      createdAt: new Date().toISOString()
    };
    await distRunsCol.insertOne(distRun);

    const submittedReq = await reqCol.findOne({ id: run.requestId, status: "SUBMITTED" });
    const reqItems = submittedReq ? await reqItemsCol.find({ requestId: submittedReq.id }).toArray() : [];

    const itemIds = Array.from(new Set(reqItems.map((it) => it.itemId)));
    const inventoryMap = await getCentralInventoryMap(itemIds);
    const purchaseItemMap = new Map(items.map((it) => [it.itemId, it]));

    const availableMap = new Map();
    for (const itemId of itemIds) {
      const onHand = inventoryMap.get(itemId) || 0;
      availableMap.set(itemId, onHand);
    }

    const distItems = [];
    if (submittedReq) {
      for (const row of reqItems) {
        const purchaseItem = purchaseItemMap.get(row.itemId);
        const remaining = availableMap.get(row.itemId) || 0;
        if (purchaseItem && purchaseItem.status === "UNAVAILABLE") {
          const approvedQty = Math.min(row.requestedQty || 0, remaining);
          availableMap.set(row.itemId, remaining - approvedQty);
          distItems.push({
            id: uuidv4(),
            runId: distRun.id,
            requestId: submittedReq.id,
            branchId: submittedReq.branchId,
            itemId: row.itemId,
            itemName: row.itemName,
            categoryName: row.categoryName,
            requestedQty: row.requestedQty,
            approvedQty,
            unitPrice: purchaseItem?.unitPrice || row.unitPrice || 0,
            status: "UNAVAILABLE"
          });
          continue;
        }
        const approvedQty = Math.min(row.requestedQty || 0, remaining);
        availableMap.set(row.itemId, remaining - approvedQty);
        distItems.push({
          id: uuidv4(),
          runId: distRun.id,
          requestId: submittedReq.id,
          branchId: submittedReq.branchId,
          itemId: row.itemId,
          itemName: row.itemName,
          categoryName: row.categoryName,
          requestedQty: row.requestedQty,
          approvedQty,
          unitPrice: purchaseItem?.unitPrice || row.unitPrice || 0,
          status: approvedQty > 0 ? "AVAILABLE" : "UNAVAILABLE"
        });
      }
    }
    if (distItems.length) {
      await distItemsCol.insertMany(distItems);
    }
  }

  const updatedRun = await runsCol.findOne({ id });
  res.json({ run: updatedRun });
});

app.get("/api/distribution-run", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const runId = req.query.runId;
  const runsCol = db.collection(COLLECTIONS.DISTRIBUTION_RUNS);
  if (!runId) return res.status(400).json({ message: "runId is required" });
  const run = await runsCol.findOne({ id: runId });
  if (!run) return res.status(404).json({ message: "Distribution run not found" });
  const items = await db.collection(COLLECTIONS.DISTRIBUTION_ITEMS).find({ runId: run.id }).toArray();
  res.json({ run, items });
});

app.get("/api/distribution-runs", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const runs = await db
    .collection(COLLECTIONS.DISTRIBUTION_RUNS)
    .find({ status: "DRAFT" })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(runs);
});

app.get("/api/distribution-queue", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const runsCol = db.collection(COLLECTIONS.DISTRIBUTION_RUNS);
  const itemsCol = db.collection(COLLECTIONS.DISTRIBUTION_ITEMS);
  const reqCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);

  const runs = await runsCol.find({ status: "DRAFT" }).sort({ createdAt: -1 }).toArray();
  const runIds = runs.map((r) => r.id);
  const items = runIds.length ? await itemsCol.find({ runId: { $in: runIds } }).toArray() : [];

  const reqIds = runs.map((r) => r.requestId).filter(Boolean);
  const reqs = reqIds.length ? await reqCol.find({ id: { $in: reqIds } }).toArray() : [];
  const reqMap = new Map(reqs.map((r) => [r.id, r]));

  const normalizedRuns = runs.map((r) => {
    if (!r.branchId && r.requestId) {
      const req = reqMap.get(r.requestId);
      if (req) {
        return { ...r, branchId: req.branchId };
      }
    }
    return r;
  });

  res.json({ runs: normalizedRuns, items });
});

app.post("/api/distribution-run/:id/items", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const { items: bodyItems } = req.body;
  const runsCol = db.collection(COLLECTIONS.DISTRIBUTION_RUNS);
  const itemsCol = db.collection(COLLECTIONS.DISTRIBUTION_ITEMS);
  const run = await runsCol.findOne({ id });
  if (!run) return res.status(404).json({ message: "Distribution run not found" });
  if (run.status !== "DRAFT") return res.status(400).json({ message: "Run is not editable" });

  for (const item of bodyItems || []) {
    const update = {};
    if (typeof item.approvedQty === "number") update.approvedQty = item.approvedQty;
    if (Object.keys(update).length) {
      await itemsCol.updateOne({ id: item.id, runId: id }, { $set: update });
    }
  }
  const updated = await itemsCol.find({ runId: id }).toArray();
  res.json(updated);
});

app.post("/api/distribution-run/:id/finalize", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const runsCol = db.collection(COLLECTIONS.DISTRIBUTION_RUNS);
  const itemsCol = db.collection(COLLECTIONS.DISTRIBUTION_ITEMS);
  const reqCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const reqItemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);
  const logsCol = db.collection(COLLECTIONS.PURCHASE_LOGS);
  const unfulfilledCol = db.collection(COLLECTIONS.UNFULFILLED_LOGS);

  const run = await runsCol.findOne({ id });
  if (!run) return res.status(404).json({ message: "Distribution run not found" });
  if (run.status !== "DRAFT") return res.status(400).json({ message: "Run already finalized" });

  const distItems = await itemsCol.find({ runId: id }).toArray();
  if (!distItems.length) return res.status(400).json({ message: "No distribution items" });

  const perItemTotals = new Map();
  for (const row of distItems) {
    perItemTotals.set(row.itemId, (perItemTotals.get(row.itemId) || 0) + (row.approvedQty || 0));
  }
  const inventoryMap = await getCentralInventoryMap(Array.from(perItemTotals.keys()));
  for (const [itemId, qty] of perItemTotals.entries()) {
    const onHand = inventoryMap.get(itemId) || 0;
    if (qty > onHand) {
      return res.status(400).json({ message: "Distribution exceeds central inventory" });
    }
  }
  for (const [itemId, qty] of perItemTotals.entries()) {
    if (qty > 0) {
      await upsertCentralInventory(itemId, -Number(qty));
    }
  }

  const branchMap = new Map();
  let total = 0;
  for (const row of distItems) {
    const lineTotal = (row.approvedQty || 0) * (row.unitPrice || 0);
    total += lineTotal;
    if (!branchMap.has(row.branchId)) {
      branchMap.set(row.branchId, { branchId: row.branchId, total: 0, items: [] });
    }
    const entry = branchMap.get(row.branchId);
    entry.total += lineTotal;
    entry.items.push({
      itemId: row.itemId,
      itemName: row.itemName,
      categoryName: row.categoryName,
      requestedQty: row.requestedQty,
      approvedQty: row.approvedQty,
      unitPrice: row.unitPrice,
      totalPrice: lineTotal,
      status: row.status
    });
  }

  await logsCol.insertOne({
    id: uuidv4(),
    distributionRunId: id,
    weekStartDate: run.weekStartDate,
    createdAt: new Date().toISOString(),
    total,
    branches: Array.from(branchMap.values())
  });

  const submittedReqs = await reqCol.find({ id: run.requestId, status: "SUBMITTED" }).toArray();
  const reqItems = submittedReqs.length ? await reqItemsCol.find({ requestId: run.requestId }).toArray() : [];
  const distMap = new Map(distItems.map((row) => [`${row.requestId}:${row.itemId}`, row]));

  const unfulfilled = [];
  for (const reqItem of reqItems) {
    const key = `${reqItem.requestId}:${reqItem.itemId}`;
    const distRow = distMap.get(key);
    const approved = distRow ? distRow.approvedQty || 0 : 0;
    if (approved < (reqItem.requestedQty || 0)) {
      unfulfilled.push({
        id: uuidv4(),
        weekStartDate: run.weekStartDate,
        requestId: reqItem.requestId,
        branchId: reqItem.branchId,
        itemId: reqItem.itemId,
        itemName: reqItem.itemName,
        categoryName: reqItem.categoryName,
        requestedQty: reqItem.requestedQty,
        fulfilledQty: approved,
        reason: "INSUFFICIENT_STOCK",
        createdAt: new Date().toISOString()
      });
    }
  }
  if (unfulfilled.length) {
    await unfulfilledCol.insertMany(unfulfilled);
  }

  if (submittedReqs.length) {
    await reqCol.updateOne(
      { id: run.requestId, status: "SUBMITTED" },
      { $set: { status: "DISTRIBUTED", updatedAt: new Date().toISOString() } }
    );
  }

  await runsCol.updateOne({ id }, { $set: { status: "FINALIZED", finalizedAt: new Date().toISOString() } });
  res.json({ ok: true });
});

app.post("/api/distribution-run/finalize-multi", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { runIds } = req.body;
  if (!Array.isArray(runIds) || runIds.length === 0) {
    return res.status(400).json({ message: "runIds array is required" });
  }

  const runsCol = db.collection(COLLECTIONS.DISTRIBUTION_RUNS);
  const itemsCol = db.collection(COLLECTIONS.DISTRIBUTION_ITEMS);
  const reqCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const reqItemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);
  const logsCol = db.collection(COLLECTIONS.PURCHASE_LOGS);
  const unfulfilledCol = db.collection(COLLECTIONS.UNFULFILLED_LOGS);

  const runs = await runsCol.find({ id: { $in: runIds }, status: "DRAFT" }).toArray();
  if (!runs.length) return res.status(404).json({ message: "Runs not found" });

  const distItems = await itemsCol.find({ runId: { $in: runIds } }).toArray();
  if (!distItems.length) return res.status(400).json({ message: "No distribution items" });

  const perItemTotals = new Map();
  for (const row of distItems) {
    perItemTotals.set(row.itemId, (perItemTotals.get(row.itemId) || 0) + (row.approvedQty || 0));
  }
  const inventoryMap = await getCentralInventoryMap(Array.from(perItemTotals.keys()));
  for (const [itemId, qty] of perItemTotals.entries()) {
    const onHand = inventoryMap.get(itemId) || 0;
    if (qty > onHand) {
      return res.status(400).json({ message: "Distribution exceeds central inventory" });
    }
  }
  for (const [itemId, qty] of perItemTotals.entries()) {
    if (qty > 0) {
      await upsertCentralInventory(itemId, -Number(qty));
    }
  }

  const branchMap = new Map();
  let total = 0;
  for (const row of distItems) {
    const lineTotal = (row.approvedQty || 0) * (row.unitPrice || 0);
    total += lineTotal;
    if (!branchMap.has(row.branchId)) {
      branchMap.set(row.branchId, { branchId: row.branchId, total: 0, items: [] });
    }
    const entry = branchMap.get(row.branchId);
    entry.total += lineTotal;
    entry.items.push({
      itemId: row.itemId,
      itemName: row.itemName,
      categoryName: row.categoryName,
      requestedQty: row.requestedQty,
      approvedQty: row.approvedQty,
      unitPrice: row.unitPrice,
      totalPrice: lineTotal,
      status: row.status
    });
  }

  const weekSet = new Set(runs.map((r) => r.weekStartDate).filter(Boolean));

  await logsCol.insertOne({
    id: uuidv4(),
    distributionRunIds: runIds,
    weekStartDate: weekSet.size === 1 ? Array.from(weekSet)[0] : "MULTI",
    createdAt: new Date().toISOString(),
    total,
    branches: Array.from(branchMap.values())
  });

  const requestIds = Array.from(new Set(runs.map((r) => r.requestId).filter(Boolean)));
  const reqItems = requestIds.length ? await reqItemsCol.find({ requestId: { $in: requestIds } }).toArray() : [];
  const distMap = new Map(distItems.map((row) => [`${row.requestId}:${row.itemId}`, row]));

  const unfulfilled = [];
  for (const reqItem of reqItems) {
    const key = `${reqItem.requestId}:${reqItem.itemId}`;
    const distRow = distMap.get(key);
    const approved = distRow ? distRow.approvedQty || 0 : 0;
    if (approved < (reqItem.requestedQty || 0)) {
      unfulfilled.push({
        id: uuidv4(),
        weekStartDate: reqItem.weekStartDate,
        requestId: reqItem.requestId,
        branchId: reqItem.branchId,
        itemId: reqItem.itemId,
        itemName: reqItem.itemName,
        categoryName: reqItem.categoryName,
        requestedQty: reqItem.requestedQty,
        fulfilledQty: approved,
        reason: "INSUFFICIENT_STOCK",
        createdAt: new Date().toISOString()
      });
    }
  }
  if (unfulfilled.length) {
    await unfulfilledCol.insertMany(unfulfilled);
  }

  if (requestIds.length) {
    await reqCol.updateMany(
      { id: { $in: requestIds }, status: "SUBMITTED" },
      { $set: { status: "DISTRIBUTED", updatedAt: new Date().toISOString() } }
    );
  }

  await runsCol.updateMany({ id: { $in: runIds } }, { $set: { status: "FINALIZED", finalizedAt: new Date().toISOString() } });
  res.json({ ok: true });
});

// --- Ops / Purchase Run ---
app.get("/api/purchase-run", authMiddleware, async (req, res) => {
  if (req.user.role !== "OPS" && req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Ops/Admin role required" });
  }
  const week = req.query.week || startOfWeek();
  const branchId = req.query.branchId;
  const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);

  const reqFilter = {
    weekStartDate: week,
    status: { $ne: "PURCHASED" },
    ...(branchId ? { branchId } : {})
  };
  const relevantReqs = await requestsCol.find(reqFilter).toArray();
  const reqIds = relevantReqs.map((r) => r.id);
  const rows = reqIds.length ? await itemsCol.find({ requestId: { $in: reqIds } }).toArray() : [];
  const requestIds = Array.from(new Set(rows.map((r) => r.requestId)));
  res.json({ weekStartDate: week, rows, requestIds });
});

app.post("/api/purchase-run/:id/update-items", authMiddleware, async (req, res) => {
  if (req.user.role !== "OPS" && req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Ops/Admin role required" });
  }
  const { id } = req.params; // requestId
  const { items: bodyItems } = req.body; // [{ id, approvedQty, unitPrice, status }]
  const itemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);
  for (const bi of bodyItems || []) {
    const update = {};
    if (typeof bi.approvedQty === "number") update.approvedQty = bi.approvedQty;
    if (typeof bi.unitPrice === "number") update.unitPrice = bi.unitPrice;
    if (bi.status === "AVAILABLE" || bi.status === "UNAVAILABLE") update.status = bi.status;
    if (Object.keys(update).length) {
      if (update.approvedQty !== undefined && update.unitPrice !== undefined) {
        update.totalPrice = update.approvedQty * update.unitPrice;
      } else {
        const existing = await itemsCol.findOne({ id: bi.id, requestId: id });
        if (existing) {
          const qty = update.approvedQty !== undefined ? update.approvedQty : existing.approvedQty;
          const price = update.unitPrice !== undefined ? update.unitPrice : existing.unitPrice;
          update.totalPrice = qty * price;
        }
      }
      await itemsCol.updateOne({ id: bi.id, requestId: id }, { $set: update });
    }
  }
  const itemsForReq = await itemsCol.find({ requestId: id }).toArray();
  res.json(itemsForReq);
});

app.post("/api/purchase-run/:id/finalize", authMiddleware, async (req, res) => {
  if (req.user.role !== "OPS" && req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Ops/Admin role required" });
  }
  const { id } = req.params;
  const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);
  const logsCol = db.collection(COLLECTIONS.PURCHASE_LOGS);

  const reqObj = await requestsCol.findOne({ id });
  if (!reqObj) return res.status(404).json({ message: "Request not found" });
  if (reqObj.status === "PURCHASED") {
    return res.status(400).json({ message: "Request already finalized" });
  }
  const itemsForReq = await itemsCol.find({ requestId: id }).toArray();
  if (!itemsForReq.length) {
    return res.status(400).json({ message: "Cannot finalize empty purchase list" });
  }
  const branchMap = new Map();
  let total = 0;
  for (const row of itemsForReq) {
    total += row.totalPrice || 0;
    if (!branchMap.has(row.branchId)) {
      branchMap.set(row.branchId, { branchId: row.branchId, total: 0, items: [] });
    }
    const branchEntry = branchMap.get(row.branchId);
    branchEntry.total += row.totalPrice || 0;
    branchEntry.items.push({
      itemId: row.itemId,
      itemName: row.itemName,
      categoryName: row.categoryName,
      requestedQty: row.requestedQty,
      approvedQty: row.approvedQty,
      unitPrice: row.unitPrice,
      totalPrice: row.totalPrice
    });
  }
  await logsCol.insertOne({
    id: uuidv4(),
    requestId: id,
    weekStartDate: reqObj.weekStartDate,
    createdAt: new Date().toISOString(),
    total,
    branches: Array.from(branchMap.values())
  });
  await requestsCol.updateOne({ id }, { $set: { status: "PURCHASED", updatedAt: new Date().toISOString() } });
  const updated = await requestsCol.findOne({ id });
  res.json({ request: updated });
});

app.post("/api/purchase-run/finalize-multi", authMiddleware, async (req, res) => {
  if (req.user.role !== "OPS" && req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Ops/Admin role required" });
  }
  const { requestIds } = req.body;
  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    return res.status(400).json({ message: "requestIds array is required" });
  }

  const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);
  const logsCol = db.collection(COLLECTIONS.PURCHASE_LOGS);

  const reqObjs = await requestsCol.find({ id: { $in: requestIds } }).toArray();
  if (!reqObjs.length) return res.status(404).json({ message: "Requests not found" });
  const weekSet = new Set(reqObjs.map((r) => r.weekStartDate));
  if (weekSet.size > 1) {
    return res.status(400).json({ message: "All requests must belong to the same week" });
  }
  if (reqObjs.some((r) => r.status === "PURCHASED")) {
    return res.status(400).json({ message: "Some requests are already finalized" });
  }

  const itemsForReqs = await itemsCol.find({ requestId: { $in: requestIds } }).toArray();
  if (!itemsForReqs.length) {
    return res.status(400).json({ message: "Cannot finalize empty purchase list" });
  }

  const branchMap = new Map();
  let total = 0;
  for (const row of itemsForReqs) {
    total += row.totalPrice || 0;
    if (!branchMap.has(row.branchId)) {
      branchMap.set(row.branchId, { branchId: row.branchId, total: 0, items: [] });
    }
    const branchEntry = branchMap.get(row.branchId);
    branchEntry.total += row.totalPrice || 0;
    branchEntry.items.push({
      itemId: row.itemId,
      itemName: row.itemName,
      categoryName: row.categoryName,
      requestedQty: row.requestedQty,
      approvedQty: row.approvedQty,
      unitPrice: row.unitPrice,
      totalPrice: row.totalPrice
    });
  }

  const weekStartDate = reqObjs[0].weekStartDate;
  await logsCol.insertOne({
    id: uuidv4(),
    requestIds,
    weekStartDate,
    createdAt: new Date().toISOString(),
    total,
    branches: Array.from(branchMap.values())
  });

  await requestsCol.updateMany(
    { id: { $in: requestIds } },
    { $set: { status: "PURCHASED", updatedAt: new Date().toISOString() } }
  );

  res.json({ ok: true, weekStartDate, total, requestIds });
});

// --- Reports ---
app.get("/api/reports/branch-trend", authMiddleware, async (req, res) => {
  if (req.user.role !== "ADMIN" && req.user.role !== "OPS") {
    return res.status(403).json({ message: "Ops/Admin required" });
  }
  const { branchId } = req.query;
  const requestsCol = db.collection(COLLECTIONS.WEEKLY_REQUESTS);
  const itemsCol = db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS);

  const relevantReqs = await requestsCol.find(branchId ? { branchId } : {}).toArray();
  const reqIds = relevantReqs.map((r) => r.id);
  const items = reqIds.length ? await itemsCol.find({ requestId: { $in: reqIds } }).toArray() : [];
  const totalMap = new Map();
  for (const it of items) {
    totalMap.set(it.requestId, (totalMap.get(it.requestId) || 0) + (it.totalPrice || 0));
  }
  const result = relevantReqs.map((r) => ({
    weekStartDate: r.weekStartDate,
    branchId: r.branchId,
    total: totalMap.get(r.id) || 0
  }));
  res.json(result);
});

app.get("/api/reports/purchase-logs", authMiddleware, async (req, res) => {
  if (req.user.role !== "ADMIN" && req.user.role !== "OPS") {
    return res.status(403).json({ message: "Ops/Admin required" });
  }
  const startDate = parseStartDate(req.query.startDate);
  const filter = startDate ? { createdAt: { $gte: startDate } } : {};
  const list = await db
    .collection(COLLECTIONS.PURCHASE_LOGS)
    .find(filter)
    .sort({ createdAt: -1 })
    .toArray();
  res.json(list);
});

app.post("/api/admin/settings/weekly-override", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const value = !!req.body?.weeklyOverride;
  const settingsCol = db.collection(COLLECTIONS.SETTINGS);
  await settingsCol.updateOne(
    { key: "weeklyOverride" },
    { $set: { key: "weeklyOverride", value, updatedAt: new Date().toISOString(), updatedBy: req.user.id } },
    { upsert: true }
  );
  res.json({ weeklyOverride: value });
});

// --- Admin Master Data CRUD ---
app.get("/api/admin/categories", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const list = await db.collection(COLLECTIONS.CATEGORIES).find({}).sort({ name: 1 }).toArray();
  res.json(list);
});

app.post("/api/admin/categories", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ message: "Name is required" });
  const doc = { id: uuidv4(), name };
  await db.collection(COLLECTIONS.CATEGORIES).insertOne(doc);
  res.status(201).json(doc);
});

app.put("/api/admin/categories/:id", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ message: "Name is required" });
  const result = await db.collection(COLLECTIONS.CATEGORIES).findOneAndUpdate(
    { id },
    { $set: { name } },
    { returnDocument: "after" }
  );
  if (!result.value) return res.status(404).json({ message: "Not found" });
  res.json(result.value);
});

app.delete("/api/admin/categories/:id", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const itemCount = await db.collection(COLLECTIONS.ITEMS).countDocuments({ categoryId: id });
  if (itemCount > 0) {
    return res.status(400).json({ message: "Cannot delete category that has items" });
  }
  await db.collection(COLLECTIONS.CATEGORIES).deleteOne({ id });
  res.json({ ok: true });
});

app.get("/api/admin/items", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const list = await db.collection(COLLECTIONS.ITEMS).find({}).sort({ name: 1 }).toArray();
  res.json(list);
});

app.post("/api/admin/items", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { name, categoryId, unit, defaultPrice } = req.body;
  if (!name || !categoryId) return res.status(400).json({ message: "Name and categoryId are required" });
  const cat = await db.collection(COLLECTIONS.CATEGORIES).findOne({ id: categoryId });
  if (!cat) return res.status(400).json({ message: "Invalid categoryId" });
  const doc = {
    id: uuidv4(),
    name,
    categoryId,
    unit: unit || "",
    defaultPrice: Number(defaultPrice) || 0
  };
  await db.collection(COLLECTIONS.ITEMS).insertOne(doc);
  res.status(201).json(doc);
});

app.put("/api/admin/items/:id", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const { name, categoryId, unit, defaultPrice } = req.body;
  if (!name || !categoryId) return res.status(400).json({ message: "Name and categoryId are required" });
  const cat = await db.collection(COLLECTIONS.CATEGORIES).findOne({ id: categoryId });
  if (!cat) return res.status(400).json({ message: "Invalid categoryId" });
  const result = await db.collection(COLLECTIONS.ITEMS).findOneAndUpdate(
    { id },
    { $set: { name, categoryId, unit: unit || "", defaultPrice: Number(defaultPrice) || 0 } },
    { returnDocument: "after" }
  );
  if (!result.value) return res.status(404).json({ message: "Not found" });
  res.json(result.value);
});

app.delete("/api/admin/items/:id", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const usageCount = await db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS).countDocuments({ itemId: id });
  if (usageCount > 0) {
    return res.status(400).json({ message: "Cannot delete item used in requests" });
  }
  await db.collection(COLLECTIONS.ITEMS).deleteOne({ id });
  res.json({ ok: true });
});

app.get("/api/admin/branches", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const list = await db.collection(COLLECTIONS.BRANCHES).find({}).sort({ name: 1 }).toArray();
  res.json(list);
});

app.post("/api/admin/branches", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { name, code } = req.body;
  if (!name || !code) return res.status(400).json({ message: "Name and code are required" });
  const doc = { id: uuidv4(), name, code };
  await db.collection(COLLECTIONS.BRANCHES).insertOne(doc);
  res.status(201).json(doc);
});

app.put("/api/admin/branches/:id", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const { name, code } = req.body;
  if (!name || !code) return res.status(400).json({ message: "Name and code are required" });
  const result = await db.collection(COLLECTIONS.BRANCHES).findOneAndUpdate(
    { id },
    { $set: { name, code } },
    { returnDocument: "after" }
  );
  if (!result.value) return res.status(404).json({ message: "Not found" });
  res.json(result.value);
});

app.delete("/api/admin/branches/:id", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const userCount = await db.collection(COLLECTIONS.USERS).countDocuments({ branchId: id });
  const requestCount = await db.collection(COLLECTIONS.WEEKLY_REQUESTS).countDocuments({ branchId: id });
  if (userCount > 0 || requestCount > 0) {
    return res.status(400).json({ message: "Cannot delete branch that is in use" });
  }
  await db.collection(COLLECTIONS.BRANCHES).deleteOne({ id });
  res.json({ ok: true });
});

app.get("/api/admin/users", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const list = await db.collection(COLLECTIONS.USERS).find({}).sort({ name: 1 }).toArray();
  res.json(list.map(({ password, ...rest }) => rest));
});

app.post("/api/admin/users", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { name, email, password, role, branchId } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ message: "Missing required fields" });
  const existing = await db.collection(COLLECTIONS.USERS).findOne({ email });
  if (existing) return res.status(400).json({ message: "Email already exists" });
  const doc = { id: uuidv4(), name, email, password, role, branchId: branchId || null };
  await db.collection(COLLECTIONS.USERS).insertOne(doc);
  res.status(201).json({ id: doc.id, name, email, role, branchId: doc.branchId });
});

app.put("/api/admin/users/:id", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  const { name, email, password, role, branchId } = req.body;
  if (!name || !email || !role) return res.status(400).json({ message: "Missing required fields" });
  const update = { name, email, role, branchId: branchId || null };
  if (password) update.password = password;
  const existingEmail = await db.collection(COLLECTIONS.USERS).findOne({ email, id: { $ne: id } });
  if (existingEmail) return res.status(400).json({ message: "Email already exists" });
  const result = await db.collection(COLLECTIONS.USERS).findOneAndUpdate({ id }, { $set: update }, { returnDocument: "after" });
  if (!result.value) return res.status(404).json({ message: "Not found" });
  const { password: _, ...rest } = result.value;
  res.json(rest);
});

app.delete("/api/admin/users/:id", authMiddleware, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { id } = req.params;
  await db.collection(COLLECTIONS.USERS).deleteOne({ id });
  res.json({ ok: true });
});

app.get("/", (req, res) => {
  res.send("Foffee Inventory backend is running.");
});

async function start() {
  try {
    await connectToDatabase();
    db = getDb();
    await ensureIndexes();
    app.listen(PORT, () => {
      console.log(`Backend listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server", err);
    process.exit(1);
  }
}

start();
