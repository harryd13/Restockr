# Tickstock self-service SaaS layer — intent and delivery plan

## Purpose

Evolve the existing production Foffee inventory application (currently branded Restockr in code) into **Tickstock**, a single self-service SaaS product. The public website, owner portal, and existing inventory operations will remain in this repository, use one React/Vite build, one Express backend, and the existing MongoDB database integration.

This is an incremental change. The live Foffee workflow and credentials remain usable throughout; no parallel frontend, backend, microservices, or POS product will be introduced.

## Verified repository baseline (2026-10-01)

- Frontend: React 18 + Vite 5, Axios, no routing library. `src/App.jsx` is a stateful, tab-based application shell.
- Backend: Node/Express 4 with the native MongoDB driver (not Mongoose), JWT, CORS, and JSON request bodies.
- Database: MongoDB connection uses `MONGODB_URI`; database selection comes from that URI. MongoDB is expected to be hosted (the README uses a `mongodb+srv` URI), but the repository alone cannot verify the actual local/staging host.
- Deployment configuration: frontend API base is `VITE_API_BASE`, defaulting to `http://localhost:4000`. Backend currently enables unrestricted `cors()` and documents `FRONTEND_URL` / `APP_URL` only for generated report links.
- Current authentication: `POST /api/login` looks up `{ email, password }` directly in `users`; passwords are plaintext. It returns a one-hour JWT and the frontend saves the JWT plus user data in `localStorage` under `foffee_auth`.
- Current identity/roles: users have an application `id`, `email`, `password`, role (`ADMIN`, `OPS`, or `BRANCH`), and at most one `branchId`. Existing branch IDs are stable string IDs such as `BR`, `RS`, and `RP`.
- Current authorization: some branch workflows scope work using the JWT's `branchId`; admin checks are role-only. There is no organisation model or organisation scoping, and many operational queries are unscoped. This must be corrected before serving another customer.
- Current data/indexes: MongoDB collections are hand-managed. `backend/scripts/migrate.js` creates indexes; it is not called automatically on server start. Current indexes include a globally unique user email and several global branch/request keys.
- Reusable UI: `TopNav`, `AppFooter`, `Modal`, and `ErrorBoundary` are cross-cutting candidates. `LoginScreen` becomes part of the new web/auth experience after it is redesigned. All current operational pages are inventory-specific.
- PWA: a public service worker and manifest already exist and must be reviewed before rollout so stale public/portal/inventory shells cannot be served after releases.

## Target frontend shape

The reorganisation is deliberately behavior-preserving and happens before SaaS features.

```text
frontend/src/
  inventory/
    pages/              # existing operational pages, moved without redesign
    components/         # only inventory-specific components as they emerge
    InventoryApp.jsx    # existing role-based inventory shell, progressively simplified
  web/
    pages/
      public/           # Home, Product, Pricing, About, Contact, Login, Signup
      portal/           # Overview, settings, branches, users, billing
    components/
    WebApp.jsx
  shared/
    api/
    auth/
    components/         # Header, Footer, Modal, ErrorBoundary, primitives
    layouts/            # PublicLayout, PortalLayout, InventoryLayout
  App.jsx               # top-level route/access gate
  main.jsx
  index.css
```

Use a lightweight client-side route mechanism only if routing is introduced as part of this work; do not create a second app. Public navigation, owner-portal navigation, and inventory navigation are separate layouts using shared primitives, not one forced universal navigation bar.

## Product and access intent

- One organisation equals one customer business. A user can belong to exactly one organisation.
- An organisation starts with one owner. Ownership transfer is explicitly out of scope for v1; destructive owner actions cannot leave an organisation ownerless.
- Owner: uses the Tickstock portal for organisation, branches, users, invitations, and billing; may open organisation-wide Inventory.
- Admin: lands in the existing organisation-wide Inventory view; cannot administer membership, owner settings, or billing.
- Branch user: lands in Inventory for assigned branches only. Multi-branch access gets a selector sourced solely from authorised assignments.
- Existing Foffee staff continue through the common login page and land in their current operational destinations. The future Foffee owner must be selected and approved before migration; it cannot be inferred from the existing `ADMIN` account.

