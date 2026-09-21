"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  analyzeMoneyState,
  buildCoachSummary,
  createDemoMoneyState,
  emptyMoneyState,
  migrateV1Profile,
  type DebtAccount,
  type DebtType,
  type GoalPriority,
  type MoneyAccount,
  type MoneyAccountType,
  type MoneyGoal,
  type MoneyState,
  type MoneyTransaction,
  type TransactionDirection,
} from "@/lib/money-v2";
import type { FinancialProfile } from "@/lib/financial-planner";
import styles from "./money.module.css";

const STORAGE_KEY = "solpient.money.profile.v2";
const LEGACY_STORAGE_KEY = "solpient.money.profile.v1";

const accountTypeLabels: Record<MoneyAccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  brokerage: "Brokerage",
  retirement: "Retirement",
  property: "Property",
  other: "Other",
};

const debtTypeLabels: Record<DebtType, string> = {
  credit_card: "Credit card",
  auto: "Auto loan",
  student: "Student loan",
  mortgage: "Mortgage",
  personal: "Personal loan",
  other: "Other",
};

function id(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return prefix + "-" + crypto.randomUUID();
  }
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function money(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  }).format(value || 0);
}

function percent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function dateLabel(value: string) {
  if (!value) return "No date";
  const date = new Date(value + "T12:00:00");
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function NumberInput({
  label,
  value,
  onChange,
  suffix = "$",
  compact = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  compact?: boolean;
}) {
  return (
    <label className={compact ? styles.compactField : styles.field}>
      <span>{label}</span>
      <div className={styles.inputWrap}>
        <input
          min="0"
          inputMode="decimal"
          step={suffix === "%" ? "0.1" : "1"}
          type="number"
          value={value || ""}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        />
        <em>{suffix}</em>
      </div>
    </label>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "date";
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <div className={styles.inputWrap}>
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </label>
  );
}

function SelectInput<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <div className={styles.inputWrap}>
        <select value={value} onChange={(event) => onChange(event.target.value as T)}>
          {options.map((option) => (
            <option value={option.value} key={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    </label>
  );
}

export default function MoneyPage() {
  const [state, setState] = useState<MoneyState>(emptyMoneyState);
  const [loaded, setLoaded] = useState(false);
  const [accountDraft, setAccountDraft] = useState({ name: "", type: "checking" as MoneyAccountType, balance: 0 });
  const [debtDraft, setDebtDraft] = useState({ name: "", type: "credit_card" as DebtType, balance: 0, apr: 0, minimumPayment: 0 });
  const [goalDraft, setGoalDraft] = useState({ name: "", targetAmount: 0, currentAmount: 0, targetDate: "", priority: "medium" as GoalPriority });
  const [transactionDraft, setTransactionDraft] = useState({ date: "", description: "", amount: 0, direction: "expense" as TransactionDirection, category: "Other", recurring: false });
  const [coachQuestion, setCoachQuestion] = useState("");
  const [coachAnswer, setCoachAnswer] = useState("");
  const [coachSource, setCoachSource] = useState<"ai" | "rules" | "">("");
  const [coachLoading, setCoachLoading] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.version === 2) setState({ ...emptyMoneyState, ...parsed });
      } else {
        const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
          const migrated = migrateV1Profile(JSON.parse(legacy) as FinancialProfile);
          setState(migrated);
        }
      }
    } catch {
      // The app remains usable when browser storage is unavailable.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Browser persistence is an enhancement, not a requirement.
    }
  }, [loaded, state]);

  const analysis = useMemo(() => analyzeMoneyState(state), [state]);
  const hasData =
    state.accounts.length > 0 ||
    state.debts.length > 0 ||
    state.transactions.length > 0 ||
    state.settings.monthlyIncomeOverride > 0;

  const updateSettings = (key: keyof MoneyState["settings"], value: number) => {
    setState((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value },
    }));
  };

  const addAccount = () => {
    if (!accountDraft.name.trim() || accountDraft.balance <= 0) return;
    const account: MoneyAccount = { id: id("acct"), ...accountDraft, name: accountDraft.name.trim() };
    setState((current) => ({ ...current, accounts: [...current.accounts, account] }));
    setAccountDraft({ name: "", type: "checking", balance: 0 });
  };

  const addDebt = () => {
    if (!debtDraft.name.trim() || debtDraft.balance <= 0) return;
    const debt: DebtAccount = { id: id("debt"), ...debtDraft, name: debtDraft.name.trim() };
    setState((current) => ({ ...current, debts: [...current.debts, debt] }));
    setDebtDraft({ name: "", type: "credit_card", balance: 0, apr: 0, minimumPayment: 0 });
  };

  const addGoal = () => {
    if (!goalDraft.name.trim() || goalDraft.targetAmount <= 0) return;
    const goal: MoneyGoal = { id: id("goal"), ...goalDraft, name: goalDraft.name.trim() };
    setState((current) => ({ ...current, goals: [...current.goals, goal] }));
    setGoalDraft({ name: "", targetAmount: 0, currentAmount: 0, targetDate: "", priority: "medium" });
  };

  const addTransaction = () => {
    if (!transactionDraft.description.trim() || transactionDraft.amount <= 0) return;
    const transaction: MoneyTransaction = {
      id: id("tx"),
      ...transactionDraft,
      date: transactionDraft.date || new Date().toISOString().slice(0, 10),
      description: transactionDraft.description.trim(),
      category: transactionDraft.category.trim() || "Other",
    };
    setState((current) => ({
      ...current,
      transactions: [transaction, ...current.transactions].slice(0, 250),
    }));
    setTransactionDraft({ date: "", description: "", amount: 0, direction: "expense", category: "Other", recurring: false });
  };

  const remove = (collection: "accounts" | "debts" | "goals" | "transactions", itemId: string) => {
    setState((current) => ({
      ...current,
      [collection]: current[collection].filter((item) => item.id !== itemId),
    }));
  };

  const loadDemo = () => {
    setState(createDemoMoneyState(new Date()));
    setCoachAnswer("");
  };

  const reset = () => {
    setState(emptyMoneyState);
    setCoachAnswer("");
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const askCoach = async (question = coachQuestion) => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || coachLoading) return;
    setCoachQuestion(cleanQuestion);
    setCoachLoading(true);
    setCoachAnswer("");
    setCoachSource("");
    try {
      const response = await fetch("/api/money/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: cleanQuestion,
          summary: buildCoachSummary(analysis),
        }),
      });
      const payload = await response.json();
      setCoachAnswer(payload.answer ?? payload.error ?? "Solpient could not explain the plan.");
      setCoachSource(payload.source === "ai" ? "ai" : "rules");
    } catch {
      setCoachAnswer("Solpient could not reach the coach endpoint. Your deterministic plan is still available above.");
      setCoachSource("rules");
    } finally {
      setCoachLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}><strong>SOLPIENT</strong><span>Financial Intelligence</span></Link>
        <nav>
          <Link href="/">Home</Link>
          <Link href="/research">Research</Link>
          <Link className={styles.active} href="/money">Money</Link>
        </nav>
        <div className={styles.privacyPill}>Local-first financial profile</div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>SOLPIENT MONEY · V2</span>
            <h1>One financial map. One next move.</h1>
            <p>
              Accounts, debt, spending, goals, and retirement now feed one auditable
              decision engine. The coach explains the plan; it does not invent it.
            </p>
          </div>
          <div className={styles.heroActions}>
            <button className={styles.primaryButton} type="button" onClick={loadDemo}>Load example</button>
            <button className={styles.secondaryButton} type="button" onClick={reset}>Reset</button>
          </div>
        </section>

        <section className={styles.metrics}>
          <article className={styles.scoreCard}>
            <span>Financial Health</span>
            <div><strong>{hasData ? analysis.score : "—"}</strong><em>/100</em></div>
            <p>{hasData ? analysis.scoreLabel : "Build your household map"}</p>
          </article>
          <article><span>Net worth</span><strong>{hasData ? money(analysis.netWorth) : "—"}</strong><p>{money(analysis.assets)} assets · {money(analysis.debt)} debt</p></article>
          <article><span>Free cash flow</span><strong>{hasData ? money(analysis.freeCashFlow) : "—"}</strong><p>{hasData ? percent(analysis.savingsRate) + " savings rate" : "Income minus spending"}</p></article>
          <article><span>Liquid runway</span><strong>{hasData ? analysis.emergencyMonths.toFixed(1) + " mo" : "—"}</strong><p>{money(analysis.liquidCash)} liquid cash</p></article>
          <article><span>Highest consumer APR</span><strong>{hasData ? analysis.highestConsumerApr.toFixed(1) + "%" : "—"}</strong><p>{money(analysis.minimumDebtPayments)} minimum debt payments</p></article>
        </section>

        <div className={styles.workspace}>
          <div className={styles.leftColumn}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div><span className={styles.eyebrow}>MONTHLY BASELINE</span><h2>Cash-flow settings</h2></div>
                <span className={styles.autoSave}>{loaded ? "Saved locally" : "Loading…"}</span>
              </div>
              <div className={styles.settingGrid}>
                <NumberInput label="Monthly take-home income" value={state.settings.monthlyIncomeOverride} onChange={(value) => updateSettings("monthlyIncomeOverride", value)} />
                <NumberInput label="Monthly spending" value={state.settings.monthlyExpensesOverride} onChange={(value) => updateSettings("monthlyExpensesOverride", value)} />
                <NumberInput label="Retirement contributions" value={state.settings.monthlyRetirementContribution} onChange={(value) => updateSettings("monthlyRetirementContribution", value)} />
                <NumberInput label="Uncaptured employer match" value={state.settings.uncapturedEmployerMatchMonthly} onChange={(value) => updateSettings("uncapturedEmployerMatchMonthly", value)} />
                <NumberInput label="Emergency target" value={state.settings.emergencyTargetMonths} onChange={(value) => updateSettings("emergencyTargetMonths", Math.max(1, Math.min(12, value)))} suffix="months" />
              </div>
              <p className={styles.panelNote}>If income or spending is left blank, Solpient uses transactions from the last 31 days.</p>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div><span className={styles.eyebrow}>BALANCE SHEET</span><h2>Accounts</h2></div>
                <strong className={styles.headerMetric}>{money(analysis.assets)}</strong>
              </div>
              <div className={styles.itemList}>
                {state.accounts.map((account) => (
                  <div className={styles.itemRow} key={account.id}>
                    <span className={styles.itemIcon}>A</span>
                    <div><strong>{account.name}</strong><small>{accountTypeLabels[account.type]}</small></div>
                    <b>{money(account.balance)}</b>
                    <button type="button" onClick={() => remove("accounts", account.id)}>×</button>
                  </div>
                ))}
                {!state.accounts.length ? <div className={styles.emptyInline}>No accounts added yet.</div> : null}
              </div>
              <div className={styles.addForm}>
                <TextInput label="Account name" value={accountDraft.name} onChange={(value) => setAccountDraft((current) => ({ ...current, name: value }))} placeholder="Checking, TSP, brokerage…" />
                <SelectInput label="Type" value={accountDraft.type} onChange={(value) => setAccountDraft((current) => ({ ...current, type: value }))} options={Object.entries(accountTypeLabels).map(([value, label]) => ({ value: value as MoneyAccountType, label }))} />
                <NumberInput label="Balance" value={accountDraft.balance} onChange={(value) => setAccountDraft((current) => ({ ...current, balance: value }))} />
                <button type="button" className={styles.addButton} onClick={addAccount}>Add account</button>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div><span className={styles.eyebrow}>LIABILITIES</span><h2>Debt</h2></div>
                <strong className={styles.headerMetric}>{money(analysis.debt)}</strong>
              </div>
              <div className={styles.itemList}>
                {state.debts.map((debt) => (
                  <div className={styles.itemRow} key={debt.id}>
                    <span className={styles.itemIcon}>D</span>
                    <div><strong>{debt.name}</strong><small>{debtTypeLabels[debt.type]} · {debt.apr.toFixed(1)}% APR · min {money(debt.minimumPayment)}</small></div>
                    <b>{money(debt.balance)}</b>
                    <button type="button" onClick={() => remove("debts", debt.id)}>×</button>
                  </div>
                ))}
                {!state.debts.length ? <div className={styles.emptyInline}>No debt added yet.</div> : null}
              </div>
              <div className={styles.addFormWide}>
                <TextInput label="Debt name" value={debtDraft.name} onChange={(value) => setDebtDraft((current) => ({ ...current, name: value }))} placeholder="Visa, mortgage, auto…" />
                <SelectInput label="Type" value={debtDraft.type} onChange={(value) => setDebtDraft((current) => ({ ...current, type: value }))} options={Object.entries(debtTypeLabels).map(([value, label]) => ({ value: value as DebtType, label }))} />
                <NumberInput label="Balance" value={debtDraft.balance} onChange={(value) => setDebtDraft((current) => ({ ...current, balance: value }))} />
                <NumberInput label="APR" value={debtDraft.apr} onChange={(value) => setDebtDraft((current) => ({ ...current, apr: value }))} suffix="%" />
                <NumberInput label="Minimum payment" value={debtDraft.minimumPayment} onChange={(value) => setDebtDraft((current) => ({ ...current, minimumPayment: value }))} />
                <button type="button" className={styles.addButton} onClick={addDebt}>Add debt</button>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div><span className={styles.eyebrow}>GOALS</span><h2>What the money is for</h2></div>
                <strong className={styles.headerMetric}>{analysis.activeGoalCount} active</strong>
              </div>
              <div className={styles.goalGrid}>
                {state.goals.map((goal) => {
                  const progress = goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
                  return (
                    <article className={styles.goalCard} key={goal.id}>
                      <div><span>{goal.priority}</span><button type="button" onClick={() => remove("goals", goal.id)}>×</button></div>
                      <strong>{goal.name}</strong>
                      <p>{money(goal.currentAmount)} of {money(goal.targetAmount)} · {goal.targetDate ? dateLabel(goal.targetDate) : "No date"}</p>
                      <div className={styles.progressTrack}><i style={{ width: progress + "%" }} /></div>
                    </article>
                  );
                })}
                {!state.goals.length ? <div className={styles.emptyInline}>No goals added yet.</div> : null}
              </div>
              <div className={styles.addFormWide}>
                <TextInput label="Goal" value={goalDraft.name} onChange={(value) => setGoalDraft((current) => ({ ...current, name: value }))} placeholder="Emergency fund, trip, home repair…" />
                <NumberInput label="Target" value={goalDraft.targetAmount} onChange={(value) => setGoalDraft((current) => ({ ...current, targetAmount: value }))} />
                <NumberInput label="Already saved" value={goalDraft.currentAmount} onChange={(value) => setGoalDraft((current) => ({ ...current, currentAmount: value }))} />
                <TextInput label="Target date" value={goalDraft.targetDate} onChange={(value) => setGoalDraft((current) => ({ ...current, targetDate: value }))} type="date" />
                <SelectInput label="Priority" value={goalDraft.priority} onChange={(value) => setGoalDraft((current) => ({ ...current, priority: value }))} options={[{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
                <button type="button" className={styles.addButton} onClick={addGoal}>Add goal</button>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div><span className={styles.eyebrow}>CASH FLOW</span><h2>Transactions</h2></div>
                <strong className={styles.headerMetric}>{analysis.recentTransactionCount} recent</strong>
              </div>
              <div className={styles.transactionGrid}>
                <div>
                  <div className={styles.addFormTransaction}>
                    <TextInput label="Date" value={transactionDraft.date} onChange={(value) => setTransactionDraft((current) => ({ ...current, date: value }))} type="date" />
                    <TextInput label="Description" value={transactionDraft.description} onChange={(value) => setTransactionDraft((current) => ({ ...current, description: value }))} placeholder="Paycheck, groceries…" />
                    <NumberInput label="Amount" value={transactionDraft.amount} onChange={(value) => setTransactionDraft((current) => ({ ...current, amount: value }))} />
                    <SelectInput label="Direction" value={transactionDraft.direction} onChange={(value) => setTransactionDraft((current) => ({ ...current, direction: value }))} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }, { value: "transfer", label: "Transfer" }]} />
                    <TextInput label="Category" value={transactionDraft.category} onChange={(value) => setTransactionDraft((current) => ({ ...current, category: value }))} placeholder="Food, housing, income…" />
                    <label className={styles.checkField}><input type="checkbox" checked={transactionDraft.recurring} onChange={(event) => setTransactionDraft((current) => ({ ...current, recurring: event.target.checked }))} /><span>Recurring</span></label>
                    <button type="button" className={styles.addButton} onClick={addTransaction}>Add transaction</button>
                  </div>
                  <div className={styles.transactionList}>
                    {state.transactions.slice(0, 12).map((transaction) => (
                      <div key={transaction.id}>
                        <span>{dateLabel(transaction.date)}</span>
                        <div><strong>{transaction.description}</strong><small>{transaction.category}{transaction.recurring ? " · recurring" : ""}</small></div>
                        <b data-direction={transaction.direction}>{transaction.direction === "expense" ? "−" : transaction.direction === "income" ? "+" : ""}{money(transaction.amount)}</b>
                        <button type="button" onClick={() => remove("transactions", transaction.id)}>×</button>
                      </div>
                    ))}
                    {!state.transactions.length ? <div className={styles.emptyInline}>Add transactions to see spending patterns.</div> : null}
                  </div>
                </div>

                <aside className={styles.spendingPanel}>
                  <span className={styles.eyebrow}>TOP SPENDING</span>
                  {analysis.topSpending.map((item) => (
                    <div className={styles.spendingRow} key={item.category}>
                      <div><strong>{item.category}</strong><span>{money(item.amount)}</span></div>
                      <div className={styles.spendingTrack}><i style={{ width: Math.min(100, item.share * 100) + "%" }} /></div>
                    </div>
                  ))}
                  {!analysis.topSpending.length ? <p>No recent expense transactions.</p> : null}
                </aside>
              </div>
            </section>
          </div>

          <aside className={styles.rightColumn}>
            <section className={styles.planPanel}>
              <div className={styles.panelHeaderCompact}>
                <div><span className={styles.eyebrow}>NEXT BEST DOLLAR</span><h2>Your priority sequence</h2></div>
              </div>

              {!hasData ? (
                <div className={styles.emptyPlan}>
                  <div>◎</div><strong>Build your financial map</strong>
                  <p>Add accounts, debts, monthly cash flow, and goals. Solpient will calculate the next action.</p>
                  <button type="button" onClick={loadDemo}>Preview example</button>
                </div>
              ) : (
                <>
                  <div className={styles.available}>
                    <span>Available this month</span>
                    <strong>{money(Math.max(0, analysis.freeCashFlow))}</strong>
                    <small>Based on the monthly income and spending currently in the engine.</small>
                  </div>

                  <div className={styles.actionList}>
                    {analysis.nextDollarActions.map((action, index) => (
                      <article className={styles.action} data-tone={action.tone} key={action.id}>
                        <span className={styles.actionNumber}>{index + 1}</span>
                        <div>
                          <div className={styles.actionTitle}><strong>{action.title}</strong><b>{money(action.amount)}</b></div>
                          <p>{action.reason}</p>
                        </div>
                      </article>
                    ))}
                  </div>

                  {analysis.debtInterestImpact > 0 ? (
                    <div className={styles.impactBox}>
                      <span>Approx. first-year interest avoided</span>
                      <strong>{money(analysis.debtInterestImpact)}</strong>
                      <small>Simple APR estimate on recommended principal reduction; lender timing and compounding can differ.</small>
                    </div>
                  ) : null}

                  <div className={styles.breakdown}>
                    <div className={styles.breakdownHeader}><strong>Health score</strong><span>{analysis.score}/100</span></div>
                    <div><span>Cash flow</span><b>{analysis.scoreBreakdown.cashFlow}/25</b></div>
                    <div><span>Liquidity</span><b>{analysis.scoreBreakdown.liquidity}/25</b></div>
                    <div><span>Consumer debt</span><b>{analysis.scoreBreakdown.debt}/30</b></div>
                    <div><span>Retirement contribution</span><b>{analysis.scoreBreakdown.retirement}/20</b></div>
                  </div>
                </>
              )}
            </section>

            <section className={styles.coachPanel}>
              <div className={styles.panelHeaderCompact}>
                <div><span className={styles.eyebrow}>SOLPIENT COACH</span><h2>Ask why</h2></div>
                {coachSource ? <span className={styles.coachBadge}>{coachSource === "ai" ? "AI" : "Rules fallback"}</span> : null}
              </div>
              <p className={styles.coachIntro}>The coach receives only summary metrics and the action plan—not account names or transaction descriptions.</p>
              <div className={styles.quickQuestions}>
                {["Why is this my first priority?", "Should I invest more this month?", "What would improve my score fastest?"].map((question) => (
                  <button type="button" key={question} onClick={() => askCoach(question)}>{question}</button>
                ))}
              </div>
              <textarea value={coachQuestion} onChange={(event) => setCoachQuestion(event.target.value)} placeholder="Ask Solpient about your plan…" maxLength={600} />
              <button className={styles.coachButton} type="button" disabled={coachLoading || !coachQuestion.trim()} onClick={() => askCoach()}>
                {coachLoading ? "Explaining…" : "Explain my plan"}
              </button>
              {coachAnswer ? <div className={styles.coachAnswer}>{coachAnswer}</div> : null}
            </section>

            <section className={styles.privacyCard}>
              <strong>V2 privacy architecture</strong>
              <p>Financial records stay in this browser. The optional coach endpoint sends only aggregate metrics and the deterministic plan. If no OpenAI key is configured, Solpient falls back to a rules explanation.</p>
            </section>
          </aside>
        </div>

        <section className={styles.nextLayer}>
          <span className={styles.eyebrow}>NEXT LAYER</span>
          <h2>V2 is ready for read-only account connectivity.</h2>
          <div>
            <article><b>LIVE</b><strong>Household graph</strong><p>Accounts, debts, transactions, goals, and settings.</p></article>
            <article><b>LIVE</b><strong>Decision engine</strong><p>Deterministic Next Best Dollar with goal-aware sequencing.</p></article>
            <article><b>LIVE</b><strong>Coach</strong><p>Privacy-safe AI explanation with rules fallback.</p></article>
            <article><b>NEXT</b><strong>Bank connections</strong><p>Plaid-style read-only synchronization without changing the engine.</p></article>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div><strong>SOLPIENT</strong><span>See clearly. Decide deliberately.</span></div>
        <span>Money v2 · local-first · deterministic planning · privacy-safe coach</span>
      </footer>
    </div>
  );
}
