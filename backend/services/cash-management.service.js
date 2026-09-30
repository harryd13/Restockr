export function createCashManagementService(context) {
  const { repository, uuidv4, ensureAdmin, formatDateLocal, getCurrentDateInIST, getPreviousDateInIST, summarizeBranchExpenses, summarizeExpenseLogsByBranch, mergeExpenseSummaryMaps, normalizeBranchIds, getExpenseLogBusinessDate, buildCashSummaryRows, summarizeCashRows, getCashAccountsSummary, sendCashDailyReportForDate } = context;
  return {
    handle1: async (req, res) => {
    if (req.user?.role !== "BRANCH") {
      return res.status(403).json({ message: "Branch role required" });
    }
  
    const date = formatDateLocal(new Date());
    const tally = await repository.cashTallies().findOne({ branchId: req.user.branchId, date });
    const expenseLogs = await repository.expenseTicketLogs()
      .find({ branchId: req.user.branchId, category: "Branch Expense", date, status: { $ne: "DELETED" } })
      .sort({ createdAt: -1 })
      .toArray();
  
    res.json({
      date,
      tally: tally || null,
      expenseSummary: summarizeBranchExpenses(expenseLogs)
    });
  },

    handle2: async (req, res) => {
    if (req.user?.role !== "BRANCH") {
      return res.status(403).json({ message: "Branch role required" });
    }
  
    const date = formatDateLocal(new Date());
    const onlineSales = Number(req.body?.onlineSales);
    const cashSales = Number(req.body?.cashSales);
    const cashPresent = Number(req.body?.cashPresent);
    const onlinePresent = Number(req.body?.onlinePresent);
    const dueAmount = Number(req.body?.dueAmount);
    const values = { onlineSales, cashSales, cashPresent, onlinePresent, dueAmount };
    const hasInvalidValue = Object.values(values).some((value) => !Number.isFinite(value) || value < 0);
    if (hasInvalidValue) {
      return res.status(400).json({ message: "All fields must be valid numbers greater than or equal to zero" });
    }
  
    const expenseLogs = await repository.expenseTicketLogs()
      .find({ branchId: req.user.branchId, category: "Branch Expense", date, status: { $ne: "DELETED" } })
      .toArray();
    const expenseSummary = summarizeBranchExpenses(expenseLogs);
    const expectedCash = cashSales - expenseSummary.cash;
    const expectedOnline = onlineSales - expenseSummary.online;
    const varianceCash = cashPresent - expectedCash;
    const varianceOnline = onlinePresent - expectedOnline;
    const nowIso = new Date().toISOString();
  
    const doc = {
      branchId: req.user.branchId,
      date,
      onlineSales,
      cashSales,
      cashPresent,
      onlinePresent,
      dueAmount,
      expenseSummary,
      expectedCash,
      expectedOnline,
      varianceCash,
      varianceOnline,
      updatedAt: nowIso,
      updatedBy: req.user.id
    };
  
    const existing = await repository.cashTallies().findOne({ branchId: req.user.branchId, date });
    if (!existing) {
      doc.id = uuidv4();
      doc.createdAt = nowIso;
      doc.createdBy = req.user.id;
      await repository.cashTallies().insertOne(doc);
    } else {
      await repository.cashTallies().updateOne(
        { branchId: req.user.branchId, date },
        { $set: doc }
      );
    }
  
    const saved = await repository.cashTallies().findOne({ branchId: req.user.branchId, date });
    res.status(existing ? 200 : 201).json({ ok: true, tally: saved, expenseSummary });
  },

    handle3: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
  
    const date = String(req.query.date || formatDateLocal(new Date())).trim();
    const branches = await repository.branches().find({}).sort({ name: 1 }).toArray();
    const allBranchIds = branches.map((branch) => branch.id);
    const requestedBranchIds = normalizeBranchIds(req.query.branchIds);
    const selectedBranchIds = requestedBranchIds.length ? requestedBranchIds : allBranchIds;
    const selectedBranches = branches.filter((branch) => selectedBranchIds.includes(branch.id));
    const tallies = selectedBranchIds.length
      ? await repository.cashTallies().find({ date, branchId: { $in: selectedBranchIds } }).toArray()
      : [];
    const [expenseTicketLogs, dailyExpenseLogs] = selectedBranchIds.length
      ? await Promise.all([
          repository.expenseTicketLogs()
            .find({ date, branchId: { $in: selectedBranchIds }, status: { $ne: "DELETED" } })
            .toArray(),
          repository.expenseLogs()
            .find({ branchId: { $in: selectedBranchIds } })
            .toArray()
        ])
      : [[], []];
    const filteredDailyExpenseLogs = dailyExpenseLogs.filter((log) => getExpenseLogBusinessDate(log) === date);
    const pendingTicketLogs = expenseTicketLogs.filter((log) => String(log?.sourceType || "").trim() === "PENDING_SETTLEMENT");
    const expenseSummaryMap = mergeExpenseSummaryMaps(
      summarizeExpenseLogsByBranch(expenseTicketLogs.filter((log) => String(log?.category || "").trim() === "Branch Expense")),
      summarizeExpenseLogsByBranch(
        filteredDailyExpenseLogs.map((log) => ({
          branchId: log.branchId,
          paymentMethod: log.paymentMethod,
          amount: log.total
        }))
      )
    );
    const adminExpenseSummaryMap = summarizeExpenseLogsByBranch(
      expenseTicketLogs.filter((log) => String(log?.category || "").trim() !== "Branch Expense")
    );
    const reports = selectedBranchIds.length
      ? await repository.cashReports().find({ date, branchId: { $in: selectedBranchIds } }).toArray()
      : [];
    const combinedPurchaseLogs = await repository.combinedPurchaseLogs().find({ date }).sort({ createdAt: -1 }).toArray();
    const reportMap = new Map(reports.map((report) => [report.branchId, report]));
    const rows = buildCashSummaryRows(selectedBranches, tallies, expenseSummaryMap, adminExpenseSummaryMap).map((row) => {
      const report = reportMap.get(row.branchId);
      return {
        ...row,
        report: report || null
      };
    });
    const totals = summarizeCashRows(rows);
    const accounts = await getCashAccountsSummary();
    const combinedPurchaseSummary = combinedPurchaseLogs.reduce(
      (acc, log) => {
        acc.cashAmount += Number(log?.cashAmount || 0);
        acc.onlineAmount += Number(log?.onlineAmount || 0);
        acc.total += Number(log?.total || 0);
        acc.count += 1;
        return acc;
      },
      { cashAmount: 0, onlineAmount: 0, total: 0, count: 0 }
    );
    const pendingTicketSummary = pendingTicketLogs.reduce(
      (acc, log) => {
        const amount = Number(log?.amount || 0);
        const paymentMethod = String(log?.paymentMethod || "").trim();
        if (paymentMethod === "Cash") acc.cashAmount += amount;
        if (paymentMethod === "UPI") acc.onlineAmount += amount;
        acc.total += amount;
        acc.count += 1;
        return acc;
      },
      { cashAmount: 0, onlineAmount: 0, total: 0, count: 0 }
    );
  
    res.json({
      date,
      branches,
      selectedBranchIds,
      rows,
      totals,
      accounts,
      combinedPurchaseSummary,
      pendingTicketSummary
    });
  },

    handle4: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const accounts = await getCashAccountsSummary();
    res.json(accounts);
  },

    handle5: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const amount = Number(req.body?.amount);
    const paymentMethod = String(req.body?.paymentMethod || "").trim();
    const note = String(req.body?.note || "").trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Amount must be greater than zero" });
    }
    if (paymentMethod !== "Cash" && paymentMethod !== "UPI") {
      return res.status(400).json({ message: "Mode must be Cash or UPI" });
    }
    const accounts = await getCashAccountsSummary();
    if (amount > Number(accounts?.dueAccount || 0)) {
      return res.status(400).json({ message: "Clear amount cannot exceed current due balance" });
    }
    const nowIso = new Date().toISOString();
    const date = getCurrentDateInIST();
    await repository.dueClearanceLogs().insertOne({
      id: uuidv4(),
      amount,
      paymentMethod,
      note,
      date,
      createdAt: nowIso,
      createdBy: req.user.id
    });
    const updatedAccounts = await getCashAccountsSummary();
    res.status(201).json({ ok: true, accounts: updatedAccounts });
  },

    handle6: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
  
    const date = String(req.body?.date || formatDateLocal(new Date())).trim();
    const branchId = String(req.body?.branchId || "").trim();
    const verifiedCashPresent = Number(req.body?.verifiedCashPresent);
    const verifiedOnlinePresent = Number(req.body?.verifiedOnlinePresent);
    const remarks = String(req.body?.remarks || "").trim();
    const resolutionReason = String(req.body?.resolutionReason || "").trim();
  
    if (!date) return res.status(400).json({ message: "Date is required" });
    if (!branchId) return res.status(400).json({ message: "Branch is required" });
    if (!Number.isFinite(verifiedCashPresent) || verifiedCashPresent < 0) {
      return res.status(400).json({ message: "Present cash verified must be a valid number" });
    }
    if (!Number.isFinite(verifiedOnlinePresent) || verifiedOnlinePresent < 0) {
      return res.status(400).json({ message: "Present online verified must be a valid number" });
    }
  
    const branch = await repository.branches().findOne({ id: branchId });
    if (!branch) return res.status(400).json({ message: "Selected branch is invalid" });
  
    const tally = await repository.cashTallies().findOne({ date, branchId });
    if (!tally) {
      return res.status(400).json({ message: "Selected branch has not submitted cash management for this date" });
    }
  
    const [expenseTicketLogs, dailyExpenseLogs] = await Promise.all([
      repository.expenseTicketLogs()
        .find({ date, branchId, status: { $ne: "DELETED" } })
        .toArray(),
      repository.expenseLogs()
        .find({ branchId })
        .toArray()
    ]);
    const filteredDailyExpenseLogs = dailyExpenseLogs.filter((log) => getExpenseLogBusinessDate(log) === date);
    const expenseSummaryMap = mergeExpenseSummaryMaps(
      summarizeExpenseLogsByBranch(expenseTicketLogs.filter((log) => String(log?.category || "").trim() === "Branch Expense")),
      summarizeExpenseLogsByBranch(
        filteredDailyExpenseLogs.map((log) => ({
          branchId: log.branchId,
          paymentMethod: log.paymentMethod,
          amount: log.total
        }))
      )
    );
    const adminExpenseSummaryMap = summarizeExpenseLogsByBranch(
      expenseTicketLogs.filter((log) => String(log?.category || "").trim() !== "Branch Expense")
    );
    const row = buildCashSummaryRows([branch], [tally], expenseSummaryMap, adminExpenseSummaryMap)[0];
    const calculationDiscrepancyCash = Number(row.calculationDiscrepancyCash || 0);
    const calculationDiscrepancyOnline = Number(row.calculationDiscrepancyOnline || 0);
    const totalCalculationDiscrepancy = Number(row.totalCalculationDiscrepancy || 0);
    const verificationDiscrepancyCash = Number(row.cashPresent || 0) - verifiedCashPresent;
    const verificationDiscrepancyOnline = Number(row.onlinePresent || 0) - verifiedOnlinePresent;
    const hasDiscrepancy =
      calculationDiscrepancyCash !== 0 ||
      calculationDiscrepancyOnline !== 0 ||
      totalCalculationDiscrepancy !== 0 ||
      verificationDiscrepancyCash !== 0 ||
      verificationDiscrepancyOnline !== 0;
    if (hasDiscrepancy && !resolutionReason) {
      return res.status(400).json({ message: "Resolve discrepancy reason is required before verification" });
    }
    const verifiedAt = new Date().toISOString();
    const existingReport = await repository.cashReports().findOne({ branchId, date });
    const accountsBefore = await getCashAccountsSummary();
    const baseCashAccount = accountsBefore.cashAccount - Number(existingReport?.verifiedCashPresent || 0);
    const baseOnlineAccount = accountsBefore.onlineAccount - Number(existingReport?.verifiedOnlinePresent || 0);
    const reviewedTicketCashExpense = filteredDailyExpenseLogs
      .filter((log) => String(log?.paymentMethod || "").trim() === "Cash")
      .reduce((sum, log) => sum + Number(log?.total || 0), 0);
    const reviewedTicketOnlineExpense = filteredDailyExpenseLogs
      .filter((log) => String(log?.paymentMethod || "").trim() === "UPI")
      .reduce((sum, log) => sum + Number(log?.total || 0), 0);
    const report = {
      id: existingReport?.id || uuidv4(),
      branchId,
      date,
      branchName: branch.name,
      row,
      totals: {
        onlineSales: Number(row.onlineSales || 0),
        cashSales: Number(row.cashSales || 0),
        onlineExpense: Number(row.onlineExpense || 0),
        cashExpense: Number(row.cashExpense || 0),
        onlinePresent: Number(row.onlinePresent || 0),
        cashPresent: Number(row.cashPresent || 0),
        dueAmount: Number(row.dueAmount || 0)
      },
      verifiedCashPresent,
      verifiedOnlinePresent,
      calculationDiscrepancyCash,
      calculationDiscrepancyOnline,
      totalCalculationDiscrepancy,
      verificationDiscrepancyCash,
      verificationDiscrepancyOnline,
      remarks,
      resolutionReason,
      resolvedAt: hasDiscrepancy ? verifiedAt : "",
      verifiedAt,
      verifiedBy: req.user.id,
      cumulativeCashAccount: baseCashAccount + verifiedCashPresent - (existingReport ? 0 : reviewedTicketCashExpense),
      cumulativeOnlineAccount: baseOnlineAccount + verifiedOnlinePresent - (existingReport ? 0 : reviewedTicketOnlineExpense),
      hasDiscrepancy
    };
  
    if (existingReport) {
      await repository.cashReports().updateOne(
        { branchId, date },
        { $set: report }
      );
    } else {
      await repository.cashReports().insertOne(report);
    }
  
    const saved = await repository.cashReports().findOne({ branchId, date });
    const accounts = await getCashAccountsSummary();
  
    res.status(existingReport ? 200 : 201).json({ ok: true, report: saved, accounts });
  },

    handle7: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
  
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();
    const branchIds = normalizeBranchIds(req.query.branchIds);
    const filter = {};
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = startDate;
      if (endDate) filter.date.$lte = endDate;
    }
    if (branchIds.length) {
      filter.branchId = { $in: branchIds };
    }
  
    const reports = await repository.cashReports().find(filter).sort({ date: -1 }).toArray();
    const rangeTotals = reports.reduce(
      (acc, report) => {
        acc.onlineSales += Number(report?.totals?.onlineSales || 0);
        acc.cashSales += Number(report?.totals?.cashSales || 0);
        acc.onlineExpense += Number(report?.totals?.onlineExpense || 0);
        acc.cashExpense += Number(report?.totals?.cashExpense || 0);
        acc.onlinePresent += Number(report?.totals?.onlinePresent || 0);
        acc.cashPresent += Number(report?.totals?.cashPresent || 0);
        acc.dueAmount += Number(report?.totals?.dueAmount || 0);
        acc.verifiedCashPresent += Number(report?.verifiedCashPresent || 0);
        acc.verifiedOnlinePresent += Number(report?.verifiedOnlinePresent || 0);
        acc.calculationDiscrepancyCash += Number(report?.calculationDiscrepancyCash || 0);
        acc.calculationDiscrepancyOnline += Number(report?.calculationDiscrepancyOnline || 0);
        acc.totalCalculationDiscrepancy += Number(report?.totalCalculationDiscrepancy || 0);
        acc.verificationDiscrepancyCash += Number(report?.verificationDiscrepancyCash || 0);
        acc.verificationDiscrepancyOnline += Number(report?.verificationDiscrepancyOnline || 0);
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
        verifiedCashPresent: 0,
        verifiedOnlinePresent: 0,
        calculationDiscrepancyCash: 0,
        calculationDiscrepancyOnline: 0,
        totalCalculationDiscrepancy: 0,
        verificationDiscrepancyCash: 0,
        verificationDiscrepancyOnline: 0
      }
    );
    const accounts = await getCashAccountsSummary();
  
    res.json({ reports, rangeTotals, accounts });
  },

    handle8: async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const targetDate = getPreviousDateInIST(new Date());
    const result = await sendCashDailyReportForDate(targetDate, { markAutoSent: false });
    if (!result.ok) {
      return res.status(400).json({ message: result.reason || "Could not send cash report" });
    }
    res.json({ ok: true, date: targetDate });
  }
  };
}

