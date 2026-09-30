export function createCashReportingService(dependencies) {
  const { getDb, COLLECTIONS, getInitialCashBalancesSetting, getDueBalanceSetting, applyPaymentMethodAmount,
    getExpenseLogBusinessDate, summarizeExpenseLogsByBranch, getPreviousDateInIST } = dependencies;
  const db = { collection: (...args) => getDb().collection(...args) };

  function buildCashSummaryRows(branches = [], tallies = [], expenseSummaryMap = new Map(), adminExpenseSummaryMap = new Map()) {
    const tallyMap = new Map(tallies.map((tally) => [tally.branchId, tally]));
    return branches.map((branch) => {
      const tally = tallyMap.get(branch.id);
      const expenseSummary = expenseSummaryMap.get(branch.id) || tally?.expenseSummary || { cash: 0, online: 0, total: 0, other: 0 };
      const adminExpenseSummary = adminExpenseSummaryMap.get(branch.id) || { cash: 0, online: 0, total: 0, other: 0 };
      const onlineSales = Number(tally?.onlineSales || 0);
      const cashSales = Number(tally?.cashSales || 0);
      const onlineExpense = Number(expenseSummary.online || 0);
      const cashExpense = Number(expenseSummary.cash || 0);
      const adminOnlineExpense = Number(adminExpenseSummary.online || 0);
      const adminCashExpense = Number(adminExpenseSummary.cash || 0);
      const onlinePresent = Number(tally?.onlinePresent || 0);
      const cashPresent = Number(tally?.cashPresent || 0);
      const dueAmount = Number(tally?.dueAmount || 0);
      const totalCalculationDiscrepancy =
        cashSales + onlineSales - (cashExpense + onlineExpense + cashPresent + onlinePresent + dueAmount);
      return {
        branchId: branch.id,
        branchName: branch.name,
        submitted: !!tally,
        onlineSales,
        cashSales,
        onlineExpense,
        cashExpense,
        adminOnlineExpense,
        adminCashExpense,
        onlinePresent,
        cashPresent,
        dueAmount,
        calculationDiscrepancyCash: cashSales - (cashExpense + cashPresent),
        calculationDiscrepancyOnline: onlineSales - (onlineExpense + onlinePresent),
        totalCalculationDiscrepancy
      };
    });
  }
  
  function summarizeCashRows(rows = []) {
    return rows.reduce(
      (acc, row) => {
        acc.onlineSales += Number(row.onlineSales || 0);
        acc.cashSales += Number(row.cashSales || 0);
        acc.onlineExpense += Number(row.onlineExpense || 0);
        acc.cashExpense += Number(row.cashExpense || 0);
        acc.onlinePresent += Number(row.onlinePresent || 0);
        acc.cashPresent += Number(row.cashPresent || 0);
        acc.dueAmount += Number(row.dueAmount || 0);
        acc.submittedBranches += row.submitted ? 1 : 0;
        return acc;
      },
      {
        onlineSales: 0,
        cashSales: 0,
        onlineExpense: 0,
        cashExpense: 0,
        onlinePresent: 0,
        cashPresent: 0,
        dueAmount: 0,
        submittedBranches: 0
      }
    );
  }
  
  async function getCashAccountsSummary({ excludeDate = "" } = {}) {
    const balanceConfig = await getInitialCashBalancesSetting();
    const dueConfig = await getDueBalanceSetting();
    const reportFilter = excludeDate ? { date: { $ne: excludeDate } } : {};
    const combinedPurchaseFilter = excludeDate ? { date: { $ne: excludeDate } } : {};
    const dueClearanceFilter = excludeDate ? { date: { $ne: excludeDate } } : {};
    const [reports, adminExpenseLogs, dailyExpenseLogs, combinedPurchaseLogs, dueClearanceLogs] = await Promise.all([
      db.collection(COLLECTIONS.CASH_REPORTS).find(reportFilter).toArray(),
      db.collection(COLLECTIONS.EXPENSE_TICKET_LOGS).find({ status: { $ne: "DELETED" }, category: { $ne: "Branch Expense" } }).toArray(),
      db.collection(COLLECTIONS.EXPENSE_LOGS).find({}).toArray(),
      db.collection(COLLECTIONS.COMBINED_PURCHASE_LOGS).find(combinedPurchaseFilter).toArray(),
      db.collection(COLLECTIONS.DUE_CLEARANCE_LOGS).find(dueClearanceFilter).toArray()
    ]);
  
    const filteredReports = reports.filter((report) => {
      if (balanceConfig.mode === "rebase") {
        return !balanceConfig.resetAt || String(report?.verifiedAt || "") >= balanceConfig.resetAt;
      }
      return !balanceConfig.effectiveDate || String(report?.date || "") >= balanceConfig.effectiveDate;
    });
    const filteredAdminExpenseLogs = adminExpenseLogs.filter((log) => {
      if (balanceConfig.mode === "rebase") {
        return !balanceConfig.resetAt || String(log?.createdAt || "") >= balanceConfig.resetAt;
      }
      return !balanceConfig.effectiveDate || String(log?.date || "") >= balanceConfig.effectiveDate;
    });
    const filteredCombinedPurchaseLogs = combinedPurchaseLogs.filter((log) => {
      if (balanceConfig.mode === "rebase") {
        return !balanceConfig.resetAt || String(log?.createdAt || "") >= balanceConfig.resetAt;
      }
      return !balanceConfig.effectiveDate || String(log?.date || "") >= balanceConfig.effectiveDate;
    });
    const filteredDueClearanceLogs = dueClearanceLogs.filter((log) => !dueConfig.resetAt || String(log?.createdAt || "") >= dueConfig.resetAt);
  
    const reviewedReportKeys = new Set(
      filteredReports
        .filter((report) => report?.branchId && report?.date)
        .map((report) => `${report.branchId}:${report.date}`)
    );
  
    const accounts = { cashAccount: balanceConfig.cashAccount, onlineAccount: balanceConfig.onlineAccount, dueAccount: dueConfig.dueAccount };
  
    filteredReports.forEach((report) => {
      applyPaymentMethodAmount(accounts, "Cash", report?.verifiedCashPresent, 1);
      applyPaymentMethodAmount(accounts, "UPI", report?.verifiedOnlinePresent, 1);
      if (!dueConfig.resetAt || String(report?.verifiedAt || "") >= dueConfig.resetAt) {
        accounts.dueAccount += Number(report?.totals?.dueAmount || 0);
      }
    });
  
    filteredAdminExpenseLogs.forEach((log) => {
      applyPaymentMethodAmount(accounts, log?.paymentMethod, log?.amount, -1);
    });
  
    filteredCombinedPurchaseLogs.forEach((log) => {
      applyPaymentMethodAmount(accounts, "Cash", log?.cashAmount, -1);
      applyPaymentMethodAmount(accounts, "UPI", log?.onlineAmount, -1);
    });
  
    filteredDueClearanceLogs.forEach((log) => {
      applyPaymentMethodAmount(accounts, log?.paymentMethod, log?.amount, 1);
      accounts.dueAccount -= Number(log?.amount || 0);
    });
  
    dailyExpenseLogs.forEach((log) => {
      const reportKey = `${String(log?.branchId || "").trim()}:${getExpenseLogBusinessDate(log)}`;
      if (!reviewedReportKeys.has(reportKey)) return;
      if (balanceConfig.mode === "base_date" && balanceConfig.effectiveDate && getExpenseLogBusinessDate(log) < balanceConfig.effectiveDate) return;
      applyPaymentMethodAmount(accounts, log?.paymentMethod, log?.total, -1);
    });
  
    accounts.dueAccount = Math.max(0, Number(accounts.dueAccount || 0));
    return accounts;
  }
  
  async function sendSlackWebhook(message) {
    const webhookUrl = String(process.env.WEBHOOK_URL || "").trim();
    if (!webhookUrl) return;
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message })
      });
    } catch (err) {
      console.error("Slack webhook failed", err?.message || err);
    }
  }
  
  async function sendDailyWebhook(message) {
    const webhookUrl = String(process.env.DAILYHOOK || "").trim();
    if (!webhookUrl) return;
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message })
      });
    } catch (err) {
      console.error("Daily webhook failed", err?.message || err);
    }
  }
  
  async function sendCashReportWebhook(message) {
    const webhookUrl = String(process.env.CASH_REPORT_WEBHOOK_URL || "").trim();
    if (!webhookUrl) return;
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message })
      });
    } catch (err) {
      console.error("Cash report webhook failed", err?.message || err);
    }
  }
  
  function formatMoney(value) {
    return `Rs ${Math.round(Number(value || 0))}`;
  }
  
  function getCashReportPageLink() {
    const configured =
      String(process.env.CASH_REPORT_PAGE_URL || "").trim() ||
      String(process.env.FRONTEND_URL || "").trim() ||
      String(process.env.APP_URL || "").trim();
    if (configured) return configured;
    return "http://localhost:5173";
  }
  
  function buildSlackCashDailyMessage(date, reports = [], balances = { onlineAccount: 0, cashAccount: 0, dueAccount: 0 }) {
    const sortedReports = [...reports].sort((a, b) => String(a.branchName || a.branchId || "").localeCompare(String(b.branchName || b.branchId || "")));
    const gross = sortedReports.reduce(
      (acc, report) => {
        acc.onlineSales += Number(report?.totals?.onlineSales || 0);
        acc.cashSales += Number(report?.totals?.cashSales || 0);
        acc.onlineExpense += Number(report?.totals?.onlineExpense || 0);
        acc.cashExpense += Number(report?.totals?.cashExpense || 0);
        acc.onlinePresent += Number(report?.totals?.onlinePresent || 0);
        acc.cashPresent += Number(report?.totals?.cashPresent || 0);
        acc.dueAmount += Number(report?.totals?.dueAmount || 0);
        acc.totalDiscrepancy += Number(report?.totalCalculationDiscrepancy || 0);
        acc.onlineVerifyDiscrepancy += Number(report?.verificationDiscrepancyOnline || 0);
        acc.cashVerifyDiscrepancy += Number(report?.verificationDiscrepancyCash || 0);
        return acc;
      },
      {
        onlineSales: 0,
        cashSales: 0,
        onlineExpense: 0,
        cashExpense: 0,
        onlinePresent: 0,
        cashPresent: 0,
        dueAmount: 0,
        totalDiscrepancy: 0,
        onlineVerifyDiscrepancy: 0,
        cashVerifyDiscrepancy: 0
      }
    );
  
    const formatLine = (label, onlineValue, cashValue) =>
      `${label.padEnd(6)} O ${formatMoney(onlineValue).padEnd(10)} C ${formatMoney(cashValue)}`;
  
    const branchSections = sortedReports.map((report) => {
      const verificationStatus = report?.verifiedAt
        ? report?.hasDiscrepancy
          ? report?.resolutionReason
            ? `Verified (resolved: ${report.resolutionReason})`
            : "Verified with discrepancy"
          : "Verified"
        : "Pending verification";
      return [
        `*${report.branchName || report.branchId}*`,
        "```",
        formatLine("Sale", report?.totals?.onlineSales, report?.totals?.cashSales),
        formatLine("Exp", report?.totals?.onlineExpense, report?.totals?.cashExpense),
        formatLine("Bal", report?.totals?.onlinePresent, report?.totals?.cashPresent),
        `Due    ${formatMoney(report?.totals?.dueAmount).padEnd(10)} Total Disc ${formatMoney(report?.totalCalculationDiscrepancy)}`,
        formatLine("VDisc", report?.verificationDiscrepancyOnline, report?.verificationDiscrepancyCash),
        "```",
        `_Status: ${verificationStatus}_`
      ].join("\n");
    });
  
    const grossSection = [
      "*Gross*",
      "```",
      formatLine("Sale", gross.onlineSales, gross.cashSales),
      formatLine("Exp", gross.onlineExpense, gross.cashExpense),
      formatLine("Bal", gross.onlinePresent, gross.cashPresent),
      `Due    ${formatMoney(gross.dueAmount).padEnd(10)} Total Disc ${formatMoney(gross.totalDiscrepancy)}`,
      formatLine("VDisc", gross.onlineVerifyDiscrepancy, gross.cashVerifyDiscrepancy),
      "```"
    ].join("\n");
  
    const balanceSection = [
      "*Balances*",
      "```",
      `Online Balance  ${formatMoney(balances.onlineAccount)}`,
      `Cash Balance    ${formatMoney(balances.cashAccount)}`,
      `Due Balance     ${formatMoney(balances.dueAccount)}`,
      "```"
    ].join("\n");
  
    return [
      `*Daily Cash Report*  ${date}`,
      "_Legend: O = Online, C = Cash, Bal = Reported Balance, Due = Credit Sales_",
      `Cash Reports: ${getCashReportPageLink()} (open the Cash Reports tab)`,
      ...branchSections,
      grossSection,
      balanceSection
    ].join("\n");
  }
  
  async function buildCashDailyReportsForDate(date) {
    const branches = await db.collection(COLLECTIONS.BRANCHES).find({}).sort({ name: 1 }).toArray();
    if (!branches.length) return [];
    const branchIds = branches.map((branch) => branch.id);
    const tallies = await db.collection(COLLECTIONS.CASH_TALLIES).find({ date, branchId: { $in: branchIds } }).toArray();
    const expenseLogs = await db
      .collection(COLLECTIONS.EXPENSE_TICKET_LOGS)
      .find({ date, branchId: { $in: branchIds }, status: { $ne: "DELETED" } })
      .toArray();
    const reports = await db.collection(COLLECTIONS.CASH_REPORTS).find({ date, branchId: { $in: branchIds } }).toArray();
    const expenseSummaryMap = summarizeExpenseLogsByBranch(expenseLogs.filter((log) => String(log?.category || "").trim() === "Branch Expense"));
    const adminExpenseSummaryMap = summarizeExpenseLogsByBranch(expenseLogs.filter((log) => String(log?.category || "").trim() !== "Branch Expense"));
    const reportMap = new Map(reports.map((report) => [report.branchId, report]));
    return buildCashSummaryRows(branches, tallies, expenseSummaryMap, adminExpenseSummaryMap).map((row) => {
      const report = reportMap.get(row.branchId);
      return {
        branchId: row.branchId,
        branchName: row.branchName,
        totals: {
          onlineSales: Number(row.onlineSales || 0),
          cashSales: Number(row.cashSales || 0),
          onlineExpense: Number(row.onlineExpense || 0),
          cashExpense: Number(row.cashExpense || 0),
          onlinePresent: Number(row.onlinePresent || 0),
          cashPresent: Number(row.cashPresent || 0),
          dueAmount: Number(row.dueAmount || 0)
        },
        calculationDiscrepancyCash: Number(row.calculationDiscrepancyCash || 0),
        calculationDiscrepancyOnline: Number(row.calculationDiscrepancyOnline || 0),
        totalCalculationDiscrepancy: Number(report?.totalCalculationDiscrepancy ?? row.totalCalculationDiscrepancy ?? 0),
        verificationDiscrepancyCash: Number(report?.verificationDiscrepancyCash || 0),
        verificationDiscrepancyOnline: Number(report?.verificationDiscrepancyOnline || 0),
        verifiedAt: report?.verifiedAt || "",
        hasDiscrepancy:
          report?.verifiedAt
            ? !!report?.hasDiscrepancy
            : Number(row.calculationDiscrepancyCash || 0) !== 0 || Number(row.calculationDiscrepancyOnline || 0) !== 0 || Number(row.totalCalculationDiscrepancy || 0) !== 0,
        resolutionReason: report?.resolutionReason || ""
      };
    });
  }
  
  async function sendCashDailyReportForDate(date, { markAutoSent = false } = {}) {
    const reports = await buildCashDailyReportsForDate(date);
    if (!reports.length) {
      return { ok: false, date, sent: false, reason: "No branches found" };
    }
    const balances = await getCashAccountsSummary();
    const message = buildSlackCashDailyMessage(date, reports, balances);
    await sendCashReportWebhook(message);
    if (markAutoSent) {
      await db.collection(COLLECTIONS.SETTINGS).updateOne(
        { key: `cashReportAutoSent:${date}` },
        { $set: { key: `cashReportAutoSent:${date}`, value: true, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
    }
    return { ok: true, date, sent: true };
  }
  
  async function runScheduledCashReportIfDue() {
    const date = getPreviousDateInIST(new Date());
    const key = `cashReportAutoSent:${date}`;
    const existing = await db.collection(COLLECTIONS.SETTINGS).findOne({ key });
    if (existing?.value) return;
    await sendCashDailyReportForDate(date, { markAutoSent: true });
  }
  
  function getMsUntilNextIstSevenAM(now = new Date()) {
    const shifted = new Date(now.getTime() + 330 * 60 * 1000);
    const next = new Date(shifted);
    next.setUTCHours(7, 0, 0, 0);
    if (shifted >= next) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return Math.max(1000, next.getTime() - shifted.getTime());
  }
  
  function scheduleCashReportJob() {
    const delay = getMsUntilNextIstSevenAM(new Date());
    setTimeout(async () => {
      try {
        await runScheduledCashReportIfDue();
      } catch (err) {
        console.error("Scheduled cash report failed", err?.message || err);
      } finally {
        scheduleCashReportJob();
      }
    }, delay);
  }
  
  
  return { buildCashSummaryRows, summarizeCashRows, getCashAccountsSummary, sendSlackWebhook, sendDailyWebhook,
    sendCashReportWebhook, formatMoney, getCashReportPageLink, buildSlackCashDailyMessage,
    buildCashDailyReportsForDate, sendCashDailyReportForDate, scheduleCashReportJob };
}

