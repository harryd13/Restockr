import { test, expect } from "@playwright/test";

const USERS = {
  brahmpuri: { email: "brahmpuri@foffee.in", password: "branch123" },
  ridhi: { email: "ridhi@foffee.in", password: "branch123" },
  rajapark: { email: "rajapark@foffee.in", password: "branch123" },
  admin: { email: "admin@foffee.in", password: "admin123" }
};

const ITEM_NAME = "Full Cream Milk 1L";
const CATEGORY_NAME = "Dairy";
const allowWeeklyAnyDay = String(process.env.E2E_WEEKLY_ALLOW_ANY_DAY || "").toLowerCase() === "true";

function isWeeklyWindow(date = new Date()) {
  const now = new Date(date);
  const day = now.getDay();
  if (day === 4) return true;
  if (day === 5 && now.getHours() < 12) return true;
  return false;
}

const weeklyEnabled = allowWeeklyAnyDay || isWeeklyWindow();

async function login(page, { email, password }) {
  await page.goto("/");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
}

async function logout(page) {
  const logoutButton = page.getByRole("button", { name: "Logout" });
  if (await logoutButton.isVisible()) {
    await logoutButton.click();
  }
}

async function openWeeklyRequest(page) {
  await page.getByRole("button", { name: "Weekly Request" }).click();
  await expect(page.getByRole("heading", { name: "Branch Weekly Request" })).toBeVisible();
}

async function startWeeklyIfNeeded(page) {
  const startButton = page.getByRole("button", { name: "Start weekly request" });
  if (await startButton.isVisible()) {
    await startButton.click();
  }
}

async function addItemToRequest(page, itemName, qty) {
  await page.getByRole("button", { name: CATEGORY_NAME }).click();
  const itemCard = page.locator(".item-card", { hasText: itemName });
  const plusButton = itemCard.getByRole("button", { name: "+" });
  for (let i = 0; i < qty; i += 1) {
    await plusButton.click();
  }

  const summarySection = page.locator("section", { hasText: "Current Week Summary" }).first();
  const summaryRow = summarySection.getByRole("row", { name: new RegExp(itemName) });
  await expect(summaryRow).toContainText(String(qty));
}

async function submitWeeklyRequest(page) {
  const submitButton = page.getByRole("button", { name: "Submit" });
  await expect(submitButton).toBeEnabled();
  await submitButton.click();
  await page.getByRole("button", { name: "Confirm Submit" }).click();
}

async function verifyLatestReceipt(page, receivedQty) {
  await openWeeklyRequest(page);
  const historySection = page.locator("section", { hasText: "History" }).first();
  await historySection.getByRole("button", { name: "View" }).first().click();
  const itemRow = historySection.getByRole("row", { name: new RegExp(ITEM_NAME) }).last();
  const receivedInput = itemRow.locator('input[type="number"]');
  await expect(receivedInput).toHaveValue("1");
  await receivedInput.fill(String(receivedQty));
  await historySection.getByRole("button", { name: "Verify Received Items" }).click();
  await expect(historySection.getByRole("cell", { name: "RECEIVED_PENDING_REVIEW" })).toBeVisible();
}

