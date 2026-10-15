# Phase 0 — technical inventory and Foffee baseline

Assessment date: 2026-10-01. This document is read-only: it records the repository as found and makes no database, deployment, or application changes.

## Scope and evidence rules

- `file:line` references point to the current repository source.
- **Verified** means directly supported by source. Database contents, hosting topology, and deployed Vercel/Render configuration are intentionally marked **unverified** because no connection or external system was accessed.
- “Global” means the code does not include an `organisationId` predicate; current records do not have that tenant field. “Role-only” means access is determined by the JWT role without a tenant check.

## 1. Architecture and security baseline

| Area | Verified finding | Evidence |
| --- | --- | --- |
| Frontend | Single React 18/Vite 5 SPA; it uses tab state rather than a router. | `frontend/package.json:12-20`, `frontend/src/App.jsx:34-35` |
| Backend | Single Express 4 API using the native MongoDB driver. | `backend/package.json:11-18`, `backend/db.js:1`, `backend/server.js:1-3` |
| Database | `MONGODB_URI` supplies the MongoDB connection and database; native `MongoClient` is used. The URI is not included in the repository. | `backend/db.js:8-23`, `.gitignore:3` |
| Authentication | Login compares supplied email and password directly against the `users` collection. Returned JWT carries `id`, `role`, `branchId`, and `name`; frontend stores it in local storage. | `backend/controllers/auth.controller.js:5-18`, `frontend/src/App.jsx:54-60`, `frontend/src/App.jsx:223-246` |
| Authorization | API middleware verifies JWT only. `ensureAdmin` is a role test. There is no organisation lookup or tenant scoping middleware. | `backend/middleware/auth.js:3-16`, `backend/middleware/auth.js:19-25` |
| Index execution | Index migration is a manual script; server startup does not call it. | `backend/scripts/migrate.js:6-9`, `backend/server.js:90-112` |
| CORS | Unrestricted `cors()` is active. | `backend/server.js:51` |

### Immediate security/migration implications

1. Plaintext passwords and a fallback JWT secret (`foffee_inventory_secret`) cannot be carried into public signup/invitations. Existing credential compatibility must be migrated carefully, using a verified secure identity/credential design.
2. Every collection and relationship listed below needs an organisation ownership decision before data from a second customer is created.
3. Existing globally unique keys (for example `centralInventory.itemId` and request/run IDs) must become organisation-aware or otherwise be redesigned before multi-tenant use. See `backend/database/indexes.js:2-47`.
4. Browser role UI is not an authorisation boundary; new access resolution must load the current server-side user/organisation/branch assignments on each protected request or within a suitably short-lived session.

## 2. Complete API inventory

All paths below are current Express registrations. Except `/`, `/api/health`, and `POST /api/login`, each route is registered with JWT middleware. “Current guard” describes actual backend enforcement, not the future Tickstock policy.

