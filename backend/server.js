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
  PURCHASE_LOGS: "purchaseLogs"
};

// --- Helpers ---
function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun..6 Sat
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday as first day
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
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

async function ensureIndexes() {
  await db.collection(COLLECTIONS.USERS).createIndex({ email: 1 }, { unique: true });
  await db.collection(COLLECTIONS.ITEMS).createIndex({ categoryId: 1 });
  await db.collection(COLLECTIONS.WEEKLY_REQUESTS).createIndex({ branchId: 1, weekStartDate: 1, status: 1 });
  await db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS).createIndex({ requestId: 1 });
  await db.collection(COLLECTIONS.PURCHASE_LOGS).createIndex({ createdAt: -1 });
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
    .find({ branchId })
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
  res.json({ weekStartDate: week, rows });
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
