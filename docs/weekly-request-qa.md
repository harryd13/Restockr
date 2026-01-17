# Weekly Request QA Scenarios

## Purpose
Validate the end-to-end weekly request flow from branch creation to admin combined purchase, inventory update, distribution, and history.

## Preconditions
- Backend running with `MONGODB_URI` set.
- Frontend running (default `http://localhost:5173`).
- Seeded data loaded via `backend/seed.js`.
- Clean weekly-request-related collections for consistent results.
- Weekly requests are only enabled on Thursday unless you set test flags (below).

### Suggested DB cleanup (before test runs)
Use `mongosh` and replace `<db>` with your database name:

```
use <db>

db.weeklyRequests.deleteMany({})
db.weeklyRequestItems.deleteMany({})
db.combinedPurchaseRuns.deleteMany({})
db.combinedPurchaseItems.deleteMany({})
db.distributionRuns.deleteMany({})
db.distributionItems.deleteMany({})
db.unfulfilledLogs.deleteMany({})
db.combinedPurchaseLogs.deleteMany({})
db.centralInventoryItems.deleteMany({})
```

## Automated E2E Tests
Location: `frontend/tests/weekly-request.spec.js`

Run:
```
cd frontend
npm install
npx playwright install
E2E_WEEKLY_ALLOW_ANY_DAY=true npm run test:e2e
```

Notes:
- Tests assume a clean DB for the current week.
- For local testing on non-Thursday days, set these env vars:
  - Backend: `WEEKLY_ALLOW_ANY_DAY=true`
  - Frontend: `VITE_WEEKLY_ALLOW_ANY_DAY=true`
  - Playwright: `E2E_WEEKLY_ALLOW_ANY_DAY=true`
- Uses seeded users: branch and admin accounts from `backend/data.js`.

## UI Test Scenarios (Detailed Steps)

### 1) Start weekly request (happy path)
1. Log in as a branch user (e.g., Brahmpuri).
2. Click `Weekly Request` tab.
3. Click `Start weekly request`.
4. Verify status pill shows `DRAFT` and week start date is visible.

### 2) Start weekly request is idempotent
1. With an active DRAFT, click `Start weekly request` again if visible.
2. Verify no duplicate draft is created and the same draft stays open.

### 3) Draft persists on refresh
1. In weekly request, select a category.
2. Add an item quantity.
3. Refresh the page.
4. Verify the item quantity remains in the summary table.

### 4) Autosave behavior
1. Update multiple item quantities.
2. Wait 1-2 seconds.
3. Refresh the page.
4. Verify quantities are preserved.

### 5) Submit with empty draft is blocked
1. Start a weekly request.
2. Do not add any items.
3. Verify `Submit` button is disabled.

### 6) Submit weekly request (happy path)
1. Add at least one item.
2. Click `Submit` and confirm.
3. Verify the page shows `No weekly request started for this week.`
4. Verify history includes the submitted request.

### 7) History shows only submitted requests
1. Have one DRAFT and one SUBMITTED request for the same branch.
2. Open History.
3. Verify only SUBMITTED appears.

### 8) History is branch-scoped
1. Submit weekly requests for two different branches.
2. Log in as Branch A.
3. Verify History only shows Branch A requests.

### 9) History detail accuracy
1. Expand a history row.
2. Verify requested and approved quantities match the original submission.
3. Verify status matches distribution state.

### 10) Weekly requests only on Thursday
1. Open Weekly Request on a non-Thursday day.
2. Verify the Start weekly request button is disabled and the message says Thursday-only.
3. Set the test flag and repeat to confirm weekly requests can be started on any day in local.

### 11) Multiple branches submit in same week
1. Submit requests for BR, RS, RP.
2. Log in as Admin.
3. Open `Central Purchase` tab.
4. Verify `Pending requests` count equals 3.

### 12) Combined purchase list contains shortfalls only
1. Ensure central inventory is empty.
2. Submit a weekly request with multiple items.
3. Verify combined purchase list includes only those items.

### 13) Combined purchase totals
1. Check `Total spend` matches the sum of Approved Qty x Unit Price.

### 14) Admin edits combined purchase
1. Update approved quantity and price for a row.
2. Change status to `UNAVAILABLE` for a row.
3. Submit the combined purchase.
4. Verify combined purchase queue becomes empty.

### 15) Distribution run created after purchase submit
1. After combined purchase submit, open `Distribution` tab.
2. Verify pending distribution run exists.

### 16) Distribution fulfillment
1. Click `Finalize All` and confirm.
2. Verify distribution queue is empty.
3. Verify branch request status becomes `DISTRIBUTED` in history.

### 17) Unfulfilled items
1. In distribution, set approved quantity lower than requested.
2. Finalize distribution.
3. Verify history highlights unfulfilled items.

### 18) No unexpected items in combined purchase
1. Submit a request with a known item set.
2. Verify combined purchase list does not include unrelated items.

### 19) Old weeks are not mixed into current week queue
1. Submit a request in a previous week.
2. Submit a request in current week.
3. Verify `Central Purchase` only shows current week requests.

### 20) Access control
1. Log in as branch user.
2. Verify admin tabs (Central Purchase, Distribution, Central Inventory) are not visible.

### 21) Category selection disabled before start
1. Open Weekly Request with no draft.
2. Verify category buttons are disabled.

### 22) Week boundary behavior
1. Submit a request on Wednesday.
2. Submit a request on Thursday.
3. Verify history shows two different week start dates.

## Automation Coverage
The Playwright suite covers: 1, 3, 6, 8 (partial), 11, 12 (empty inventory case), 14, 15, 16, 20.
Scenarios requiring clock control or manual inventory manipulation remain manual unless we add a test-only API for setup.