## Target data and security model

Additive collections/fields, retaining permanent existing `id` values where practical:

- `organisations`: `id`, business profile, entitlement, owner user ID, lifecycle timestamps.
- `users`: retain `id` and email; add `organisationId`, role, verified-email state, secure credential/identity-provider fields, status, and token/session invalidation fields. Enforce unique email and exactly one organisation association for active users.
- `branches`: retain `id`; add `organisationId`, active/archive state, and plan-safe metadata.
- `branchAssignments`: user ID, organisation ID, branch ID, active state. Unique `(userId, branchId)`.
- `invitations`: organisation, email, role, requested branch IDs, expiry/revocation/acceptance state, and only a hash of a high-entropy token.
- `billingCustomers`, `subscriptions`, and `billingEvents`: provider mappings and event/idempotency audit trail. Organisation entitlement remains separate from raw provider status.
- Every tenant-owned operational record receives `organisationId`; records that are branch-specific also retain/receive `branchId`.

Protected backend requests must authenticate, load current server-side user/access state, check the permission, derive organisation and authorised branches server-side, and scope every read/write accordingly. Client-provided role, organisation, branch, and plan fields are never authority.

Use a shared access service and an endpoint such as `GET /api/me/access` as the destination source of truth. Replace plaintext password comparison with a managed compatible authentication approach (or securely hashed credentials during the Foffee migration); do not preserve the frontend-only trust model.

## Initial permission matrix

| Capability | Owner | Admin | Branch user |
| --- | --- | --- | --- |
| Portal overview/settings | Yes | No | No |
| Branches, users, invitations | Yes | No | No |
| Billing and plan | Yes | No | No |
| Organisation-wide Inventory/admin operations | Yes | Yes | No |
| Assigned branch operations | Yes, when using Inventory | As defined by current admin policies | Yes, assigned branches only |
| Other/unassigned branch data or APIs | No implicit access | Organisation-wide only | No |

The detailed permission table will be completed endpoint-by-endpoint while tenant-scoping existing routes; `OPS` requires an explicit decision: retain it as a constrained operational role or migrate its users to Admin/Branch access.

## Foffee migration strategy

1. Back up and inventory the non-production dataset first; inspect production only read-only when authorised.
2. Create one Foffee organisation with a manually confirmed owner and a non-billing Pro/grandfathered entitlement. This preserves current multi-branch use without charges.
3. Rerunnable migration maps existing users, branches, and operational records to Foffee. It preserves existing IDs and validates counts before/after each collection.
4. Mark ambiguous records for review rather than guessing ownership.
5. Deploy read-compatible code, verify Foffee logins and workflows, then progressively require organisation-scoped queries. Tighten indexes/constraints only after the backfill verifies cleanly.
6. Never run migration scripts against production during development. Each script must support dry-run, idempotent re-run, verification output, and documented recovery.

## Billing intent

Billing is part of the first SaaS release, but provider selection needs business input. Use provider-hosted checkout and customer billing management, server-selected prices, signed webhook verification, idempotency keys/event storage, reconciliation, and owner-only endpoints. A checkout success redirect never grants Pro; verified provider events update entitlement.

Free permits one active branch. Pro permits unlimited active branches initially. Enforce Free limits atomically inside MongoDB (transaction when the deployment supports it; otherwise a conditional update/reservation design backed by unique constraints). Expired Pro must preserve historical data; the chosen policy will define whether excess branches become read-only or must be archived before new actions.

## Staging intent

No infrastructure changes occur during this planning phase. Staging needs separate Vercel and Render environments, non-production MongoDB, sandbox billing, test email delivery, separate secrets, an obvious staging indicator, and staging-specific callback/invitation/webhook URLs.

