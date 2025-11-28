import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { branches, users, categories, items, weeklyRequests, weeklyRequestItems, purchaseLogs } from "./data.js";

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "foffee_inventory_secret";

app.use(cors());
app.use(bodyParser.json());

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

// --- Auth ---
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password);
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
app.get("/api/me", authMiddleware, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  res.json({ id: user.id, name: user.name, role: user.role, branchId: user.branchId });
});

app.get("/api/branches", authMiddleware, (req, res) => {
  res.json(branches);
});

app.get("/api/categories", authMiddleware, (req, res) => {
  res.json(categories);
});

app.get("/api/items", authMiddleware, (req, res) => {
  const { categoryId } = req.query;
  let filtered = items;
  if (categoryId) filtered = items.filter(i => i.categoryId === categoryId);
  res.json(filtered);
});

// --- Branch Requests ---

app.get("/api/requests/current", authMiddleware, (req, res) => {
  if (req.user.role !== "BRANCH") {
    return res.status(403).json({ message: "Branch role required" });
  }
  const branchId = req.user.branchId;
  const weekStartDate = startOfWeek();
  let reqObj = weeklyRequests.find(r => r.branchId === branchId && r.weekStartDate === weekStartDate && r.status === "DRAFT");
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
    weeklyRequests.push(reqObj);
  }
  const itemsForReq = weeklyRequestItems.filter(ri => ri.requestId === reqObj.id);
  res.json({ request: reqObj, items: itemsForReq });
});

