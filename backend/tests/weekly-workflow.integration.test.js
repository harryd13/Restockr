import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { COLLECTIONS } from "../config.js";
import { ensureIndexes } from "../database/indexes.js";
import { createInventoryWorkflowService } from "../services/inventory-workflow.service.js";
import { createCombinedPurchasesRepository } from "../repositories/combined-purchases.repository.js";
import { createCombinedPurchasesService } from "../services/combined-purchases.service.js";
import { createDistributionRepository } from "../repositories/distribution.repository.js";
import { createDistributionService } from "../services/distribution.service.js";
import { createExpenseTicketsRepository } from "../repositories/expense-tickets.repository.js";
import { createExpenseTicketsService } from "../services/expense-tickets.service.js";
import { upsertWeeklyCentralPurchaseLog } from "../services/weekly-summary.service.js";
import { createReportsRepository } from "../repositories/reports.repository.js";
import { registerReportRoutesController } from "../controllers/reports.controller.js";
import { ensureAdmin } from "../middleware/auth.js";
import { formatDateLocal, getCurrentDateInIST, parseStartDate, startOfWeek } from "../utils/dates.js";

const uri = String(process.env.TEST_MONGODB_URI || "").trim();
const databaseName = String(process.env.TEST_DATABASE_NAME || "foffee_workflow_test").trim();
const enabled = !!uri;
const integration = (name, fn) => test(name, { skip: enabled ? false : "Set TEST_MONGODB_URI to run MongoDB integration tests" }, fn);

if (enabled && !/test/i.test(databaseName)) {
  throw new Error("TEST_DATABASE_NAME must contain 'test'; refusing to run destructive integration tests");
}

let client;
let db;
let workflow;
let combinedService;
let distributionService;
let expenseTicketService;
let weeklyAuditHandler;

const now = () => new Date().toISOString();
const admin = (id = "admin-1") => ({ id, role: "ADMIN" });
const branch = (branchId = "B1", id = `user-${branchId}`) => ({ id, role: "BRANCH", branchId });
const database = () => ({ collection: (name) => db.collection(name) });

function mockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; }
  };
}

test("weekly central purchase summary retains multiple requests from the same branch", async () => {
  let stored = null;
  const collection = {
    async findOne() { return stored; },
    async updateOne(_filter, update) { stored = update.$set; return { modifiedCount: 1 }; }
  };
  const base = { branchId: "B1", orderedQty: 1, purchasedQty: 1, purchaseAmount: 100, paidAmount: 100, pendingAmount: 0, cashPaid: 0, upiPaid: 100, distributionStatus: "AWAITING_RECEIPT", items: [] };
  await upsertWeeklyCentralPurchaseLog(collection, "2026-10-08", { ...base, requestId: "request-1", distributionRunId: "run-1" });
  await upsertWeeklyCentralPurchaseLog(collection, "2026-10-08", { ...base, requestId: "request-2", distributionRunId: "run-2", purchaseAmount: 200, paidAmount: 200 });
  await upsertWeeklyCentralPurchaseLog(collection, "2026-10-08", { ...base, requestId: "request-2", distributionRunId: "run-2", purchaseAmount: 250, paidAmount: 250 });
  assert.equal(stored.branchCount, 1);
  assert.equal(stored.requestCount, 2);
  assert.deepEqual(stored.branches.map((entry) => entry.requestId), ["request-1", "request-2"]);
  assert.equal(stored.totals.purchaseAmount, 350);
});

async function invoke(handler, { user = admin(), params = {}, query = {}, body = {} } = {}) {
  const res = mockResponse();
  await handler({ user, params, query, body }, res);
  return res;
}