If the current development MongoDB is only on a laptop/localhost, Render cannot securely reach it. Use a hosted non-production MongoDB cluster accessible by both local development and Render; do not expose a laptop database or rely on a public tunnel. Sharing one non-production database is acceptable only with tenant-safe test data, no destructive reset/seed scripts, and coordinated schema changes; a separate staging database is preferable once automated tests or multiple developers can modify data concurrently.

## Delivery phases and acceptance criteria

### Phase 0 — repository and operational baseline

Document current collections, record ownership relationships, endpoints, deployment variables, existing tests, and Foffee workflow smoke tests. Confirm real database topology and production/staging environment settings without exposing secrets.

**Accept when:** baseline build and existing Playwright checks pass; a written endpoint/data inventory and rollback plan exist.

### Phase 1 — behavior-preserving frontend reorganisation

Move existing pages into `inventory`, promote only verified reusable primitives to `shared`, and update imports. Do not redesign workflows or change API contracts.

**Accept when:** production-equivalent Foffee admin, OPS, and branch login routes/tab workflows behave exactly as before; frontend build and regression checks pass.

### Phase 2 — shared shell and public Tickstock website

Introduce public routes/layout and responsive Home, inventory information, Pricing, About, Contact, Login, and Signup pages. Login remains connected to existing access until the authentication migration ships.

**Accept when:** public pages are accessible without credentials, inventory remains protected, and mobile/desktop loading, empty, and error states are present.

### Phase 3 — organisations, secure auth, Foffee mapping, and isolation foundation

Implement organisations, secure identity/credential handling, `GET /me/access`, server-side access resolution, additive Foffee migration, scoped indexes, and tenant filtering for all existing APIs/data paths.

**Accept when:** legacy Foffee credentials still work through the common login; two test organisations cannot read/write each other's data; branch users are denied admin and unassigned-branch APIs.

### Phase 4 — owner onboarding and organisation/branch portal

Build verified owner registration, retry-safe onboarding, business details, Free/Pro selection, first branch creation, portal overview/settings, and branch management. Enforce the Free branch limit atomically.

**Accept when:** repeated onboarding requests create no duplicates; a new Free organisation has isolated data and cannot create a second active branch concurrently.

### Phase 5 — invitations and role destinations

Build owner-only invitation/revoke/resend flows, expiry, hashed tokens, verified-email matching, acceptance, branch assignment, and direct-login pending invitation handling.

**Accept when:** acceptance is retry-safe; revoked/expired/mismatched/other-organisation invitations fail safely; accepted users land in the correct portal or Inventory destination.

### Phase 6 — billing and entitlement lifecycle

Select and integrate the approved provider in sandbox; add checkout, billing portal, webhooks, event reconciliation, and entitlement policies for renewal, failure, cancellation, grace, downgrade, and excess branches.

**Accept when:** only verified webhook events activate Pro; duplicate/out-of-order events are harmless; failed/cancelled subscriptions follow documented policies while history remains intact.

### Phase 7 — staging and release verification

Configure staging Vercel/Render/MongoDB/billing/email/callbacks/CORS/cookies and PWA cache strategy. Run migration rehearsal and the full cross-tenant/billing regression suite.

**Accept when:** staging is visibly isolated from production, uses sandbox billing only, passes release checks, and has documented rollback and operational runbooks.

## Decisions required before their implementation phase

1. Which existing Foffee identity will be the initial owner (or should a new owner identity be created and verified)?
2. How should the current `OPS` role map into the v1 permission model?
3. What is the merchant country/legal entity, desired currency, billing interval, tax treatment, target Pro price, and acceptable billing provider? These determine a viable recurring-payment provider.
4. What are the desired policies for payment-failure grace, cancellation effective date, and excess branches after a Pro-to-Free downgrade?
5. Is the current non-production MongoDB hosted and reachable from Render, or laptop-local? (No connection string is needed for this answer.)

## Immediate next step

Start with Phase 0: produce a collection/endpoint inventory and Foffee regression checklist, then make the Phase 1 frontend folder reorganisation as one reviewable, behavior-preserving change.