| Method | Path | Source | Current guard and scope |
| --- | --- | --- | --- |
| GET | `/` | `backend/server.js:106` | Public backend status text. |
| GET | `/api/health` | `backend/routes/health.js:4` | Public health endpoint. |
| POST | `/api/login` | `backend/controllers/auth.controller.js:5` | Public plaintext credential lookup; global `users`. |
| GET | `/api/me` | `backend/controllers/auth.controller.js:20` | Authenticated; fetches global user by JWT `id`. |
| GET | `/api/branches` | `backend/controllers/master-data.controller.js:4` | Authenticated only; global branch list. |
| GET | `/api/categories` | `backend/controllers/master-data.controller.js:9` | Authenticated only; global categories. |
| GET | `/api/items` | `backend/controllers/master-data.controller.js:14` | Authenticated only; global items. |
| GET | `/api/requests/current` | `backend/controllers/weekly-requests.controller.js:5` | Branch-only; derived JWT branch ID. |
| POST | `/api/requests/current` | `backend/controllers/weekly-requests.controller.js:22` | Branch-only; derived JWT branch ID. |
| POST | `/api/requests/:id/items` | `backend/controllers/weekly-requests.controller.js:52` | Branch-only; request must match JWT branch ID. |
| POST | `/api/requests/:id/submit` | `backend/controllers/weekly-requests.controller.js:106` | Branch-only; request must match JWT branch ID. |
| GET | `/api/daily-requests/current` | `backend/controllers/daily-requests.controller.js:5` | Branch-only; derived JWT branch ID. |
| POST | `/api/daily-requests/:id/items` | `backend/controllers/daily-requests.controller.js:31` | Branch-only; request must match JWT branch ID. |
| POST | `/api/daily-requests/:id/submit` | `backend/controllers/daily-requests.controller.js:87` | Branch-only; request must match JWT branch ID. |
| POST | `/api/misc-requests/submit` | `backend/controllers/misc-requests.controller.js:5` | Branch-only; derived JWT branch ID. |
| GET | `/api/requests/history` | `backend/controllers/request-history.controller.js:4` | Branch-only; derived JWT branch ID. |
| GET | `/api/requests/history/:id/items` | `backend/controllers/request-history.controller.js:39` | Branch-only; request/items filtered to JWT branch ID. |
| GET | `/api/expense-tickets` | `backend/controllers/expense-tickets.controller.js:2` | Admin-only in service; global records. |
| POST | `/api/expense-tickets` | `backend/controllers/expense-tickets.controller.js:4` | Admin-only in service; global records. |
| POST | `/api/expense-tickets/:id/update` | `backend/controllers/expense-tickets.controller.js:6` | Admin-only in service; global ID lookup. |
| POST | `/api/expense-tickets/:id/partial` | `backend/controllers/expense-tickets.controller.js:8` | Admin-only in service; global ID lookup. |
| POST | `/api/expense-tickets/:id/delete` | `backend/controllers/expense-tickets.controller.js:10` | Admin-only in service; global ID lookup. |
| POST | `/api/expense-tickets/branch` | `backend/controllers/expense-tickets.controller.js:12` | Branch workflow; service uses JWT branch ID. |
| GET | `/api/expense-tickets/logs` | `backend/controllers/expense-tickets.controller.js:14` | Admin-only in service; global logs. |
| GET | `/api/expense-tickets/branch/history` | `backend/controllers/expense-tickets.controller.js:16` | Branch workflow; filtered to JWT branch ID. |
| POST | `/api/expense-tickets/branch/:id/update` | `backend/controllers/expense-tickets.controller.js:18` | Branch workflow; ID + JWT branch ID. |
| POST | `/api/expense-tickets/branch/:id/delete` | `backend/controllers/expense-tickets.controller.js:20` | Branch workflow; ID + JWT branch ID. |
| GET | `/api/tickets` | `backend/controllers/tickets.controller.js:2` | Admin-only in service; global queue. |
| POST | `/api/tickets/:id/delete` | `backend/controllers/tickets.controller.js:4` | Admin-only in service; global ID lookup. |
| POST | `/api/tickets/:id/done` | `backend/controllers/tickets.controller.js:6` | Admin-only in service; global ID lookup. |
| POST | `/api/tickets/:id/partial` | `backend/controllers/tickets.controller.js:8` | Admin-only in service; global ID lookup. |
| GET | `/api/tickets/expenses` | `backend/controllers/tickets.controller.js:10` | Admin-only in service; global logs. |
| GET | `/api/central-inventory` | `backend/controllers/inventory.controller.js:5` | Admin-only; global central inventory. |
| POST | `/api/central-inventory/adjust` | `backend/controllers/inventory.controller.js:36` | Admin-only; global item inventory. |
| GET | `/api/central-inventory/adjustments` | `backend/controllers/inventory.controller.js:110` | Admin-only; global adjustment history. |
| POST | `/api/central-inventory/flush` | `backend/controllers/inventory.controller.js:121` | Admin-only; global inventory mutation. |
| GET | `/api/combined-purchase-runs` | `backend/controllers/combined-purchases.controller.js:2` | Admin-only in service; global runs. |
| GET | `/api/combined-purchase-run` | `backend/controllers/combined-purchases.controller.js:4` | Admin-only in service; global run. |
| GET | `/api/combined-purchase-queue` | `backend/controllers/combined-purchases.controller.js:6` | Admin-only in service; global queue. |
| POST | `/api/combined-purchase-queue/submit` | `backend/controllers/combined-purchases.controller.js:8` | Admin-only in service; global queue. |
| GET | `/api/combined-purchase-logs` | `backend/controllers/combined-purchases.controller.js:10` | Admin-only in service; global logs. |
| POST | `/api/combined-purchase-run/:id/items` | `backend/controllers/combined-purchases.controller.js:12` | Admin-only in service; global run ID. |
| POST | `/api/combined-purchase-run/:id/add-item` | `backend/controllers/combined-purchases.controller.js:14` | Admin-only in service; global run ID. |
| POST | `/api/combined-purchase-run/:id/submit` | `backend/controllers/combined-purchases.controller.js:16` | Admin-only in service; global run ID. |
| GET | `/api/distribution-run` | `backend/controllers/distribution.controller.js:4` | Admin-only; global run lookup. |
| GET | `/api/distribution-runs` | `backend/controllers/distribution.controller.js:15` | Admin-only; global runs. |
| GET | `/api/distribution-queue` | `backend/controllers/distribution.controller.js:24` | Admin-only; global queue. |
| POST | `/api/distribution-run/:id/items` | `backend/controllers/distribution.controller.js:54` | Admin-only; global run ID. |
| POST | `/api/requests/:id/verify-receipt` | `backend/controllers/distribution.controller.js:59` | Authenticated; controller delegates to branch-aware service; requires review for explicit role check. |
| POST | `/api/distribution-run/:id/close` | `backend/controllers/distribution.controller.js:64` | Admin-only; global run ID. |
| POST | `/api/distribution-run/:id/finalize` | `backend/controllers/distribution.controller.js:70` | Admin-only; global run ID. |
| POST | `/api/distribution-run/finalize-multi` | `backend/controllers/distribution.controller.js:74` | Admin-only; global run IDs. |
| GET | `/api/purchase-run` | `backend/controllers/purchase.controller.js:11` | OPS or ADMIN; global records. |
| POST | `/api/purchase-run/:id/update-items` | `backend/controllers/purchase.controller.js:16` | OPS or ADMIN; global run ID. |
| POST | `/api/purchase-run/:id/finalize` | `backend/controllers/purchase.controller.js:21` | OPS or ADMIN; global run ID. |
| POST | `/api/purchase-run/finalize-multi` | `backend/controllers/purchase.controller.js:26` | OPS or ADMIN; global run IDs. |
| GET | `/api/reports/branch-trend` | `backend/controllers/reports.controller.js:12` | OPS or ADMIN; global report data. |
| GET | `/api/reports/purchase-logs` | `backend/controllers/reports.controller.js:30` | OPS or ADMIN; global logs. |
| GET | `/api/cash-management/branch/today` | `backend/controllers/cash-management.controller.js:2` | Branch path; service uses JWT branch ID. |
| POST | `/api/cash-management/branch` | `backend/controllers/cash-management.controller.js:4` | Branch path; service uses JWT branch ID. |
| GET | `/api/admin/cash-management/summary` | `backend/controllers/cash-management.controller.js:6` | Admin-only in service; global aggregate. |
| GET | `/api/admin/cash-account-summary` | `backend/controllers/cash-management.controller.js:8` | Admin-only in service; global aggregate. |
| POST | `/api/admin/due-clearances` | `backend/controllers/cash-management.controller.js:10` | Admin-only in service; global mutation. |
| POST | `/api/admin/cash-management/verify` | `backend/controllers/cash-management.controller.js:12` | Admin-only in service; global mutation. |
| GET | `/api/admin/cash-reports` | `backend/controllers/cash-management.controller.js:14` | Admin-only in service; global reports. |
| POST | `/api/admin/cash-reports/send-previous-day` | `backend/controllers/cash-management.controller.js:16` | Admin-only in service; invokes configured webhook. |
| GET | `/api/settings/weekly-override` | `backend/controllers/settings.controller.js:5` | Authenticated; currently one global setting. |
| GET | `/api/settings/report-start-date` | `backend/controllers/settings.controller.js:10` | Authenticated; currently per user ID. |
| GET | `/api/admin/settings/initial-cash-balances` | `backend/controllers/settings.controller.js:15` | Admin-only; global setting. |
| GET | `/api/admin/settings/due-balance` | `backend/controllers/settings.controller.js:21` | Admin-only; global setting. |
| POST | `/api/settings/report-start-date` | `backend/controllers/settings.controller.js:27` | Authenticated; currently writes key by user ID. |
| POST | `/api/admin/settings/initial-cash-balances` | `backend/controllers/settings.controller.js:46` | Admin-only; global setting. |
| POST | `/api/admin/settings/due-balance` | `backend/controllers/settings.controller.js:77` | Admin-only; global setting. |
| POST | `/api/admin/settings/weekly-override` | `backend/controllers/admin.controller.js:2` | Admin-only in service; global setting. |
| GET | `/api/admin/categories` | `backend/controllers/admin.controller.js:4` | Admin-only in service; global master data. |
| POST | `/api/admin/categories` | `backend/controllers/admin.controller.js:6` | Admin-only in service; global master data. |
| PUT | `/api/admin/categories/:id` | `backend/controllers/admin.controller.js:8` | Admin-only in service; global ID. |
| DELETE | `/api/admin/categories/:id` | `backend/controllers/admin.controller.js:10` | Admin-only in service; global ID. |
| GET | `/api/admin/items` | `backend/controllers/admin.controller.js:12` | Admin-only in service; global master data. |
| POST | `/api/admin/items` | `backend/controllers/admin.controller.js:14` | Admin-only in service; global master data. |
| PUT | `/api/admin/items/:id` | `backend/controllers/admin.controller.js:16` | Admin-only in service; global ID. |
| DELETE | `/api/admin/items/:id` | `backend/controllers/admin.controller.js:18` | Admin-only in service; global ID. |
| GET | `/api/admin/branches` | `backend/controllers/admin.controller.js:20` | Admin-only in service; global branches. |
| POST | `/api/admin/branches` | `backend/controllers/admin.controller.js:22` | Admin-only in service; global branches. |
| PUT | `/api/admin/branches/:id` | `backend/controllers/admin.controller.js:24` | Admin-only in service; global ID. |
| DELETE | `/api/admin/branches/:id` | `backend/controllers/admin.controller.js:26` | Admin-only in service; global ID. |
| GET | `/api/admin/users` | `backend/controllers/admin.controller.js:28` | Admin-only in service; global users. |
| POST | `/api/admin/users` | `backend/controllers/admin.controller.js:30` | Admin-only in service; global users and plaintext credentials. |
| PUT | `/api/admin/users/:id` | `backend/controllers/admin.controller.js:32` | Admin-only in service; global ID. |
| DELETE | `/api/admin/users/:id` | `backend/controllers/admin.controller.js:34` | Admin-only in service; global ID. |

