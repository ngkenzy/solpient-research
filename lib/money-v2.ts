import type { FinancialProfile } from "@/lib/financial-planner";

export type MoneyAccountType =
  | "checking"
  | "savings"
  | "brokerage"
  | "retirement"
  | "property"
  | "other";

export type MoneyAccount = {
  id: string;
  name: string;
  type: MoneyAccountType;
  balance: number;
};

export type DebtType =
  | "credit_card"
  | "auto"
  | "student"
  | "mortgage"
  | "personal"
  | "other";

export type DebtAccount = {
  id: string;
  name: string;
  type: DebtType;
  balance: number;
  apr: number;
  minimumPayment: number;
};

export type TransactionDirection = "income" | "expense" | "transfer";

export type MoneyTransaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  direction: TransactionDirection;
  category: string;
  recurring?: boolean;
};

export type GoalPriority = "high" | "medium" | "low";

export type MoneyGoal = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;
  priority: GoalPriority;
};

export type MoneySettings = {
  monthlyIncomeOverride: number;
  monthlyExpensesOverride: number;
  monthlyRetirementContribution: number;
  uncapturedEmployerMatchMonthly: number;
  emergencyTargetMonths: number;
};

export type MoneyState = {
  version: 2;
  accounts: MoneyAccount[];
  debts: DebtAccount[];
  transactions: MoneyTransaction[];
  goals: MoneyGoal[];
  settings: MoneySettings;
};

export type MoneyAction = {
  id: string;
  title: string;
  amount: number;
  reason: string;
  tone: "urgent" | "priority" | "progress" | "longterm";
  kind: "cash" | "match" | "debt" | "goal" | "retirement" | "invest";
};

export type SpendingCategory = {
  category: string;
  amount: number;
  share: number;
};

export type MoneyAnalysis = {
  assets: number;
  debt: number;
  netWorth: number;
  liquidCash: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  freeCashFlow: number;
  savingsRate: number;
  emergencyMonths: number;
  highestConsumerApr: number;
  minimumDebtPayments: number;
  score: number;
  scoreLabel: string;
  scoreBreakdown: {
    cashFlow: number;
    liquidity: number;
    debt: number;
    retirement: number;
  };
  nextDollarActions: MoneyAction[];
  debtInterestImpact: number;
  topSpending: SpendingCategory[];
  recentTransactionCount: number;
  activeGoalCount: number;
};

export type CoachSummary = {
  score: number;
  scoreLabel: string;
  netWorth: number;
  liquidCash: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  freeCashFlow: number;
  emergencyMonths: number;
  highestConsumerApr: number;
  totalDebt: number;
  activeGoalCount: number;
  actions: Array<Pick<MoneyAction, "title" | "amount" | "reason" | "kind">>;
  topSpending: SpendingCategory[];
};

const safe = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const shiftDate = (date: Date, days: number) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return toIsoDate(copy);
};

export const emptyMoneyState: MoneyState = {
  version: 2,
  accounts: [],
  debts: [],
  transactions: [],
  goals: [],
  settings: {
    monthlyIncomeOverride: 0,
    monthlyExpensesOverride: 0,
    monthlyRetirementContribution: 0,
    uncapturedEmployerMatchMonthly: 0,
    emergencyTargetMonths: 4,
  },
};