app.post("/api/requests/:id/items", authMiddleware, (req, res) => {
  const { id } = req.params;
  const { items: bodyItems } = req.body; // [{ itemId, requestedQty }]
  const reqObj = weeklyRequests.find(r => r.id === id);
  if (!reqObj) return res.status(404).json({ message: "Request not found" });
  if (req.user.role !== "BRANCH" || req.user.branchId !== reqObj.branchId) {
    return res.status(403).json({ message: "Not allowed" });
  }
  if (reqObj.status !== "DRAFT") {
    return res.status(400).json({ message: "Cannot edit non-draft request" });
  }
  // Clear old items
  for (let i = weeklyRequestItems.length - 1; i >= 0; i--) {
    if (weeklyRequestItems[i].requestId === id) weeklyRequestItems.splice(i, 1);
  }
  // Insert new
  for (const bi of bodyItems) {
    if (bi.requestedQty <= 0) continue;
    const item = items.find(it => it.id === bi.itemId);
    if (!item) continue;
    const cat = categories.find(c => c.id === item.categoryId);
    const unitPrice = item.defaultPrice;
    weeklyRequestItems.push({
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
  reqObj.updatedAt = new Date().toISOString();
  const itemsForReq = weeklyRequestItems.filter(ri => ri.requestId === id);
  res.json({ request: reqObj, items: itemsForReq });
});

app.post("/api/requests/:id/submit", authMiddleware, (req, res) => {
  const { id } = req.params;
  const reqObj = weeklyRequests.find(r => r.id === id);
  if (!reqObj) return res.status(404).json({ message: "Request not found" });
  if (req.user.role !== "BRANCH" || req.user.branchId !== reqObj.branchId) {
    return res.status(403).json({ message: "Not allowed" });
  }
  if (reqObj.status !== "DRAFT") {
    return res.status(400).json({ message: "Only draft can be submitted" });
  }
  const itemsForReq = weeklyRequestItems.filter(ri => ri.requestId === id);
  if (!itemsForReq.length) {
    return res.status(400).json({ message: "Cannot submit an empty request" });
  }
  reqObj.status = "SUBMITTED";
  reqObj.updatedAt = new Date().toISOString();
  res.json({ request: reqObj });
});

app.get("/api/requests/history", authMiddleware, (req, res) => {
  if (req.user.role !== "BRANCH") {
    return res.status(403).json({ message: "Branch role required" });
  }
  const branchId = req.user.branchId;
  const list = weeklyRequests
    .filter(r => r.branchId === branchId)
    .sort((a, b) => new Date(b.createdAt || b.updatedAt) - new Date(a.createdAt || a.updatedAt))
    .map(r => {
      const itemsForReq = weeklyRequestItems.filter(ri => ri.requestId === r.id);
      const total = itemsForReq.reduce((sum, it) => sum + it.totalPrice, 0);
      return {
        id: r.id,
        weekStartDate: r.weekStartDate,
        status: r.status,
        total
      };
    });
  res.json(list);
});

// --- Ops / Purchase Run ---

app.get("/api/purchase-run", authMiddleware, (req, res) => {
  if (req.user.role !== "OPS" && req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Ops/Admin role required" });
  }
  const week = req.query.week || startOfWeek();
  const branchId = req.query.branchId;
  const relevantReqs = weeklyRequests.filter(
    r => r.weekStartDate === week && (!branchId || r.branchId === branchId) && r.status !== "PURCHASED"
  );
  const reqIds = relevantReqs.map(r => r.id);
  const rows = weeklyRequestItems.filter(ri => reqIds.includes(ri.requestId));
  res.json({ weekStartDate: week, rows });
});

app.post("/api/purchase-run/:id/update-items", authMiddleware, (req, res) => {
  if (req.user.role !== "OPS" && req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Ops/Admin role required" });
  }
  const { id } = req.params; // requestId
  const { items: bodyItems } = req.body; // [{ id, approvedQty, unitPrice, status }]
  for (const bi of bodyItems) {
    const row = weeklyRequestItems.find(ri => ri.id === bi.id && ri.requestId === id);
    if (!row) continue;
    if (typeof bi.approvedQty === "number") row.approvedQty = bi.approvedQty;
    if (typeof bi.unitPrice === "number") row.unitPrice = bi.unitPrice;
    if (bi.status === "AVAILABLE" || bi.status === "UNAVAILABLE") row.status = bi.status;
    row.totalPrice = row.unitPrice * row.approvedQty;
  }
  const itemsForReq = weeklyRequestItems.filter(ri => ri.requestId === id);
  res.json(itemsForReq);
});

app.post("/api/purchase-run/:id/finalize", authMiddleware, (req, res) => {
  if (req.user.role !== "OPS" && req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Ops/Admin role required" });
  }
  const { id } = req.params;
  const reqObj = weeklyRequests.find(r => r.id === id);
  if (!reqObj) return res.status(404).json({ message: "Request not found" });
  if (reqObj.status === "PURCHASED") {
    return res.status(400).json({ message: "Request already finalized" });
  }
  const itemsForReq = weeklyRequestItems.filter(ri => ri.requestId === id);
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
  purchaseLogs.push({
    id: uuidv4(),
    requestId: id,
    weekStartDate: reqObj.weekStartDate,
    createdAt: new Date().toISOString(),
    total,
    branches: Array.from(branchMap.values())
  });
  reqObj.status = "PURCHASED";
  reqObj.updatedAt = new Date().toISOString();
  res.json({ request: reqObj });
});

// --- Reports ---

app.get("/api/reports/branch-trend", authMiddleware, (req, res) => {
  if (req.user.role !== "ADMIN" && req.user.role !== "OPS") {
    return res.status(403).json({ message: "Ops/Admin required" });
  }
  const { branchId } = req.query;
  const relevantReqs = weeklyRequests.filter(r => !branchId || r.branchId === branchId);
  const result = [];
  for (const r of relevantReqs) {
    const itemsForReq = weeklyRequestItems.filter(ri => ri.requestId === r.id);
    const total = itemsForReq.reduce((sum, it) => sum + it.totalPrice, 0);
    result.push({
      weekStartDate: r.weekStartDate,
      branchId: r.branchId,
      total
    });
  }
  res.json(result);
});

app.get("/api/reports/purchase-logs", authMiddleware, (req, res) => {
  if (req.user.role !== "ADMIN" && req.user.role !== "OPS") {
    return res.status(403).json({ message: "Ops/Admin required" });
  }
  const list = purchaseLogs
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

app.get("/", (req, res) => {
  res.send("Foffee Inventory backend is running.");
});

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