before(async () => {
  if (!enabled) return;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(databaseName);
  await ensureIndexes(db, COLLECTIONS);
  workflow = createInventoryWorkflowService({
    getDb: () => db,
    getClient: () => client,
    COLLECTIONS,
    uuidv4: randomUUID,
    startOfWeek
  });
  combinedService = createCombinedPurchasesService({
    repository: createCombinedPurchasesRepository(database()),
    uuidv4: randomUUID,
    ensureAdmin,
    formatDateLocal,
    getCurrentDateInIST,
    parseStartDate,
    startOfWeek,
    getClient: () => client,
    getCentralInventoryMap: workflow.getCentralInventoryMap,
    upsertCentralInventory: workflow.upsertCentralInventory,
    reserveInventory: workflow.reserveInventory,
    releaseInventory: workflow.releaseInventory
  });
  distributionService = createDistributionService(createDistributionRepository(database()), {
    uuidv4: randomUUID,
    getClient: () => client,
    getCurrentDateInIST
  });
  expenseTicketService = createExpenseTicketsService({
    repository: createExpenseTicketsRepository(database()),
    uuidv4: randomUUID,
    ensureAdmin,
    formatDateLocal,
    sendSlackWebhook: async () => {}
  });
  const reportRoutes = new Map();
  registerReportRoutesController({
    get(path, ...handlers) { reportRoutes.set(path, handlers.at(-1)); }
  }, {
    repository: createReportsRepository(() => db),
    authMiddleware: (_req, _res, next) => next()
  });
  weeklyAuditHandler = reportRoutes.get("/api/reports/weekly-order-audit");
});

afterEach(async () => {
  if (!enabled) return;
  await Promise.all(Object.values(COLLECTIONS).map((name) => db.collection(name).deleteMany({})));
});

after(async () => {
  if (client) await client.close();
});

async function seedDraftRequest({ id, branchId, itemId = "milk", qty = 5 }) {
  await db.collection(COLLECTIONS.WEEKLY_REQUESTS).insertOne({ id, branchId, weekStartDate: "2026-10-08", status: "DRAFT", createdAt: now() });
  await db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS).insertOne({ id: `${id}-item`, requestId: id, itemId, itemName: "Milk", categoryName: "Dairy", requestedQty: qty, unitPrice: 10 });
}

async function seedPurchase({ runId = "purchase-1", requestId = "request-1", branchId = "B1", version = 0, items = [{ itemId: "milk", requestedQty: 10, centralReservedQty: 4, orderQty: 6, price: 10 }] } = {}) {
  await db.collection(COLLECTIONS.WEEKLY_REQUESTS).insertOne({ id: requestId, branchId, weekStartDate: "2026-10-08", status: "SUBMITTED", submittedAt: now() });
  await db.collection(COLLECTIONS.COMBINED_PURCHASE_RUNS).insertOne({ id: runId, requestId, branchId, weekStartDate: "2026-10-08", status: "DRAFT", version, createdAt: now() });
  for (const row of items) {
    await db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS).insertOne({ id: `${requestId}-${row.itemId}`, requestId, itemId: row.itemId, itemName: row.itemId, categoryName: "Test", requestedQty: row.requestedQty, centralReservedQty: row.centralReservedQty, purchaseRequiredQty: row.requestedQty - row.centralReservedQty, unitPrice: row.price });
    await db.collection(COLLECTIONS.COMBINED_PURCHASE_ITEMS).insertOne({ id: `${runId}-${row.itemId}`, runId, itemId: row.itemId, itemName: row.itemId, categoryName: "Test", requestedQty: row.requestedQty, centralReservedQty: row.centralReservedQty, orderQty: row.orderQty, approvedQty: row.orderQty, estimatedUnitPrice: row.price, unitPrice: row.price, includeInPdf: true });
    await db.collection(COLLECTIONS.CENTRAL_INVENTORY).updateOne({ itemId: row.itemId }, { $set: { itemId: row.itemId, onHand: 20, reserved: row.centralReservedQty } }, { upsert: true });
  }
  return { runId, requestId, branchId, version, items };
}

function purchasePayload(seed, overrides = {}) {
  return {
    version: seed.version,
    items: seed.items.map((row) => ({ itemId: row.itemId, centralReservedQty: row.centralReservedQty, orderQty: row.orderQty, estimatedUnitPrice: row.price, includeInPdf: true, ...overrides }))
  };
}

async function orderPurchase(seed, key = `order:${seed.runId}`) {
  return invoke(combinedService.orderBranchPurchase, { params: { runId: seed.runId }, body: { version: seed.version, idempotencyKey: key } });
}