export function createDemoMoneyState(now = new Date()): MoneyState {
  return {
    version: 2,
    accounts: [
      { id: "demo-checking", name: "Primary checking", type: "checking", balance: 4100 },
      { id: "demo-savings", name: "Emergency savings", type: "savings", balance: 9000 },
      { id: "demo-retirement", name: "Retirement", type: "retirement", balance: 142000 },
      { id: "demo-brokerage", name: "Brokerage", type: "brokerage", balance: 38000 },
      { id: "demo-other", name: "Other assets", type: "other", balance: 21000 },
    ],
    debts: [
      {
        id: "demo-card",
        name: "Rewards card",
        type: "credit_card",
        balance: 7200,
        apr: 22.9,
        minimumPayment: 220,
      },
      {
        id: "demo-auto",
        name: "Auto loan",
        type: "auto",
        balance: 18500,
        apr: 6.7,
        minimumPayment: 425,
      },
      {
        id: "demo-mortgage",
        name: "Mortgage",
        type: "mortgage",
        balance: 248000,
        apr: 3.4,
        minimumPayment: 1850,
      },
    ],
    transactions: [
      { id: "tx-1", date: shiftDate(now, -2), description: "Paycheck", amount: 4250, direction: "income", category: "Income", recurring: true },
      { id: "tx-2", date: shiftDate(now, -16), description: "Paycheck", amount: 4250, direction: "income", category: "Income", recurring: true },
      { id: "tx-3", date: shiftDate(now, -4), description: "Groceries", amount: 760, direction: "expense", category: "Food", recurring: true },
      { id: "tx-4", date: shiftDate(now, -7), description: "Utilities", amount: 420, direction: "expense", category: "Utilities", recurring: true },
      { id: "tx-5", date: shiftDate(now, -10), description: "Insurance", amount: 380, direction: "expense", category: "Insurance", recurring: true },
      { id: "tx-6", date: shiftDate(now, -12), description: "Transportation", amount: 510, direction: "expense", category: "Transportation", recurring: true },
      { id: "tx-7", date: shiftDate(now, -18), description: "Housing", amount: 1850, direction: "expense", category: "Housing", recurring: true },
      { id: "tx-8", date: shiftDate(now, -20), description: "Family & personal", amount: 980, direction: "expense", category: "Family", recurring: false },
      { id: "tx-9", date: shiftDate(now, -24), description: "Subscriptions & other", amount: 1000, direction: "expense", category: "Other", recurring: false },
    ],
    goals: [
      {
        id: "goal-vacation",
        name: "Family trip",
        targetAmount: 6000,
        currentAmount: 2400,
        targetDate: shiftDate(now, 180),
        priority: "medium",
      },
      {
        id: "goal-home",
        name: "Home repair reserve",
        targetAmount: 10000,
        currentAmount: 2000,
        targetDate: shiftDate(now, 365),
        priority: "high",
      },
    ],
    settings: {
      monthlyIncomeOverride: 8500,
      monthlyExpensesOverride: 5900,
      monthlyRetirementContribution: 850,
      uncapturedEmployerMatchMonthly: 250,
      emergencyTargetMonths: 4,
    },
  };
}

function monthsUntil(targetDate: string, now: Date) {
  const target = new Date(targetDate + "T00:00:00");
  if (!Number.isFinite(target.getTime())) return 12;
  const days = Math.max(1, (target.getTime() - now.getTime()) / 86_400_000);
  return Math.max(1, Math.ceil(days / 30.4375));
}

function scoreLabel(score: number) {
  if (score >= 85) return "Strong";
  if (score >= 70) return "Healthy";
  if (score >= 55) return "Needs attention";
  return "Fragile";
}

function recentTransactions(transactions: MoneyTransaction[], now: Date) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 31);
  return transactions.filter((transaction) => {
    const date = new Date(transaction.date + "T12:00:00");
    return Number.isFinite(date.getTime()) && date >= cutoff && date <= now;
  });
}

function inferredCashFlow(state: MoneyState, now: Date) {
  const recent = recentTransactions(state.transactions, now);
  const incomeFromTransactions = recent
    .filter((transaction) => transaction.direction === "income")
    .reduce((sum, transaction) => sum + safe(transaction.amount), 0);
  const expensesFromTransactions = recent
    .filter((transaction) => transaction.direction === "expense")
    .reduce((sum, transaction) => sum + safe(transaction.amount), 0);

  return {
    recent,
    monthlyIncome:
      safe(state.settings.monthlyIncomeOverride) || incomeFromTransactions,
    monthlyExpenses:
      safe(state.settings.monthlyExpensesOverride) || expensesFromTransactions,
  };
}

function spendingBreakdown(transactions: MoneyTransaction[], monthlyExpenses: number) {
  const byCategory = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.direction !== "expense") continue;
    const category = transaction.category.trim() || "Other";
    byCategory.set(category, (byCategory.get(category) ?? 0) + safe(transaction.amount));
  }
  return Array.from(byCategory.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      share: monthlyExpenses > 0 ? amount / monthlyExpenses : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
}