## 3. Current data collections and relationships

The canonical current collection names are defined at `backend/config.js:7-36`. Relationships below are inferred from repository usage and current indexes, not from enforced foreign keys.

| Collection(s) | Current relation / purpose | Isolation action |
| --- | --- | --- |
| `users` | Login identities; current roles and optional `branchId`. Unique global email. | Add `organisationId`, secure identity fields, status, role, and assignments; retain stable `id`. |
| `branches` | Branch master records; referenced by all branch workflows. | Add `organisationId`, archive state; scope branch IDs/queries. |
| `categories`, `items` | Inventory master data; `items.categoryId`. | Decide global templates vs tenant-owned catalogue; current UI treats them as global. |
| `weeklyRequests`, `weeklyRequestItems` | Branch weekly request and child items (`requestId`). | Add organisation ID to both; compound organisation/branch/request indexes. |
| `dailyRequests`, `dailyRequestItems` | Branch daily requests and children. | Add organisation ID to both; scope parent/child reads. |
| `miscRequests`, `miscRequestItems` | Branch miscellaneous requests and children. | Add organisation ID to both. |
| `tickets`, `ticketItems` | Admin ticket queue created from branch requests. | Add organisation ID and preserve branch linkage. |
| `purchaseLogs`, `combinedPurchaseRuns`, `combinedPurchaseItems`, `combinedPurchaseLogs` | Central purchasing records linked to request/run IDs. | Add organisation ID; make all uniqueness rules organisation-aware. |
| `centralInventoryItems`, `manualInventoryAdjustments` | Organisation-wide central stock currently unique by `itemId`. | Add organisation ID; unique `(organisationId, itemId)`. |
| `distributionRuns`, `distributionItems`, `distributionReceipts`, `distributionReconciliations`, `unfulfilledLogs` | Purchase-to-branch distribution/receipt lifecycle. | Add organisation ID to every parent/child/log record; preserve authorised branch checks. |
| `expenseTickets`, `expenseTicketLogs`, `expenseLogs` | Admin and branch expense lifecycle. | Add organisation ID; branch-level records additionally require authorised branch scope. |
| `cashTallies`, `cashReports`, `dueClearanceLogs` | Daily branch cash operations/reports. Current unique pairs use `branchId` and date. | Add organisation ID and make unique pairs tenant-aware. |
| `settings` | Mix of global keys and per-user report-start-date keys. | Split organisation settings from user preferences; scope every key. |

