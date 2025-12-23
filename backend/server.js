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
app.use(bodyParser.json());

let db;

const COLLECTIONS = {
  USERS: "users",
  BRANCHES: "branches",
  CATEGORIES: "categories",
  ITEMS: "items",
  WEEKLY_REQUESTS: "weeklyRequests",
  WEEKLY_REQUEST_ITEMS: "weeklyRequestItems",
  PURCHASE_LOGS: "purchaseLogs",
  CENTRAL_INVENTORY: "centralInventoryItems",
  COMBINED_PURCHASE_RUNS: "combinedPurchaseRuns",
  COMBINED_PURCHASE_ITEMS: "combinedPurchaseItems",
  DISTRIBUTION_RUNS: "distributionRuns",
  DISTRIBUTION_ITEMS: "distributionItems",
  UNFULFILLED_LOGS: "unfulfilledLogs",
  COMBINED_PURCHASE_LOGS: "combinedPurchaseLogs"
};

// --- Helpers ---
function formatDateLocal(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfWeek(date = new Date()) {
  // Use today's date as the displayed "week start" to keep UI current daily.
  const today = new Date(date);
  today.setHours(0, 0, 0, 0);
  return formatDateLocal(today);
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

  const req = await requestsCol.findOne({ id: requestId });
  if (!req || req.status !== "SUBMITTED") return null;

  let run = await runsCol.findOne({ requestId });
  if (run && run.status !== "DRAFT") return run;
  if (!run) {
    run = {
      id: uuidv4(),
      requestId,
      branchId: req.branchId,
      weekStartDate: req.weekStartDate,
      status: "DRAFT",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await runsCol.insertOne(run);
  }

  const reqItems = await reqItemsCol.find({ requestId }).toArray();
  if (!reqItems.length) {
    await itemsCol.deleteMany({ runId: run.id, manual: { $ne: true } });
    await runsCol.updateOne({ id: run.id }, { $set: { updatedAt: new Date().toISOString() } });
    return run;
  }

  const itemIds = reqItems.map((r) => r.itemId);
  const inventoryMap = await getCentralInventoryMap(itemIds);
  const masterItems = await masterItemsCol.find({ id: { $in: itemIds } }).toArray();
  const categories = await categoriesCol.find({}).toArray();
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  const autoItems = [];
  const distItems = [];
  for (const row of reqItems) {
    const onHand = inventoryMap.get(row.itemId) || 0;
    const shortfall = Math.max(0, (row.requestedQty || 0) - onHand);
    if (!shortfall) continue;
    const item = masterItems.find((it) => it.id === row.itemId);
    if (!item) continue;
    autoItems.push({
      id: uuidv4(),
      runId: run.id,
      itemId: row.itemId,
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
    const existingDist = await distRunsCol.findOne({ requestId });
    if (!existingDist) {
      const distRun = {
        id: uuidv4(),
        requestId,
        branchId: req.branchId,
        weekStartDate: req.weekStartDate,
        combinedRunId: run.id,
        status: "DRAFT",
        createdAt: new Date().toISOString()
      };
      await distRunsCol.insertOne(distRun);

      for (const row of reqItems) {
        const remaining = inventoryMap.get(row.itemId) || 0;
        const approvedQty = Math.min(row.requestedQty || 0, remaining);
        distItems.push({
          id: uuidv4(),
          runId: distRun.id,
          requestId,
          branchId: req.branchId,
          itemId: row.itemId,
          itemName: row.itemName,
          categoryName: row.categoryName,
          requestedQty: row.requestedQty,
          approvedQty,
          unitPrice: row.unitPrice || 0,
          status: approvedQty > 0 ? "AVAILABLE" : "UNAVAILABLE"
        });
      }

      if (distItems.length) {
        await distItemsCol.insertMany(distItems);
      }
    }
  }
  return run;
}

async function ensureIndexes() {
  await db.collection(COLLECTIONS.USERS).createIndex({ email: 1 }, { unique: true });
  await db.collection(COLLECTIONS.ITEMS).createIndex({ categoryId: 1 });
  await db.collection(COLLECTIONS.WEEKLY_REQUESTS).createIndex({ branchId: 1, weekStartDate: 1, status: 1 });
  await db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS).createIndex({ requestId: 1 });
  await db.collection(COLLECTIONS.PURCHASE_LOGS).createIndex({ createdAt: -1 });
  try {
    await db.collection(COLLECTIONS.DISTRIBUTION_RUNS).dropIndex("weekStartDate_1");
  } catch (err) {
    if (err?.codeName !== "IndexNotFound") throw err;
  }
  try {
    await db.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS).dropIndex("weekStartDate_1");
  } catch (err) {
    if (err?.codeName !== "IndexNotFound") throw err;
  }
  await db.collection(COLLECTIONS.CENTRAL_INVENTORY).createIndex({ itemId: 1 }, { unique: true });
  await db.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS).createIndex({ requestId: 1 }, { unique: true });
  await db.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS).createIndex({ runId: 1 });
  await db.collection(COLLECTIONS.DISTRIBUTION_RUNS).createIndex({ requestId: 1 }, { unique: true });
  await db.collection(COLLECTIONS.DISTRIBUTION_ITEMS).createIndex({ runId: 1 });
  await db.collection(COLLECTIONS.UNFULFILLED_LOGS).createIndex({ weekStartDate: 1 });
  await db.collection(COLLECTIONS.COMBINED_PURCHASE_LOGS).createIndex({ createdAt: -1 });
}

// --- Auth ---
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await db.collection(COLLECTIONS.USERS).findOne({ email, password });
  if (!user) return res.status(401).json({ message: "Invalid credentials" });
  const token = jwt.sign(
    { id: user.id, role: user.role, branchId: user.branchId, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
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
  res.json({ request: reqObj, items });
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
  const runs = await db
    .collection(COLLECTIONS.COMBINED_PURCHASE_RUNS)
    .find({ status: "DRAFT" })
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

  const draftRuns = await runsCol.find({ status: "DRAFT" }).sort({ createdAt: 1 }).toArray();
  const runIds = draftRuns.map((r) => r.id);
  const weekSet = new Set(draftRuns.map((r) => r.weekStartDate).filter(Boolean));
  const weekStartDate = runIds.length ? (weekSet.size === 1 ? Array.from(weekSet)[0] : "MULTI") : startOfWeek();

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
  const logs = await db
    .collection(COLLECTIONS.COMBINED_PURCHASE_LOGS)
    .find({})
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
        if (purchaseItem && purchaseItem.status === "UNAVAILABLE" && remaining <= 0) {
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
      totalPrice: lineTotal
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
      totalPrice: lineTotal
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
  const list = await db
    .collection(COLLECTIONS.PURCHASE_LOGS)
    .find({})
    .sort({ createdAt: -1 })
    .toArray();
  res.json(list);
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