async function seedDistribution({ runId = "dist-1", requestId = "request-1", branchId = "B1", status = "RECEIVED_PENDING_REVIEW", version = 1, onHand = 10, reserved = 5, items = [{ itemId: "milk", requestedQty: 5, centralReservedQty: 5, orderedQty: 0, deliveredQty: 5, commitState: "PENDING" }] } = {}) {
  await db.collection(COLLECTIONS.WEEKLY_REQUESTS).insertOne({ id: requestId, branchId, weekStartDate: "2026-10-08", status: status === "AWAITING_RECEIPT" ? "AWAITING_RECEIPT" : "RECEIVED_PENDING_REVIEW" });
  await db.collection(COLLECTIONS.DISTRIBUTION_RUNS).insertOne({ id: runId, requestId, branchId, weekStartDate: "2026-10-08", status, version, createdAt: now() });
  for (const row of items) {
    await db.collection(COLLECTIONS.CENTRAL_INVENTORY).updateOne({ itemId: row.itemId }, { $set: { itemId: row.itemId, onHand: row.onHand ?? onHand, reserved: row.reserved ?? reserved } }, { upsert: true });
    await db.collection(COLLECTIONS.DISTRIBUTION_ITEMS).insertOne({
      id: `${runId}-${row.itemId}`, runId, requestId, branchId, itemId: row.itemId, itemName: row.itemId, categoryName: "Test",
      requestedQty: row.requestedQty, centralReservedQty: row.centralReservedQty, orderedQty: row.orderedQty,
      actualPurchaseQty: row.actualPurchaseQty ?? row.orderedQty,
      expectedQty: row.requestedQty, receiptDefaultQty: row.requestedQty,
      approvedQty: row.deliveredQty, branchReportedQty: row.deliveredQty, deliveredQty: row.deliveredQty,
      estimatedUnitPrice: row.estimatedUnitPrice ?? 10, unitPrice: row.estimatedUnitPrice ?? 10,
      paymentStatus: row.paymentStatus ?? (row.orderedQty ? "NOT_RECORDED" : "NOT_APPLICABLE"),
      paymentMethod: row.paymentMethod || "",
      ...(row.expenseLogId ? { expenseLogId: row.expenseLogId } : {}),
      mismatchReason: "", reconciliationConflict: false,
      ...(row.commitState === undefined ? {} : { inventoryCommitState: row.commitState })
    });
  }
  return { runId, requestId, branchId, version, items };
}

function closePayload(seed, finalByItem = {}, reason = "Reviewed variance") {
  return {
    version: seed.version,
    items: seed.items.map((row) => ({ id: `${seed.runId}-${row.itemId}`, deliveredQty: finalByItem[row.itemId] ?? row.deliveredQty, mismatchReason: (finalByItem[row.itemId] ?? row.deliveredQty) === row.requestedQty ? "" : reason }))
  };
}

integration("two branches competing for the last central units never over-reserve", async () => {
  await db.collection(COLLECTIONS.CENTRAL_INVENTORY).insertOne({ itemId: "milk", onHand: 5, reserved: 0 });
  await seedDraftRequest({ id: "r1", branchId: "B1" });
  await seedDraftRequest({ id: "r2", branchId: "B2" });
  await Promise.all([workflow.submitWeeklyRequestWithReservations("r1"), workflow.submitWeeklyRequestWithReservations("r2")]);
  const rows = await db.collection(COLLECTIONS.WEEKLY_REQUEST_ITEMS).find({}).toArray();
  assert.equal(rows.reduce((sum, row) => sum + Number(row.centralReservedQty || 0), 0), 5);
  assert.equal((await db.collection(COLLECTIONS.CENTRAL_INVENTORY).findOne({ itemId: "milk" })).reserved, 5);
});

