# Weekly workflow integration tests

These tests use a real MongoDB transaction-capable test database. They never read `MONGODB_URI` automatically.

PowerShell setup:

```powershell
$env:TEST_MONGODB_URI="mongodb+srv://..."
$env:TEST_DATABASE_NAME="foffee_workflow_test"
npm run test:workflow
```

`TEST_DATABASE_NAME` must contain `test`. The suite deletes documents from every application collection in that database after each test. Never point it at development, staging, or production data.

## Current behavior matrix

| Scenario | Current behavior |
| --- | --- |
| Two branches compete for the last stock | Protected by conditional reservation inside transactions; total reservations cannot exceed available stock. |
| Two admins edit one purchase | Protected by run version; one stale writer receives `409`. |
| Ordered is retried/double-clicked | Protected by idempotency key and unique purchase-run order index; one order and distribution are created. |
| Paid update is retried | Protected by payment idempotency key/source index; one expense record is created. |
| Several pending items | Aggregated into one `WEEKLY_PURCHASE` ticket for the branch order. |
| Two partial settlements run simultaneously | **Known gap:** no transaction/version/idempotency protection; overpayment is possible. |
| Receipt verification is retried | Protected by receipt idempotency key; one receipt is created and retries replay it. |
| Admin changes receipt without a reason | Rejected. |
| Central inventory changes before close | Closure rejects when the reservation/on-hand precondition no longer holds. |
| Two admins close simultaneously | Transaction/version handling and the unique commitment index produce one commitment; the retry replays final state. |
| Final quantity below reservation | Used central stock is committed and the unused reservation is released. |
| Final quantity above reservation | Reserved central stock is committed first; excess is recorded as vendor-delivered. |
| Vendor quantity affects central stock | It does not reduce central inventory. |
| Closure fails midway | MongoDB transaction rolls back inventory, logs, and statuses. |
| Legacy verified receipt closes | Missing `inventoryCommitState` is treated as already applied, avoiding a second deduction. |
| Direct and partial logs overlap | **Known gap:** the audit report sums both if malformed/legacy data links both to one order. |
| Branch accesses admin/other branch | Admin guard rejects branch users; receipt lookup is scoped to the authenticated branch. |
| Old and new backends run together | **Known gap:** no workflow-version deployment lease prevents mixed Stage 9/Stage 10 processing. |

The three known gaps are executable TODO tests: they document the desired invariant and will become normal passing tests when their protections are implemented.