test.describe.serial("weekly request flow", () => {
  test("branch weekly request create, autosave, submit, and history", async ({ browser }) => {
    test.skip(!weeklyEnabled, "Weekly requests enabled only on Thursday or before 12pm Friday, or when E2E_WEEKLY_ALLOW_ANY_DAY=true.");
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page, USERS.brahmpuri);
    await openWeeklyRequest(page);

    const centralPurchaseTab = page.getByRole("button", { name: "Central Purchase" });
    await expect(centralPurchaseTab).toHaveCount(0);

    await startWeeklyIfNeeded(page);
    await addItemToRequest(page, ITEM_NAME, 1);

    await page.reload();
    await openWeeklyRequest(page);
    await expect(page.locator(".item-card", { hasText: ITEM_NAME })).toBeVisible();

    await submitWeeklyRequest(page);
    await expect(page.getByText("No weekly request started for this week.")).toBeVisible();

    const historySection = page.locator("section", { hasText: "History" }).first();
    await expect(historySection.getByRole("cell", { name: "SUBMITTED" })).toBeVisible();

    await logout(page);
    await context.close();
  });

  test("other branches can submit weekly requests", async ({ browser }) => {
    test.skip(!weeklyEnabled, "Weekly requests enabled only on Thursday or before 12pm Friday, or when E2E_WEEKLY_ALLOW_ANY_DAY=true.");
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page, USERS.ridhi);
    await openWeeklyRequest(page);
    await startWeeklyIfNeeded(page);
    await addItemToRequest(page, ITEM_NAME, 1);
    await submitWeeklyRequest(page);

    await logout(page);

    await login(page, USERS.rajapark);
    await openWeeklyRequest(page);
    await startWeeklyIfNeeded(page);
    await addItemToRequest(page, ITEM_NAME, 1);
    await submitWeeklyRequest(page);

    await logout(page);
    await context.close();
  });

  test("admin sees combined purchase queue and submits purchase", async ({ browser }) => {
    test.skip(!weeklyEnabled, "Weekly requests enabled only on Thursday or before 12pm Friday, or when E2E_WEEKLY_ALLOW_ANY_DAY=true.");
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page, USERS.admin);
    await page.getByRole("button", { name: "Central Purchase" }).click();
    await expect(page.getByRole("heading", { name: "Combined Purchase Request" })).toBeVisible();

    const pendingPill = page.locator(".stats-pill", { hasText: "Pending requests" });
    await expect(pendingPill).toContainText("3");

    const row = page.getByRole("row", { name: new RegExp(ITEM_NAME) });
    await expect(row.locator("td").nth(2)).toHaveText("3");

    const approvedInput = row.locator('input[type="number"]').first();
    await approvedInput.fill("2");

    await page.getByRole("button", { name: "Submit Purchase Request" }).click();
    await page.getByRole("button", { name: "Submit" }).click();

    await expect(page.getByText("No pending purchase requests.")).toBeVisible();

    await logout(page);
    await context.close();
  });

  test("branches verify receipts and admin closes distributions", async ({ browser }) => {
    test.skip(!weeklyEnabled, "Weekly requests enabled only on Thursday or before 12pm Friday, or when E2E_WEEKLY_ALLOW_ANY_DAY=true.");

    const branchReceipts = [
      [USERS.brahmpuri, 1],
      [USERS.ridhi, 1],
      [USERS.rajapark, 1]
    ];
    for (const [user, receivedQty] of branchReceipts) {
      const branchContext = await browser.newContext();
      const branchPage = await branchContext.newPage();
      await login(branchPage, user);
      await verifyLatestReceipt(branchPage, receivedQty);
      await logout(branchPage);
      await branchContext.close();
    }

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    await login(adminPage, USERS.admin);
    await adminPage.getByRole("button", { name: "Distribution" }).click();
    await expect(adminPage.getByRole("heading", { name: "Distribution Run" })).toBeVisible();
    await expect(adminPage.getByText(/Combined branch receipts exceed initial inventory/)).toBeVisible();

    const reasonInput = adminPage.getByPlaceholder("Reason required");
    await expect(reasonInput).toHaveCount(1);
    await expect(reasonInput).toHaveValue("Delivered Qty > Initial");

    while (await adminPage.getByRole("button", { name: "Close Distribution" }).count()) {
      const openCount = await adminPage.getByRole("button", { name: "Close Distribution" }).count();
      await adminPage.getByRole("button", { name: "Close Distribution" }).first().click();
      const dialog = adminPage.getByRole("dialog");
      await dialog.getByRole("button", { name: "Close Distribution" }).click();
      await expect(dialog).toBeHidden();
      await expect(adminPage.getByRole("button", { name: "Close Distribution" })).toHaveCount(openCount - 1);
    }
    await expect(adminPage.getByText("No pending distributions.")).toBeVisible();

    await logout(adminPage);
    await adminContext.close();

    const finalBranchContext = await browser.newContext();
    const branchPage = await finalBranchContext.newPage();
    await login(branchPage, USERS.brahmpuri);
    await openWeeklyRequest(branchPage);
    const historySection = branchPage.locator("section", { hasText: "History" }).first();
    await expect(historySection.getByRole("cell", { name: "DISTRIBUTED" })).toBeVisible();

    await logout(branchPage);
    await finalBranchContext.close();
  });
});