integration("two admins editing the same purchase: exactly one stale version is rejected", async () => {
  const seed = await seedPurchase();
  const results = await Promise.all([
    invoke(combinedService.updateBranchPurchase, { user: admin("A1"), params: { runId: seed.runId }, body: purchasePayload(seed, { orderQty: 6 }) }),
    invoke(combinedService.updateBranchPurchase, { user: admin("A2"), params: { runId: seed.runId }, body: purchasePayload(seed, { orderQty: 7 }) })
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
});

integration("Ordered double-click/retry creates one immutable order", async () => {
  const seed = await seedPurchase();
  const [first, second] = await Promise.all([orderPurchase(seed, "same-key"), orderPurchase(seed, "same-key")]);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(await db.collection(COLLECTIONS.WEEKLY_PURCHASE_ORDER_LOGS).countDocuments({ purchaseRunId: seed.runId }), 1);
  assert.equal(await db.collection(COLLECTIONS.DISTRIBUTION_RUNS).countDocuments({ requestId: seed.requestId }), 1);
});

integration("retried Paid update creates one expense record", async () => {
  const seed = await seedDistribution({ status: "AWAITING_RECEIPT", version: 0, reserved: 0, items: [{ itemId: "milk", requestedQty: 2, centralReservedQty: 0, orderedQty: 2, deliveredQty: null, commitState: undefined }] });
  const itemId = `${seed.runId}-milk`;
  const payload = { version: 0, idempotencyKey: "paid-once", items: [{ id: itemId, estimatedUnitPrice: 12, paymentStatus: "PAID", paymentMethod: "UPI" }] };
  await distributionService.updatePayments(seed.runId, admin(), payload);
  const replay = await distributionService.updatePayments(seed.runId, admin(), payload);
  assert.equal(replay.replayed, true);
  assert.equal(await db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS).countDocuments({ distributionRunId: seed.runId }), 1);
  assert.equal((await db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS).findOne({ distributionRunId: seed.runId })).amount, 24);
});

integration("several pending items create exactly one branch-order ticket", async () => {
  const seed = await seedDistribution({ status: "AWAITING_RECEIPT", version: 0, reserved: 0, items: [
    { itemId: "milk", requestedQty: 2, centralReservedQty: 0, orderedQty: 2, deliveredQty: null, commitState: undefined },
    { itemId: "beans", requestedQty: 3, centralReservedQty: 0, orderedQty: 3, deliveredQty: null, commitState: undefined }
  ] });
  await distributionService.updatePayments(seed.runId, admin(), { version: 0, idempotencyKey: "pending-many", items: seed.items.map((row) => ({ id: `${seed.runId}-${row.itemId}`, paymentStatus: "PENDING", paymentMethod: "" })) });
  const tickets = await db.collection(COLLECTIONS.EXPENSE_TICKETS).find({ distributionRunId: seed.runId }).toArray();
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].items.length, 2);
});

test("two simultaneous partial ticket settlements cannot overpay", {
  skip: enabled ? false : "Set TEST_MONGODB_URI to run MongoDB integration tests",
  todo: "Current handle4 has no transaction, version check, or idempotency key; simultaneous submissions can both use the same old balance."
}, async () => {
  await db.collection(COLLECTIONS.EXPENSE_TICKETS).insertOne({ id: "ticket-1", sourceType: "WEEKLY_PURCHASE", distributionRunId: "dist-1", category: "Purchase", branchId: "B1", assignee: "admin-1", amount: 100, date: "2026-10-13", items: [{ name: "Milk", qty: 10, unitPrice: 10 }], status: "PENDING" });
  const settle = () => invoke(expenseTicketService.handle4, { params: { id: "ticket-1" }, body: { paymentMethod: "UPI", amountPaid: 80 } });
  await Promise.all([settle(), settle()]);
  const logs = await db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS).find({ ticketId: "ticket-1" }).toArray();
  assert.ok(logs.reduce((sum, log) => sum + Number(log.amount || 0), 0) <= 100, "concurrent settlements recorded more than the ticket amount");
});