export function analyzeMoneyState(input: MoneyState, now = new Date()): MoneyAnalysis {
  const state: MoneyState = {
    version: 2,
    accounts: Array.isArray(input.accounts) ? input.accounts : [],
    debts: Array.isArray(input.debts) ? input.debts : [],
    transactions: Array.isArray(input.transactions) ? input.transactions : [],
    goals: Array.isArray(input.goals) ? input.goals : [],
    settings: { ...emptyMoneyState.settings, ...(input.settings ?? {}) },
  };

  const assets = state.accounts.reduce((sum, account) => sum + safe(account.balance), 0);
  const debt = state.debts.reduce((sum, item) => sum + safe(item.balance), 0);
  const netWorth = assets - debt;
  const liquidCash = state.accounts
    .filter((account) => account.type === "checking" || account.type === "savings")
    .reduce((sum, account) => sum + safe(account.balance), 0);

  const { recent, monthlyIncome, monthlyExpenses } = inferredCashFlow(state, now);
  const freeCashFlow = monthlyIncome - monthlyExpenses;
  const savingsRate = monthlyIncome > 0 ? freeCashFlow / monthlyIncome : 0;
  const emergencyMonths = monthlyExpenses > 0 ? liquidCash / monthlyExpenses : 0;

  const consumerDebts = state.debts.filter((item) => item.type !== "mortgage");
  const highestConsumerApr = consumerDebts.reduce(
    (max, item) => Math.max(max, safe(item.apr)),
    0,
  );
  const minimumDebtPayments = state.debts.reduce(
    (sum, item) => sum + safe(item.minimumPayment),
    0,
  );

  const cashFlowScore =
    savingsRate >= 0.2
      ? 25
      : savingsRate >= 0.15
        ? 22
        : savingsRate >= 0.1
          ? 18
          : savingsRate >= 0.05
            ? 12
            : savingsRate >= 0
              ? 7
              : 0;

  const emergencyTargetMonths = clamp(
    safe(state.settings.emergencyTargetMonths) || 4,
    1,
    12,
  );
  const liquidityScore = Math.round(
    clamp(emergencyMonths / emergencyTargetMonths, 0, 1) * 25,
  );

  const annualIncome = monthlyIncome * 12;
  const consumerDebtTotal = consumerDebts.reduce(
    (sum, item) => sum + safe(item.balance),
    0,
  );
  const debtToIncome =
    annualIncome > 0
      ? consumerDebtTotal / annualIncome
      : consumerDebtTotal > 0
        ? 1
        : 0;

  let debtScore = 30;
  if (highestConsumerApr >= 20) debtScore -= 20;
  else if (highestConsumerApr >= 15) debtScore -= 15;
  else if (highestConsumerApr >= 10) debtScore -= 10;
  else if (highestConsumerApr >= 7) debtScore -= 5;
  if (debtToIncome > 0.5) debtScore -= 10;
  else if (debtToIncome > 0.25) debtScore -= 5;
  debtScore = clamp(debtScore, 0, 30);

  const retirementRate =
    monthlyIncome > 0
      ? safe(state.settings.monthlyRetirementContribution) / monthlyIncome
      : 0;
  const retirementScore =
    retirementRate >= 0.15
      ? 20
      : retirementRate >= 0.1
        ? 16
        : retirementRate >= 0.05
          ? 10
          : retirementRate > 0
            ? 5
            : 0;

  const score = clamp(
    Math.round(cashFlowScore + liquidityScore + debtScore + retirementScore),
    0,
    100,
  );

  const actions: MoneyAction[] = [];
  let remaining = Math.max(0, freeCashFlow);
  let debtInterestImpact = 0;
  const allocatedGoals = new Set<string>();

  const allocate = (
    action: Omit<MoneyAction, "amount">,
    need: number,
    apr?: number,
  ) => {
    const normalizedNeed = safe(need);
    if (remaining <= 0 || normalizedNeed <= 0) return 0;
    const amount = Math.min(remaining, normalizedNeed);
    remaining -= amount;
    actions.push({ ...action, amount });
    if (apr && apr > 0) debtInterestImpact += amount * (apr / 100);
    return amount;
  };

  if (freeCashFlow <= 0) {
    actions.push({
      id: "cash-flow",
      title: "Restore positive monthly cash flow",
      amount: Math.abs(freeCashFlow),
      reason:
        "Spending is at or above monthly income. Stabilize cash flow before adding optional investing or accelerated goal contributions.",
      tone: "urgent",
      kind: "cash",
    });
  } else {
    allocate(
      {
        id: "starter-emergency",
        title: "Build a one-month cash buffer",
        reason:
          "A one-month liquid reserve reduces the chance that ordinary surprises become new high-interest debt.",
        tone: "priority",
        kind: "cash",
      },
      Math.max(0, monthlyExpenses - liquidCash),
    );

    allocate(
      {
        id: "employer-match",
        title: "Capture available employer match",
        reason:
          "Uncaptured employer matching is compensation that is currently being left unused.",
        tone: "priority",
        kind: "match",
      },
      safe(state.settings.uncapturedEmployerMatchMonthly),
    );

    for (const debtItem of consumerDebts
      .filter((item) => safe(item.apr) >= 10)
      .sort((a, b) => safe(b.apr) - safe(a.apr))) {
      allocate(
        {
          id: "debt-" + debtItem.id,
          title: "Pay down " + debtItem.name,
          reason:
            "At " +
            safe(debtItem.apr).toFixed(1) +
            "% APR, reducing this balance creates a high-confidence improvement before taking more market risk.",
          tone: "urgent",
          kind: "debt",
        },
        safe(debtItem.balance),
        safe(debtItem.apr),
      );
    }

    for (const goal of state.goals
      .filter((goal) => goal.priority === "high")
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate))) {
      const gap = Math.max(0, safe(goal.targetAmount) - safe(goal.currentAmount));
      const monthlyNeed = gap / monthsUntil(goal.targetDate, now);
      const amount = allocate(
        {
          id: "goal-high-" + goal.id,
          title: "Fund " + goal.name,
          reason:
            "This is a high-priority goal. The suggested monthly amount is based on its remaining gap and target date.",
          tone: "priority",
          kind: "goal",
        },
        monthlyNeed,
      );
      if (amount > 0) allocatedGoals.add(goal.id);
    }

    allocate(
      {
        id: "full-emergency",
        title: "Build emergency savings toward " + emergencyTargetMonths + " months",
        reason:
          "After urgent debt and immediate obligations, a deeper cash reserve improves resilience and reduces forced borrowing or selling.",
        tone: "progress",
        kind: "cash",
      },
      Math.max(0, monthlyExpenses * emergencyTargetMonths - liquidCash),
    );

    const retirementTarget = monthlyIncome * 0.15;
    allocate(
      {
        id: "retirement",
        title: "Increase retirement contributions",
        reason:
          "The engine uses 15% of monthly income as a planning benchmark, not a universal requirement.",
        tone: "progress",
        kind: "retirement",
      },
      Math.max(
        0,
        retirementTarget - safe(state.settings.monthlyRetirementContribution),
      ),
    );

    for (const debtItem of consumerDebts
      .filter((item) => safe(item.apr) >= 5 && safe(item.apr) < 10)
      .sort((a, b) => safe(b.apr) - safe(a.apr))) {
      allocate(
        {
          id: "debt-moderate-" + debtItem.id,
          title: "Accelerate " + debtItem.name,
          reason:
            "After liquidity and retirement priorities, a " +
            safe(debtItem.apr).toFixed(1) +
            "% APR obligation can still compete favorably with additional optional risk.",
          tone: "progress",
          kind: "debt",
        },
        safe(debtItem.balance),
        safe(debtItem.apr),
      );
    }

    for (const goal of state.goals
      .filter((goal) => !allocatedGoals.has(goal.id))
      .sort((a, b) => {
        const rank = { high: 0, medium: 1, low: 2 };
        return rank[a.priority] - rank[b.priority] || a.targetDate.localeCompare(b.targetDate);
      })) {
      const gap = Math.max(0, safe(goal.targetAmount) - safe(goal.currentAmount));
      const monthlyNeed = gap / monthsUntil(goal.targetDate, now);
      allocate(
        {
          id: "goal-" + goal.id,
          title: "Fund " + goal.name,
          reason:
            "The suggested contribution is the monthly pace required to close the remaining goal gap by its target date.",
          tone: "progress",
          kind: "goal",
        },
        monthlyNeed,
      );
    }

    if (remaining > 0) {
      actions.push({
        id: "long-term-investing",
        title: "Direct the remaining surplus to long-term investing",
        amount: remaining,
        reason:
          "Core cash, debt, employer-match, retirement, and dated-goal priorities are covered by the current plan.",
        tone: "longterm",
        kind: "invest",
      });
    }
  }

  return {
    assets,
    debt,
    netWorth,
    liquidCash,
    monthlyIncome,
    monthlyExpenses,
    freeCashFlow,
    savingsRate,
    emergencyMonths,
    highestConsumerApr,
    minimumDebtPayments,
    score,
    scoreLabel: scoreLabel(score),
    scoreBreakdown: {
      cashFlow: cashFlowScore,
      liquidity: liquidityScore,
      debt: debtScore,
      retirement: retirementScore,
    },
    nextDollarActions: actions.slice(0, 8),
    debtInterestImpact,
    topSpending: spendingBreakdown(recent, monthlyExpenses),
    recentTransactionCount: recent.length,
    activeGoalCount: state.goals.filter(
      (goal) => safe(goal.currentAmount) < safe(goal.targetAmount),
    ).length,
  };
}

