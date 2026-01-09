# Central Repository Use Cases

This document captures the current Central Inventory flows and how they behave today.

## Flow 1: Branch weekly request → Central inventory → Combined purchase → Distribution
- Branch creates a Weekly Request and submits it.
- Central Inventory checks on-hand stock:
  - If stock is sufficient, distribution is created directly from inventory.
  - If stock is insufficient, a Combined Purchase is created for shortfall.
- Admin reviews Combined Purchase:
  - Can edit approved quantity, price, and availability per item.
  - If an item is marked UNAVAILABLE, it will still appear in Distribution as a greyed row for that branch.
- When Combined Purchase is submitted:
  - Approved quantities are added to Central Inventory.
  - Distribution runs are created for each branch request (only for items available).
- Admin finalizes Distribution:
  - Approved quantities are deducted from Central Inventory.
  - Distribution logs are created for Reports.
  - Unavailable items remain visible in Distribution Logs as greyed rows under each branch.

## Flow 2: Central purchase without branch demand
- Admin can add items directly in Central Purchase and submit.
- This creates a Combined Purchase log and increases Central Inventory.
- Distribution is only created if there are pending branch requests.

## Flow 3: Central inventory visibility
- Central Inventory view shows only items with on-hand > 0.
- Total inventory value (sum of on-hand * unit price) is displayed.

## Flow 4: Distribution
- Distribution shows all pending branch requests (no dropdown selection).
- Admin can save each branch section and finalize the whole distribution.
- Approved quantities are capped by available central stock (inventory-safe).

## Logs & Reports
- Distribution Logs show finalized distribution runs (branch sections).
- Expense Logs show non-request expenses (Admin Level and Branch Level).
- Branch Expenses table aggregates:
  - Weekly Distribution
  - Daily Sheet
  - Misc Expense
  - Branch Level
  - Admin Level

## Notifications (Branch level expense)
- When a Branch Level expense is created, a Slack webhook can be triggered.
- This posts branch name, date, amount, payment method, and items list.

## Clarifications to confirm
- Should UNAVAILABLE items ever show in Distribution as zero-qty rows, or always be hidden? (Current behavior: hidden.)