integration("branch receipt verification retry replays one receipt", async () => {
  const seed = await seedDistribution({ status: "AWAITING_RECEIPT", version: 0, onHand: 10, reserved: 2, items: [{ itemId: "milk", requestedQty: 2, centralReservedQty: 2, orderedQty: 0, deliveredQty: null, commitState: undefined }] });
  const payload = { version: 0, idempotencyKey: "receipt-once", items: [{ itemId: "milk", receivedQty: 2 }] };
  await distributionService.verifyReceipt(seed.requestId, branch(seed.branchId), payload);
  const replay = await distributionService.verifyReceipt(seed.requestId, branch(seed.branchId), payload);
  assert.equal(replay.replayed, true);
  assert.equal(await db.collection(COLLECTIONS.DISTRIBUTION_RECEIPTS).countDocuments({ runId: seed.runId }), 1);
});

integration("admin cannot change a branch quantity without a reason", async () => {
  const seed = await seedDistribution();
  await assert.rejects(() => distributionService.closeRun(seed.runId, { version: seed.version, items: [{ id: `${seed.runId}-milk`, deliveredQty: 4, mismatchReason: "" }] }, admin()), /reason is required/i);
});

integration("central inventory changed before close rejects commitment", async () => {
  const seed = await seedDistribution();
  await db.collection(COLLECTIONS.CENTRAL_INVENTORY).updateOne({ itemId: "milk" }, { $set: { reserved: 2 } });
  await assert.rejects(() => distributionService.closeRun(seed.runId, closePayload(seed), admin()), /changed|reallocate/i);
  assert.equal((await db.collection(COLLECTIONS.DISTRIBUTION_RUNS).findOne({ id: seed.runId })).status, "RECEIVED_PENDING_REVIEW");
});