export function buildCoachSummary(analysis: MoneyAnalysis): CoachSummary {
  return {
    score: analysis.score,
    scoreLabel: analysis.scoreLabel,
    netWorth: analysis.netWorth,
    liquidCash: analysis.liquidCash,
    monthlyIncome: analysis.monthlyIncome,
    monthlyExpenses: analysis.monthlyExpenses,
    freeCashFlow: analysis.freeCashFlow,
    emergencyMonths: analysis.emergencyMonths,
    highestConsumerApr: analysis.highestConsumerApr,
    totalDebt: analysis.debt,
    activeGoalCount: analysis.activeGoalCount,
    actions: analysis.nextDollarActions.map(({ title, amount, reason, kind }) => ({
      title,
      amount,
      reason,
      kind,
    })),
    topSpending: analysis.topSpending,
  };
}

export function migrateV1Profile(profile: FinancialProfile): MoneyState {
  const state: MoneyState = {
    ...emptyMoneyState,
    accounts: [
      profile.cashSavings > 0
        ? { id: "migrated-cash", name: "Cash & savings", type: "savings" as const, balance: safe(profile.cashSavings) }
        : null,
      profile.retirementBalance > 0
        ? { id: "migrated-retirement", name: "Retirement", type: "retirement" as const, balance: safe(profile.retirementBalance) }
        : null,
      profile.brokerageBalance > 0
        ? { id: "migrated-brokerage", name: "Brokerage", type: "brokerage" as const, balance: safe(profile.brokerageBalance) }
        : null,
      profile.otherAssets > 0
        ? { id: "migrated-other", name: "Other assets", type: "other" as const, balance: safe(profile.otherAssets) }
        : null,
    ].filter((item): item is MoneyAccount => item !== null),
    debts: [
      profile.creditCardBalance > 0
        ? { id: "migrated-card", name: "Credit card", type: "credit_card" as const, balance: safe(profile.creditCardBalance), apr: safe(profile.creditCardApr), minimumPayment: 0 }
        : null,
      profile.autoLoanBalance > 0
        ? { id: "migrated-auto", name: "Auto loan", type: "auto" as const, balance: safe(profile.autoLoanBalance), apr: safe(profile.autoLoanApr), minimumPayment: 0 }
        : null,
      profile.studentLoanBalance > 0
        ? { id: "migrated-student", name: "Student loan", type: "student" as const, balance: safe(profile.studentLoanBalance), apr: safe(profile.studentLoanApr), minimumPayment: 0 }
        : null,
      profile.mortgageBalance > 0
        ? { id: "migrated-mortgage", name: "Mortgage", type: "mortgage" as const, balance: safe(profile.mortgageBalance), apr: safe(profile.mortgageApr), minimumPayment: 0 }
        : null,
    ].filter((item): item is DebtAccount => item !== null),
    settings: {
      monthlyIncomeOverride: safe(profile.monthlyIncome),
      monthlyExpensesOverride: safe(profile.monthlyExpenses),
      monthlyRetirementContribution: safe(profile.monthlyRetirementContribution),
      uncapturedEmployerMatchMonthly: safe(profile.uncapturedEmployerMatchMonthly),
      emergencyTargetMonths: safe(profile.emergencyTargetMonths) || 4,
    },
  };
  return state;
}