### Existing indexes that require tenant-aware replacements

The following current constraints are global and must be replaced only after verified backfill: `users.email` (`backend/database/indexes.js:2`), central inventory `itemId` (`:21`), combined run `requestId` (`:22`), distribution run `requestId` (`:24`), receipt/idempotency keys (`:25-28`), reconciliations (`:29`), cash tallies (`:37`), and cash reports (`:45`).

## 4. Access classification

### Branch-scoped today

- Weekly requests: branch-only and JWT `branchId` derived: `backend/controllers/weekly-requests.controller.js:5-116`.
- Daily requests: branch-only and request ownership verified against JWT `branchId`: `backend/controllers/daily-requests.controller.js:5-101`.
- Misc requests: branch-only and branch ID derived from JWT: `backend/controllers/misc-requests.controller.js:5-62`.
- Request history: branch-only and branch-filtered request/item lookup: `backend/controllers/request-history.controller.js:4-57`.
- Branch expense tickets and history: use the JWT `branchId`: `backend/services/expense-tickets.service.js:382-539`.
- Branch cash management: uses the JWT `branchId`: `backend/services/cash-management.service.js:10-80`.
- Receipt verification needs an explicit re-check during Phase 3; its route is merely authenticated at registration and delegates to another service: `backend/controllers/distribution.controller.js:59`.

