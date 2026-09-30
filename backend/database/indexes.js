export async function ensureIndexes(db, COLLECTIONS) {
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
  await db.collection(COLLECTIONS.DISTRIBUTION_RUNS).createIndex({ receiptIdempotencyKey: 1 }, { unique: true, sparse: true });
  await db.collection(COLLECTIONS.DISTRIBUTION_ITEMS).createIndex({ runId: 1 });
  await db.collection(COLLECTIONS.DISTRIBUTION_RECEIPTS).createIndex({ runId: 1 }, { unique: true });
  await db.collection(COLLECTIONS.DISTRIBUTION_RECEIPTS).createIndex({ idempotencyKey: 1 }, { unique: true });
  await db.collection(COLLECTIONS.DISTRIBUTION_RECONCILIATIONS).createIndex({ weekStartDate: 1, itemId: 1 }, { unique: true });
  await db.collection(COLLECTIONS.UNFULFILLED_LOGS).createIndex({ weekStartDate: 1 });
  await db.collection(COLLECTIONS.COMBINED_PURCHASE_LOGS).createIndex({ createdAt: -1 });
  await db.collection(COLLECTIONS.TICKETS).createIndex({ status: 1, createdAt: -1 });
  await db.collection(COLLECTIONS.TICKET_ITEMS).createIndex({ ticketId: 1 });
  await db.collection(COLLECTIONS.EXPENSE_LOGS).createIndex({ createdAt: -1 });
  await db.collection(COLLECTIONS.EXPENSE_TICKETS).createIndex({ createdAt: -1 });
  await db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS).createIndex({ createdAt: -1 });
  await db.collection(COLLECTIONS.CASH_TALLIES).createIndex({ branchId: 1, date: 1 }, { unique: true });
  await db.collection(COLLECTIONS.CASH_TALLIES).createIndex({ updatedAt: -1 });
  await db.collection(COLLECTIONS.DUE_CLEARANCE_LOGS).createIndex({ createdAt: -1 });
  try {
    await db.collection(COLLECTIONS.CASH_REPORTS).dropIndex("date_1");
  } catch (err) {
    if (err?.codeName !== "IndexNotFound" && err?.codeName !== "NamespaceNotFound" && err?.code !== 26) throw err;
  }
  await db.collection(COLLECTIONS.CASH_REPORTS).createIndex({ branchId: 1, date: 1 }, { unique: true });
  await db.collection(COLLECTIONS.CASH_REPORTS).createIndex({ date: -1, verifiedAt: -1 });
  await db.collection(COLLECTIONS.MANUAL_ADJUSTMENTS).createIndex({ createdAt: -1 });
}