integration("two admins closing the same distribution create one commitment", async () => {
  const seed = await seedDistribution();
  const results = await Promise.allSettled([
    distributionService.closeRun(seed.runId, closePayload(seed), admin("A1")),
    distributionService.closeRun(seed.runId, closePayload(seed), admin("A2"))
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
  assert.equal(await db.collection(COLLECTIONS.INVENTORY_COMMITMENT_LOGS).countDocuments({ distributionRunId: seed.runId }), 1);
});

integration("final quantity below reservation commits used stock and releases the rest", async () => {
  const seed = await seedDistribution();
  await distributionService.closeRun(seed.runId, closePayload(seed, { milk: 3 }), admin());
  const inventory = await db.collection(COLLECTIONS.CENTRAL_INVENTORY).findOne({ itemId: "milk" });
  const item = await db.collection(COLLECTIONS.DISTRIBUTION_ITEMS).findOne({ id: `${seed.runId}-milk` });
  assert.deepEqual({ onHand: inventory.onHand, reserved: inventory.reserved, committed: item.centralCommittedQty, released: item.centralReleasedQty }, { onHand: 7, reserved: 0, committed: 3, released: 2 });
});

integration("final quantity above reservation records the excess as vendor-delivered", async () => {
  const seed = await seedDistribution({ items: [{ itemId: "milk", requestedQty: 8, centralReservedQty: 5, orderedQty: 3, deliveredQty: 8, paymentStatus: "EXPENSE_RECORDED", paymentMethod: "UPI", commitState: "PENDING" }] });
  await distributionService.closeRun(seed.runId, closePayload(seed), admin());
  const item = await db.collection(COLLECTIONS.DISTRIBUTION_ITEMS).findOne({ id: `${seed.runId}-milk` });
  assert.deepEqual({ central: item.centralCommittedQty, vendor: item.purchasedDeliveredQty }, { central: 5, vendor: 3 });
});

integration("vendor quantity never reduces central inventory", async () => {
  const seed = await seedDistribution({ onHand: 10, reserved: 0, items: [{ itemId: "milk", requestedQty: 5, centralReservedQty: 0, orderedQty: 5, deliveredQty: 5, paymentStatus: "EXPENSE_RECORDED", paymentMethod: "Cash", commitState: "PENDING" }] });
  await distributionService.closeRun(seed.runId, closePayload(seed), admin());
  assert.equal((await db.collection(COLLECTIONS.CENTRAL_INVENTORY).findOne({ itemId: "milk" })).onHand, 10);
});

integration("distribution cannot close until every purchased row has a payment method", async () => {
  const seed = await seedDistribution({ items: [{ itemId: "milk", requestedQty: 5, centralReservedQty: 0, orderedQty: 5, deliveredQty: 5, paymentStatus: "EXPENSE_RECORDED", paymentMethod: "", commitState: "PENDING" }], reserved: 0 });
  await assert.rejects(() => distributionService.closeRun(seed.runId, closePayload(seed), admin()), /payment method/i);
  assert.equal((await db.collection(COLLECTIONS.DISTRIBUTION_RUNS).findOne({ id: seed.runId })).status, "RECEIVED_PENDING_REVIEW");
});

integration("distribution cannot close when branch receipt exceeds accounted supply", async () => {
  const seed = await seedDistribution({ onHand: 0, reserved: 0, items: [{ itemId: "milk", requestedQty: 1, centralReservedQty: 0, orderedQty: 1, actualPurchaseQty: 1, deliveredQty: 2, paymentStatus: "EXPENSE_RECORDED", paymentMethod: "UPI", commitState: "PENDING" }] });
  await assert.rejects(() => distributionService.closeRun(seed.runId, closePayload(seed, { milk: 2 }), admin()), /correct the purchased quantity/i);
  assert.equal((await db.collection(COLLECTIONS.DISTRIBUTION_RUNS).findOne({ id: seed.runId })).status, "RECEIVED_PENDING_REVIEW");
});

integration("admin can correct purchased quantity and price after a paid receipt mismatch", async () => {
  const seed = await seedDistribution({ onHand: 0, reserved: 0, items: [{ itemId: "milk", requestedQty: 1, centralReservedQty: 0, orderedQty: 1, actualPurchaseQty: 1, deliveredQty: 2, estimatedUnitPrice: 95, paymentStatus: "EXPENSE_RECORDED", paymentMethod: "UPI", expenseLogId: "expense-1", commitState: "PENDING" }] });
  await db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS).insertOne({ id: "expense-1", distributionRunId: seed.runId, sourceType: "WEEKLY_PURCHASE_PAYMENT", sourceId: "original", paymentBatchId: "original", amount: 95, paymentMethod: "UPI", items: [{ itemId: "milk", name: "milk", qty: 1, unitPrice: 95 }], createdAt: now() });
  await distributionService.updatePayments(seed.runId, admin(), { version: seed.version, idempotencyKey: "correct-paid-row", items: [{ id: `${seed.runId}-milk`, actualPurchaseQty: 2, estimatedUnitPrice: 100, paymentStatus: "EXPENSE_RECORDED", paymentMethod: "UPI" }] });
  const [item, expense] = await Promise.all([
    db.collection(COLLECTIONS.DISTRIBUTION_ITEMS).findOne({ id: `${seed.runId}-milk` }),
    db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS).findOne({ id: "expense-1" })
  ]);
  assert.deepEqual({ qty: item.actualPurchaseQty, price: item.estimatedUnitPrice, amount: expense.amount }, { qty: 2, price: 100, amount: 200 });
  assert.equal(expense.corrections.length, 1);
});

integration("purchased quantity not sent to the branch is added to central inventory", async () => {
  const seed = await seedDistribution({ onHand: 4, reserved: 4, items: [{ itemId: "milk", requestedQty: 6, centralReservedQty: 4, orderedQty: 8, actualPurchaseQty: 8, deliveredQty: 6, estimatedUnitPrice: 100, paymentStatus: "EXPENSE_RECORDED", paymentMethod: "UPI", commitState: "PENDING" }] });
  await distributionService.closeRun(seed.runId, closePayload(seed), admin());
  const inventory = await db.collection(COLLECTIONS.CENTRAL_INVENTORY).findOne({ itemId: "milk" });
  const item = await db.collection(COLLECTIONS.DISTRIBUTION_ITEMS).findOne({ id: `${seed.runId}-milk` });
  assert.equal(inventory.onHand, 6);
  assert.equal(inventory.unitCost, 100);
  assert.deepEqual({ central: item.centralCommittedQty, purchasedSent: item.purchasedDeliveredQty, surplus: item.purchasedSurplusQty }, { central: 4, purchasedSent: 2, surplus: 6 });
});