### Admin-only today (role-only, globally scoped)

- Master data, branches, users, weekly override: `backend/services/admin.service.js:5-180`.
- Expense ticket admin operations: `backend/services/expense-tickets.service.js:7-339`.
- Tickets: `backend/services/tickets.service.js:7-198`.
- Central inventory: `backend/controllers/inventory.controller.js:5-128`.
- Combined purchasing: `backend/services/combined-purchases.service.js:5-341`.
- Distribution queues/finalisation: `backend/controllers/distribution.controller.js:4-76`.
- Admin cash and reports: `backend/services/cash-management.service.js:85-386`.
- Admin settings: `backend/controllers/settings.controller.js:15-88`.

### OPS-or-admin today (role-only, globally scoped)

- Purchase run operations: `backend/controllers/purchase.controller.js:5-27`.
- Reports: `backend/controllers/reports.controller.js:5-35`.

### Authenticated but insufficiently scoped today

- Branch/category/item reads: authenticated but have neither role nor branch/tenant restriction: `backend/controllers/master-data.controller.js:4-16`.
- Settings weekly override is a global setting readable by any authenticated user: `backend/controllers/settings.controller.js:5-12`.
- `/api/me` returns identity by ID but no current membership/access resolution: `backend/controllers/auth.controller.js:20-24`.

## 5. Foffee operational baseline

### Existing seeded role/destination model

These sample identities document the current role model only. Do not use, expose, or rely on their credentials during migration. Source data defines three branch users, one OPS user, and one ADMIN user: `backend/data.js:1-14`.

| Current role | Initial frontend destination | Key operational areas | Evidence |
| --- | --- | --- | --- |
| `ADMIN` | `home` | Expenses/home, cash management/reports, combined purchase, distribution, central inventory, tickets, reports, master data, tools. | `frontend/src/App.jsx:73-82`, `:238-245`, `:305-379`, `:426-454` |
| `OPS` | `ops` | Purchase run and reports. | `frontend/src/App.jsx:79-80`, `:243-244`, `:342-345`, `:435-438` |
| `BRANCH` | `branch-home` | Branch expenses/home, cash management, weekly/daily/other requests, request history/receipts. | `frontend/src/App.jsx:76-78`, `:240-242`, `:310-340`, `:422-425` |

### Owner decision

No existing owner role or owner identity exists in source. The initial Foffee Tickstock owner is therefore **not confirmed** and must be selected by the business before the migration runs. Do not infer this from the existing `ADMIN` role.

## 6. Foffee regression checklist

Run this against a non-production copy before and after each behavior-affecting phase; production validation requires explicit authorisation and must not print credentials.

### Common

- [ ] Login succeeds for one approved account of each existing role.
- [ ] Expired/invalid token returns to login without retaining stale access.
- [ ] Logout clears the stored session and protected calls fail.
- [ ] Public health endpoint remains reachable and does not reveal sensitive configuration.

### Admin

- [ ] Admin lands on Home and sees the existing navigation set.
- [ ] Can load branches, categories, items, and reports.
- [ ] Can complete a representative central purchase → distribution → inventory update flow.
- [ ] Can create/update/resolve a representative expense/ticket flow.
- [ ] Can view and verify cash management/reports without cross-organisation data once tenant isolation is introduced.

### OPS

