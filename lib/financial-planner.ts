export type FinancialProfile = {
  monthlyIncome: number;
  monthlyExpenses: number;
  cashSavings: number;
  retirementBalance: number;
  brokerageBalance: number;
  otherAssets: number;
  creditCardBalance: number;
  creditCardApr: number;
  autoLoanBalance: number;
  autoLoanApr: number;
  studentLoanBalance: number;
  studentLoanApr: number;
  mortgageBalance: number;
  mortgageApr: number;
  monthlyRetirementContribution: number;
  emergencyTargetMonths: number;
  uncapturedEmployerMatchMonthly: number;
};

export type NextDollarAction = {
  id: string;
  title: string;
  amount: number;
  reason: string;
  tone: "urgent" | "priority" | "progress" | "longterm";
};

export type PlanningResult = {
  assets: number;
  debt: number;
  netWorth: number;
  freeCashFlow: number;
  savingsRate: number;
  emergencyMonths: number;
  highestConsumerApr: number;
  score: number;
  scoreLabel: string;
  scoreBreakdown: {
    cashFlow: number;
    liquidity: number;
    debt: number;
    retirement: number;
  };
  nextDollarActions: NextDollarAction[];
  debtInterestImpact: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const safe = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

export const emptyFinancialProfile: FinancialProfile = {
  monthlyIncome: 0,
  monthlyExpenses: 0,
  cashSavings: 0,
  retirementBalance: 0,
  brokerageBalance: 0,
  otherAssets: 0,
  creditCardBalance: 0,
  creditCardApr: 0,
  autoLoanBalance: 0,
  autoLoanApr: 0,
  studentLoanBalance: 0,
  studentLoanApr: 0,
  mortgageBalance: 0,
  mortgageApr: 0,
  monthlyRetirementContribution: 0,
  emergencyTargetMonths: 4,
  uncapturedEmployerMatchMonthly: 0,
};

export const demoFinancialProfile: FinancialProfile = {
  monthlyIncome: 8500,
  monthlyExpenses: 5900,
  cashSavings: 9000,
  retirementBalance: 142000,
  brokerageBalance: 38000,
  otherAssets: 21000,
  creditCardBalance: 7200,
  creditCardApr: 22.9,
  autoLoanBalance: 18500,
  autoLoanApr: 6.7,
  studentLoanBalance: 0,
  studentLoanApr: 0,
  mortgageBalance: 248000,
  mortgageApr: 3.4,
  monthlyRetirementContribution: 850,
  emergencyTargetMonths: 4,
  uncapturedEmployerMatchMonthly: 250,
};

function buildDebtRows(profile: FinancialProfile) {
  return [
    {
      id: "credit-card",
      name: "credit-card debt",
      balance: safe(profile.creditCardBalance),
      apr: safe(profile.creditCardApr),
      consumer: true,
    },
    {
      id: "auto-loan",
      name: "auto loan",
      balance: safe(profile.autoLoanBalance),
      apr: safe(profile.autoLoanApr),
      consumer: true,
    },
    {
      id: "student-loan",
      name: "student loan",
      balance: safe(profile.studentLoanBalance),
      apr: safe(profile.studentLoanApr),
      consumer: true,
    },
    {
      id: "mortgage",
      name: "mortgage",
      balance: safe(profile.mortgageBalance),
      apr: safe(profile.mortgageApr),
      consumer: false,
    },
  ].filter((item) => item.balance > 0);
}

function scoreLabel(score: number) {
  if (score >= 85) return "Strong";
  if (score >= 70) return "Healthy";
  if (score >= 55) return "Needs attention";
  return "Fragile";
}

export function analyzeFinancialProfile(input: FinancialProfile): PlanningResult {
  const profile = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, safe(Number(value))]),
  ) as FinancialProfile;

  const debts = buildDebtRows(profile);
  const consumerDebts = debts.filter((debt) => debt.consumer);
  const assets =
    profile.cashSavings +
    profile.retirementBalance +
    profile.brokerageBalance +
    profile.otherAssets;
  const debt = debts.reduce((sum, item) => sum + item.balance, 0);
  const netWorth = assets - debt;
  const freeCashFlow = profile.monthlyIncome - profile.monthlyExpenses;
  const savingsRate =
    profile.monthlyIncome > 0 ? freeCashFlow / profile.monthlyIncome : 0;
  const emergencyMonths =
    profile.monthlyExpenses > 0
      ? profile.cashSavings / profile.monthlyExpenses
      : 0;

  const highestConsumerApr = consumerDebts.reduce(
    (max, item) => Math.max(max, item.apr),
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

  const targetMonths = clamp(profile.emergencyTargetMonths || 4, 1, 12);
  const liquidityScore = Math.round(
    clamp(emergencyMonths / targetMonths, 0, 1) * 25,
  );

  const annualIncome = profile.monthlyIncome * 12;
  const consumerDebtTotal = consumerDebts.reduce(
    (sum, item) => sum + item.balance,
    0,
  );
  const consumerDebtToIncome =
    annualIncome > 0 ? consumerDebtTotal / annualIncome : consumerDebtTotal > 0 ? 1 : 0;

  let debtScore = 30;
  if (highestConsumerApr >= 20) debtScore -= 20;
  else if (highestConsumerApr >= 15) debtScore -= 15;
  else if (highestConsumerApr >= 10) debtScore -= 10;
  else if (highestConsumerApr >= 7) debtScore -= 5;

  if (consumerDebtToIncome > 0.5) debtScore -= 10;
  else if (consumerDebtToIncome > 0.25) debtScore -= 5;
  debtScore = clamp(debtScore, 0, 30);

  const retirementRate =
    profile.monthlyIncome > 0
      ? profile.monthlyRetirementContribution / profile.monthlyIncome
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

  const actions: NextDollarAction[] = [];
  let remaining = Math.max(0, freeCashFlow);
  let debtInterestImpact = 0;

  const allocate = (
    id: string,
    title: string,
    need: number,
    reason: string,
    tone: NextDollarAction["tone"],
    apr?: number,
  ) => {
    if (remaining <= 0 || need <= 0) return;
    const amount = Math.min(remaining, need);
    remaining -= amount;
    actions.push({ id, title, amount, reason, tone });
    if (apr && apr > 0) debtInterestImpact += amount * (apr / 100);
  };

  if (remaining <= 0) {
    actions.push({
      id: "cash-flow",
      title: "Restore positive monthly cash flow",
      amount: Math.abs(freeCashFlow),
      reason:
        "Monthly spending is at or above income. Reduce recurring outflow or increase income before adding new optional investing.",
      tone: "urgent",
    });
  } else {
    const starterEmergencyTarget = profile.monthlyExpenses;
    allocate(
      "starter-emergency",
      "Build a one-month cash buffer",
      Math.max(0, starterEmergencyTarget - profile.cashSavings),
      "A starter reserve reduces the chance that an ordinary surprise becomes new high-interest debt.",
      "priority",
    );

    allocate(
      "employer-match",
      "Capture available employer match",
      profile.uncapturedEmployerMatchMonthly,
      "Uncaptured employer matching is compensation you are currently leaving unused.",
      "priority",
    );

    for (const debtItem of consumerDebts
      .filter((item) => item.apr >= 10)
      .sort((a, b) => b.apr - a.apr)) {
      allocate(
        debtItem.id,
        `Pay down ${debtItem.name}`,
        debtItem.balance,
        `At ${debtItem.apr.toFixed(1)}% APR, reducing this balance creates a high-confidence improvement in your balance sheet.`,
        "urgent",
        debtItem.apr,
      );
    }

    const fullEmergencyTarget = profile.monthlyExpenses * targetMonths;
    allocate(
      "full-emergency",
      `Build emergency savings toward ${targetMonths} months`,
      Math.max(0, fullEmergencyTarget - profile.cashSavings),
      "Once expensive debt is controlled, additional cash reserves improve resilience and reduce forced selling or borrowing.",
      "progress",
    );

    const retirementTarget = profile.monthlyIncome * 0.15;
    allocate(
      "retirement",
      "Increase retirement contributions",
      Math.max(0, retirementTarget - profile.monthlyRetirementContribution),
      "This rules-based plan uses 15% of monthly income as a planning benchmark, not a universal requirement.",
      "progress",
    );

    for (const debtItem of consumerDebts
      .filter((item) => item.apr >= 5 && item.apr < 10)
      .sort((a, b) => b.apr - a.apr)) {
      allocate(
        `moderate-${debtItem.id}`,
        `Accelerate ${debtItem.name}`,
        debtItem.balance,
        `After core liquidity and retirement priorities, a ${debtItem.apr.toFixed(1)}% APR obligation may deserve additional principal payments.`,
        "progress",
        debtItem.apr,
      );
    }

    if (remaining > 0) {
      actions.push({
        id: "long-term",
        title: "Direct the remaining surplus to long-term goals",
        amount: remaining,
        reason:
          "Core cash, debt, and retirement priorities are covered in this rules-based sequence. The remainder can support diversified long-term investing or another named goal.",
        tone: "longterm",
      });
    }
  }

  return {
    assets,
    debt,
    netWorth,
    freeCashFlow,
    savingsRate,
    emergencyMonths,
    highestConsumerApr,
    score,
    scoreLabel: scoreLabel(score),
    scoreBreakdown: {
      cashFlow: cashFlowScore,
      liquidity: liquidityScore,
      debt: debtScore,
      retirement: retirementScore,
    },
    nextDollarActions: actions.slice(0, 6),
    debtInterestImpact,
  };
}
