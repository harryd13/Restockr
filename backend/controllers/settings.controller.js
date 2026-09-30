export function registerSettingsRoutesController(context) {
  const { app, repository, authMiddleware, ensureAdmin, isValidReportStartDate, getWeeklyOverrideSetting, getReportStartDateSetting, getInitialCashBalancesSetting, getDueBalanceSetting } = context;

  // --- Master data ---
  app.get("/api/settings/weekly-override", authMiddleware, async (req, res) => {
    const weeklyOverride = await getWeeklyOverrideSetting();
    res.json({ weeklyOverride });
  });
  
  app.get("/api/settings/report-start-date", authMiddleware, async (req, res) => {
    const reportStartDate = await getReportStartDateSetting(req.user?.id);
    res.json({ reportStartDate });
  });
  
  app.get("/api/admin/settings/initial-cash-balances", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const balances = await getInitialCashBalancesSetting();
    res.json(balances);
  });
  
  app.get("/api/admin/settings/due-balance", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const dueBalance = await getDueBalanceSetting();
    res.json(dueBalance);
  });
  
  app.post("/api/settings/report-start-date", authMiddleware, async (req, res) => {
    const reportStartDate = String(req.body?.reportStartDate || "").trim();
    if (reportStartDate && !isValidReportStartDate(reportStartDate)) {
      return res.status(400).json({ message: "reportStartDate must be YYYY-MM-DD" });
    }
    const settingsCol = repository.settings();
    const key = `reportStartDate:${req.user?.id}`;
    if (!reportStartDate) {
      await settingsCol.deleteOne({ key });
      return res.json({ reportStartDate: "" });
    }
    await settingsCol.updateOne(
      { key },
      { $set: { key, value: reportStartDate, updatedAt: new Date().toISOString(), updatedBy: req.user?.id } },
      { upsert: true }
    );
    res.json({ reportStartDate });
  });
  
  app.post("/api/admin/settings/initial-cash-balances", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const mode = String(req.body?.mode || "base_date").trim() === "rebase" ? "rebase" : "base_date";
    const cashAccount = Number(req.body?.cashAccount);
    const onlineAccount = Number(req.body?.onlineAccount);
    const effectiveDate = String(req.body?.effectiveDate || "").trim();
    if (!Number.isFinite(cashAccount) || cashAccount < 0) {
      return res.status(400).json({ message: "Cash account must be a valid non-negative number" });
    }
    if (!Number.isFinite(onlineAccount) || onlineAccount < 0) {
      return res.status(400).json({ message: "Online account must be a valid non-negative number" });
    }
    if (mode === "base_date" && !isValidReportStartDate(effectiveDate)) {
      return res.status(400).json({ message: "Effective date must be YYYY-MM-DD for opening balance mode" });
    }
    const resetAt = mode === "rebase" ? new Date().toISOString() : "";
    await repository.settings().updateOne(
      { key: "initialCashBalances" },
      {
        $set: {
          key: "initialCashBalances",
          value: { mode, cashAccount, onlineAccount, effectiveDate: mode === "base_date" ? effectiveDate : "", resetAt },
          updatedAt: new Date().toISOString(),
          updatedBy: req.user.id
        }
      },
      { upsert: true }
    );
    res.json({ mode, cashAccount, onlineAccount, effectiveDate: mode === "base_date" ? effectiveDate : "", resetAt });
  });
  
  app.post("/api/admin/settings/due-balance", authMiddleware, async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const mode = String(req.body?.mode || "hard_zero").trim() === "set_value" ? "set_value" : "hard_zero";
    const dueAccount = mode === "set_value" ? Number(req.body?.dueAccount) : 0;
    if (!Number.isFinite(dueAccount) || dueAccount < 0) {
      return res.status(400).json({ message: "Due balance must be a valid non-negative number" });
    }
    const resetAt = new Date().toISOString();
    await repository.settings().updateOne(
      { key: "dueBalanceConfig" },
      {
        $set: {
          key: "dueBalanceConfig",
          value: { dueAccount, resetAt },
          updatedAt: new Date().toISOString(),
          updatedBy: req.user.id
        }
      },
      { upsert: true }
    );
    res.json({ mode, dueAccount, resetAt });
  });
}