- [ ] OPS lands on Purchase Run.
- [ ] OPS can load/update/finalise its intended purchase run workflow.
- [ ] OPS can access intended reports.
- [ ] OPS is denied admin-only master data, users, inventory administration, cash administration, and future owner portal/billing APIs.

### Each branch (Brahmpuri, Ridhi-Sidhi, Rajapark)

- [ ] Lands on Branch Home for its own branch.
- [ ] Can create/edit/submit weekly and daily requests in the allowed window.
- [ ] Can create a miscellaneous request and branch expense ticket.
- [ ] Can view only its own history, cash records, receipts, and branch expense history.
- [ ] Is denied every admin API and direct IDs belonging to another branch.

### Future tenant/isolation checks

- [ ] A second test organisation cannot list, read, change, export, or aggregate Foffee records.
- [ ] A Free organisation cannot create a second active branch under concurrent requests.
- [ ] Invitation acceptance rejects a user already belonging to another organisation and mismatched email/token cases.

## 7. Deployment and staging inventory

| Concern | Verified repository configuration | Required staging action / open verification |
| --- | --- | --- |
| Frontend API URL | `VITE_API_BASE`, default `http://localhost:4000`. | Set staging Vercel value to staging Render API URL; do not use production URL. |
| Backend port/database | `PORT`, `MONGODB_URI`. | Use a hosted non-production MongoDB URI reachable by Render and local development; verify actual host separately. |
| JWT | `JWT_SECRET` has an unsafe fallback. | Provide a distinct, strong staging secret; remove fallback as part of auth hardening. |
| CORS | Unrestricted `cors()`. | Replace with explicit staging/prod origins and required methods/headers before public release. |
| Current auth transport | Bearer token in local storage, not cookies. | Decide secure auth/session approach before adding callbacks or external identity provider. |
| Links | `CASH_REPORT_PAGE_URL`, then `FRONTEND_URL`, then `APP_URL` form cash report links. | Define environment-specific canonical frontend URL for reports, invitations, email verification, and billing callbacks. |
| Webhooks | `WEBHOOK_URL`, `DAILYHOOK`, `CASH_REPORT_WEBHOOK_URL` are outbound notification URLs. | Separate staging endpoints/secrets; inventory delivery failure behavior. Billing webhook endpoint/secrets will be new. |
| PWA caching | The app registers `/service-worker.js`. | Audit cache/version/update logic before public/portal rollout; ensure staging is visibly separate and does not serve stale production shell. Evidence: `frontend/src/main.jsx:7-12`, `frontend/public/service-worker.js`. |
| Tests | Playwright base URL is `E2E_BASE_URL` with local default. | Add non-destructive staging test data/tenant and a configured staging run. Evidence: `frontend/playwright.config.js:3`. |
| Billing/email | No billing or email provider code/dependencies found. | Choose provider, sandbox credentials, sender/test inbox, webhook URLs, price/currency/tax, and lifecycle policies before Phase 6. |

### MongoDB hosting conclusion

The repository confirms a MongoDB URI is required but does not reveal whether the current non-production database is hosted or laptop-local. If it is laptop-local, Render cannot securely connect to it. The staging plan must use a hosted non-production MongoDB instance; no public laptop tunnel should be used. If local and staging share one non-production database, prevent destructive seeds/resets and coordinate schema rollouts. A dedicated staging database is preferred when automated tests or multiple developers are active.

## 8. Phase 3 tenant-scoping worklist

1. Introduce organisation, branch-assignment, invitation, and entitlement data before onboarding routes are exposed.
2. Establish `GET /api/me/access` and common server-side access resolution; derive organisation/branch scope from it.
3. Backfill Foffee first using rerunnable, dry-run-capable migration scripts with count and orphan verification.
4. Add `organisationId` to every tenant-owned collection in Section 3, then update every listed API query, aggregate, job, cache, export, and uniqueness constraint.
5. Make parent/child records tenant-consistent in the same transaction or verified write workflow.
6. Replace current global settings with organisation settings or user preferences as appropriate.
7. Add negative authorisation tests for every branch and cross-tenant endpoint before enabling new customer signup.

## Phase 0 completion status

- [x] Route inventory with source line numbers.
- [x] Collection/relationship and global-scope inventory.
- [x] Admin/OPS/branch workflow classification.
- [x] Foffee regression baseline and explicit unresolved owner decision.
- [x] Repository-level deployment/staging assessment.
- [ ] Confirm actual hosted MongoDB/staging configuration externally, without sharing secrets.
- [ ] Select Foffee’s initial owner and define the future OPS mapping.