integration("closure failure rolls back every item and status change", async () => {
  const seed = await seedDistribution({ items: [
    { itemId: "milk", requestedQty: 5, centralReservedQty: 5, orderedQty: 0, deliveredQty: 5, commitState: "PENDING", onHand: 10, reserved: 5 },
    { itemId: "beans", requestedQty: 5, centralReservedQty: 5, orderedQty: 0, deliveredQty: 5, commitState: "PENDING", onHand: 10, reserved: 2 }
  ] });
  await assert.rejects(() => distributionService.closeRun(seed.runId, closePayload(seed), admin()));
  assert.equal((await db.collection(COLLECTIONS.CENTRAL_INVENTORY).findOne({ itemId: "milk" })).onHand, 10);
  assert.equal((await db.collection(COLLECTIONS.DISTRIBUTION_RUNS).findOne({ id: seed.runId })).status, "RECEIVED_PENDING_REVIEW");
  assert.equal(await db.collection(COLLECTIONS.INVENTORY_COMMITMENT_LOGS).countDocuments({ distributionRunId: seed.runId }), 0);
});

integration("legacy receipt is not deducted twice", async () => {
  const seed = await seedDistribution({ onHand: 5, reserved: 0, items: [{ itemId: "milk", requestedQty: 5, centralReservedQty: 5, orderedQty: 0, deliveredQty: 5, commitState: undefined }] });
  await distributionService.closeRun(seed.runId, closePayload(seed), admin());
  assert.equal((await db.collection(COLLECTIONS.CENTRAL_INVENTORY).findOne({ itemId: "milk" })).onHand, 5);
});

test("reports do not double-count direct and partial payment records for the same underlying item", {
  skip: enabled ? false : "Set TEST_MONGODB_URI to run MongoDB integration tests",
  todo: "Current audit report sums every linked expense log; it does not deduplicate malformed data containing both direct and pending-settlement logs for one item."
}, async () => {
  await db.collection(COLLECTIONS.WEEKLY_REQUESTS).insertOne({ id: "request-1", branchId: "B1", status: "DISTRIBUTED" });
  await db.collection(COLLECTIONS.DISTRIBUTION_RUNS).insertOne({ id: "dist-1", requestId: "request-1", branchId: "B1", status: "FINALIZED", createdAt: now() });
  await db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS).insertMany([
    { id: "direct", distributionRunId: "dist-1", sourceType: "WEEKLY_PURCHASE_PAYMENT", sourceId: "direct:upi", amount: 100, createdAt: now() },
    { id: "partial", distributionRunId: "dist-1", sourceType: "PENDING_SETTLEMENT", amount: 100, createdAt: now() }
  ]);
  const response = await invoke(weeklyAuditHandler, { user: admin() });
  assert.equal(response.body[0].payments.total, 100);
});

integration("branch cannot use admin guard or verify another branch request", async () => {
  const res = mockResponse();
  assert.equal(ensureAdmin({ user: branch("B1") }, res), false);
  assert.equal(res.statusCode, 403);
  const seed = await seedDistribution({ status: "AWAITING_RECEIPT", version: 0, items: [{ itemId: "milk", requestedQty: 5, centralReservedQty: 5, orderedQty: 0, deliveredQty: null, commitState: undefined }] });
  await assert.rejects(() => distributionService.verifyReceipt(seed.requestId, branch("B2"), { version: 0, idempotencyKey: "wrong-branch", items: [{ itemId: "milk", receivedQty: 5 }] }), /not ready/i);
});

test("new and old backend versions cannot process the workflow simultaneously", {
  skip: enabled ? false : "Set TEST_MONGODB_URI to run MongoDB integration tests",
  todo: "No deployment/schema-version lease currently prevents an old server from applying pre-Stage-10 receipt inventory logic during a rolling deployment."
}, async () => {
  const lease = await db.collection(COLLECTIONS.SETTINGS).findOne({ key: "weeklyWorkflowSchemaVersion" });
  assert.ok(lease?.value, "no workflow-version deployment lease is installed");
});
