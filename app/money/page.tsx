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
import { askLocalMoneyAI, buildRulesMoneyExplanation, loadLocalMoneyAI, localAISupported, localAIModelLabel } from "@/lib/local-money-ai";
import styles from "./money.module.css";

const STORAGE_KEY = "solpient.money.profile.v2";
const LEGACY_STORAGE_KEY = "solpient.money.profile.v1";

type View = "overview" | "cashflow" | "debt" | "goals" | "accounts";

const viewLabels: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "cashflow", label: "Cash flow", icon: "↕" },
  { id: "debt", label: "Debt", icon: "−" },
  { id: "goals", label: "Goals", icon: "◎" },
  { id: "accounts", label: "Accounts", icon: "◫" },
];

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

function uid(prefix: string) {
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
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function NumberField({ label, value, onChange, suffix = "$" }: { label: string; value: number; onChange: (value: number) => void; suffix?: string }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <div className={styles.input}>
        <input min="0" inputMode="decimal" step={suffix === "%" ? "0.1" : "1"} type="number" value={value || ""} onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} />
        <em>{suffix}</em>
      </div>
    </label>
  );
}

function TextField({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: "text" | "date" }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <div className={styles.input}>
        <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      </div>
    </label>
  );
}

function SelectField<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <div className={styles.input}>
        <select value={value} onChange={(event) => onChange(event.target.value as T)}>
          {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
      </div>
    </label>
  );
}

export default function MoneyPage() {
  const [state, setState] = useState<MoneyState>(emptyMoneyState);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [accountDraft, setAccountDraft] = useState({ name: "", type: "checking" as MoneyAccountType, balance: 0 });
  const [debtDraft, setDebtDraft] = useState({ name: "", type: "credit_card" as DebtType, balance: 0, apr: 0, minimumPayment: 0 });
  const [goalDraft, setGoalDraft] = useState({ name: "", targetAmount: 0, currentAmount: 0, targetDate: "", priority: "medium" as GoalPriority });
  const [transactionDraft, setTransactionDraft] = useState({ date: "", description: "", amount: 0, direction: "expense" as TransactionDirection, category: "Other", recurring: false });
  const [coachQuestion, setCoachQuestion] = useState("");
  const [coachAnswer, setCoachAnswer] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachSource, setCoachSource] = useState<"local" | "cloud" | "rules" | "">("");
  const [coachMode, setCoachMode] = useState<"local" | "cloud" | "rules">("local");
  const [localSupported, setLocalSupported] = useState(false);
  const [localStatus, setLocalStatus] = useState<"checking" | "unsupported" | "idle" | "loading" | "ready" | "error">("checking");
  const [localProgress, setLocalProgress] = useState(0);
  const [localProgressText, setLocalProgressText] = useState("Checking this device…");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.version === 2) setState({ ...emptyMoneyState, ...parsed });
      } else {
        const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) setState(migrateV1Profile(JSON.parse(legacy) as FinancialProfile));
      }
    } catch {
      // Local storage is optional.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const supported = localAISupported();
    setLocalSupported(supported);
    setLocalStatus(supported ? "idle" : "unsupported");
    setLocalProgressText(supported ? "Ready to download on this device" : "WebGPU is not available in this browser");
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The planner remains usable without persistence.
    }
  }, [loaded, state]);

  const analysis = useMemo(() => analyzeMoneyState(state), [state]);
  const hasData = state.accounts.length > 0 || state.debts.length > 0 || state.transactions.length > 0 || state.settings.monthlyIncomeOverride > 0;
  const firstAction = analysis.nextDollarActions[0];
  const emergencyTarget = Math.max(1, state.settings.emergencyTargetMonths || 4);
  const reserveProgress = Math.min(100, (analysis.emergencyMonths / emergencyTarget) * 100);
  const debtWithHighestApr = [...state.debts].filter((item) => item.type !== "mortgage").sort((a, b) => b.apr - a.apr)[0];

  const insight =
    analysis.freeCashFlow < 0
      ? { title: "Cash flow needs attention", body: "Monthly spending is above income. Solpient is holding back optional investing until that gap is closed.", tone: "danger" }
      : analysis.highestConsumerApr >= 15
        ? { title: "High-interest debt is the biggest drag", body: (debtWithHighestApr?.name ?? "Consumer debt") + " is costing " + analysis.highestConsumerApr.toFixed(1) + "% APR. That is why it ranks ahead of new market risk.", tone: "danger" }
        : analysis.emergencyMonths < emergencyTarget
          ? { title: "Your reserve is still being built", body: "You have " + analysis.emergencyMonths.toFixed(1) + " months of liquid runway against a " + emergencyTarget + "-month target.", tone: "watch" }
          : { title: "Foundation looks stable", body: "Cash flow, liquidity, and debt are not showing an urgent constraint. New surplus can move toward goals and long-term investing.", tone: "good" };

  const updateSettings = (key: keyof MoneyState["settings"], value: number) => {
    setState((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  };

  const addAccount = () => {
    if (!accountDraft.name.trim() || accountDraft.balance <= 0) return;
    const account: MoneyAccount = { id: uid("acct"), ...accountDraft, name: accountDraft.name.trim() };
    setState((current) => ({ ...current, accounts: [...current.accounts, account] }));
    setAccountDraft({ name: "", type: "checking", balance: 0 });
  };

  const addDebt = () => {
    if (!debtDraft.name.trim() || debtDraft.balance <= 0) return;
    const debt: DebtAccount = { id: uid("debt"), ...debtDraft, name: debtDraft.name.trim() };
    setState((current) => ({ ...current, debts: [...current.debts, debt] }));
    setDebtDraft({ name: "", type: "credit_card", balance: 0, apr: 0, minimumPayment: 0 });
  };

  const addGoal = () => {
    if (!goalDraft.name.trim() || goalDraft.targetAmount <= 0) return;
    const goal: MoneyGoal = { id: uid("goal"), ...goalDraft, name: goalDraft.name.trim() };
    setState((current) => ({ ...current, goals: [...current.goals, goal] }));
    setGoalDraft({ name: "", targetAmount: 0, currentAmount: 0, targetDate: "", priority: "medium" });
  };

  const addTransaction = () => {
    if (!transactionDraft.description.trim() || transactionDraft.amount <= 0) return;
    const transaction: MoneyTransaction = { id: uid("tx"), ...transactionDraft, date: transactionDraft.date || new Date().toISOString().slice(0, 10), description: transactionDraft.description.trim(), category: transactionDraft.category.trim() || "Other" };
    setState((current) => ({ ...current, transactions: [transaction, ...current.transactions].slice(0, 250) }));
    setTransactionDraft({ date: "", description: "", amount: 0, direction: "expense", category: "Other", recurring: false });
  };

  const remove = (collection: "accounts" | "debts" | "goals" | "transactions", itemId: string) => {
    setState((current) => {
      if (collection === "accounts") return { ...current, accounts: current.accounts.filter((item) => item.id !== itemId) };
      if (collection === "debts") return { ...current, debts: current.debts.filter((item) => item.id !== itemId) };
      if (collection === "goals") return { ...current, goals: current.goals.filter((item) => item.id !== itemId) };
      return { ...current, transactions: current.transactions.filter((item) => item.id !== itemId) };
    });
  };

  const prepareLocalAI = async () => {
    if (!localSupported || localStatus === "loading" || localStatus === "ready") return;
    setLocalStatus("loading");
    setLocalProgress(0);
    setLocalProgressText("Starting Private AI…");
    try {
      await loadLocalMoneyAI((report) => {
        setLocalProgress(report.progress);
        setLocalProgressText(report.text);
      });
      setLocalProgress(1);
      setLocalProgressText("Private AI ready");
      setLocalStatus("ready");
    } catch (error) {
      setLocalStatus("error");
      setLocalProgressText(error instanceof Error ? error.message : "Private AI could not start on this device.");
    }
  };

  const askCoach = async (question = coachQuestion) => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || coachLoading) return;
    setCoachQuestion(cleanQuestion);
    setCoachLoading(true);
    setCoachAnswer("");
    setCoachSource("");

    const summary = buildCoachSummary(analysis);

    try {
      if (coachMode === "local") {
        if (!localSupported) {
          setCoachAnswer("Private AI requires a WebGPU-capable browser. You can still use Rules mode without sending financial context to an AI provider.");
          setCoachSource("rules");
          return;
        }
        if (localStatus !== "ready") {
          setCoachAnswer("Enable Private AI first. The model is downloaded and cached in your browser only after you choose to load it.");
          setCoachSource("rules");
          return;
        }
        const answer = await askLocalMoneyAI(cleanQuestion, summary, (report) => {
          setLocalProgress(report.progress);
          setLocalProgressText(report.text);
        });
        setCoachAnswer(answer);
        setCoachSource("local");
        return;
      }

      if (coachMode === "rules") {
        setCoachAnswer(buildRulesMoneyExplanation(cleanQuestion, summary));
        setCoachSource("rules");
        return;
      }

      const response = await fetch("/api/money/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: cleanQuestion, summary }),
      });
      const payload = await response.json();
      setCoachAnswer(payload.answer ?? payload.error ?? "Solpient could not explain the plan.");
      setCoachSource(payload.source === "ai" ? "cloud" : "rules");
    } catch (error) {
      if (coachMode === "local") {
        setCoachAnswer("Private AI stopped unexpectedly. Your financial plan is unchanged; switch to Rules mode or reload the local model.");
        setCoachSource("rules");
        setLocalStatus("error");
        setLocalProgressText(error instanceof Error ? error.message : "Local generation failed.");
      } else {
        setCoachAnswer(buildRulesMoneyExplanation(cleanQuestion, summary));
        setCoachSource("rules");
      }
    } finally {
      setCoachLoading(false);
    }
  };

  const reset = () => {
    setState(emptyMoneyState);
    setCoachAnswer("");
    try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
  };

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}><strong>SOLPIENT</strong><span>Financial Intelligence</span></Link>
        <nav className={styles.globalNav}>
          <Link href="/">Home</Link>
          <Link href="/research">Research</Link>
          <Link className={styles.activeGlobal} href="/money">Money</Link>
        </nav>
        <div className={styles.status}>{loaded ? "Private · saved locally" : "Loading…"}</div>
      </header>

      <main className={styles.shell}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarIntro}><span>Money</span><strong>Your financial cockpit</strong></div>
          <nav className={styles.localNav}>
            {viewLabels.map((item) => (
              <button type="button" key={item.id} data-active={view === item.id} onClick={() => setView(item.id)}>
                <span>{item.icon}</span>{item.label}
              </button>
            ))}
          </nav>
          <div className={styles.sideSummary}>
            <span>Financial health</span>
            <div><strong>{hasData ? analysis.score : "—"}</strong><em>/100</em></div>
            <small>{hasData ? analysis.scoreLabel : "Add your numbers"}</small>
          </div>
          <div className={styles.sideActions}>
            <button type="button" onClick={() => setState(createDemoMoneyState(new Date()))}>Load example</button>
            <button type="button" onClick={reset}>Reset data</button>
          </div>
        </aside>

        <section className={styles.content}>
          <header className={styles.pageHeader}>
            <div>
              <span className={styles.kicker}>SOLPIENT MONEY</span>
              <h1>{view === "overview" ? "Your money, simplified." : viewLabels.find((item) => item.id === view)?.label}</h1>
              <p>{view === "overview" ? "One place to understand where you stand and what your next dollar should do." : "Edit the details here. Your overview stays focused on decisions, not data entry."}</p>
            </div>
            <div className={styles.headerActions}><button type="button" onClick={() => setView("accounts")}>+ Add financial data</button></div>
          </header>

          {view === "overview" ? (
            <div className={styles.overview}>
              <section className={styles.heroGrid}>
                <article className={styles.netWorthCard}>
                  <span>Net worth</span>
                  <strong>{hasData ? money(analysis.netWorth) : "—"}</strong>
                  <div className={styles.balanceSplit}>
                    <div><span>Assets</span><b>{money(analysis.assets)}</b></div>
                    <div><span>Debt</span><b>{money(analysis.debt)}</b></div>
                  </div>
                </article>
                <article className={styles.nextMoveCard}>
                  <div className={styles.cardEyebrow}>YOUR NEXT MOVE</div>
                  {firstAction ? (
                    <><h2>{firstAction.title}</h2><strong>{money(firstAction.amount)}</strong><p>{firstAction.reason}</p></>
                  ) : (
                    <><h2>Build your financial map</h2><strong>Start here</strong><p>Add income, spending, accounts, and debt so Solpient can calculate your first move.</p></>
                  )}
                  <button type="button" onClick={() => setView(firstAction?.kind === "debt" ? "debt" : "cashflow")}>Review plan →</button>
                </article>
              </section>

              <section className={styles.snapshotGrid}>
                <article><span>Monthly surplus</span><strong>{hasData ? money(analysis.freeCashFlow) : "—"}</strong><small>{hasData ? percent(analysis.savingsRate) + " savings rate" : "Income minus spending"}</small></article>
                <article><span>Liquid cash</span><strong>{hasData ? money(analysis.liquidCash) : "—"}</strong><small>{analysis.emergencyMonths.toFixed(1)} months of runway</small></article>
                <article><span>Highest APR</span><strong>{hasData ? analysis.highestConsumerApr.toFixed(1) + "%" : "—"}</strong><small>{debtWithHighestApr?.name ?? "No consumer debt"}</small></article>
                <article><span>Active goals</span><strong>{analysis.activeGoalCount}</strong><small>{state.goals.length ? "Track progress and target dates" : "No goals added"}</small></article>
              </section>

              <section className={styles.decisionGrid}>
                <article className={styles.planCard}>
                  <div className={styles.sectionHeader}><div><span className={styles.kicker}>PLAN</span><h2>Next Best Dollar</h2></div><button type="button" onClick={() => setView("cashflow")}>Edit assumptions</button></div>
                  <div className={styles.planList}>
                    {analysis.nextDollarActions.slice(0, 4).map((action, index) => (
                      <div key={action.id}><span>{index + 1}</span><div><strong>{action.title}</strong><small>{action.reason}</small></div><b>{money(action.amount)}</b></div>
                    ))}
                    {!analysis.nextDollarActions.length ? <p className={styles.empty}>No plan yet. Add your financial data.</p> : null}
                  </div>
                </article>
                <article className={styles.insightCard} data-tone={insight.tone}>
                  <span className={styles.kicker}>WHAT MATTERS NOW</span><h2>{insight.title}</h2><p>{insight.body}</p>
                  <div className={styles.healthLine}>
                    <div><span>Emergency reserve</span><strong>{analysis.emergencyMonths.toFixed(1)} / {emergencyTarget} months</strong></div>
                    <div className={styles.progress}><i style={{ width: reserveProgress + "%" }} /></div>
                  </div>
                </article>
              </section>

              <section className={styles.lowerGrid}>
                <article className={styles.cashCard}>
                  <div className={styles.sectionHeader}><div><span className={styles.kicker}>MONEY FLOW</span><h2>Where the month is going</h2></div><button type="button" onClick={() => setView("cashflow")}>View transactions</button></div>
                  <div className={styles.flowBar}>
                    <div><span>Income</span><strong>{money(analysis.monthlyIncome)}</strong></div>
                    <div><span>Spending</span><strong>{money(analysis.monthlyExpenses)}</strong></div>
                    <div><span>Left over</span><strong>{money(analysis.freeCashFlow)}</strong></div>
                  </div>
                  <div className={styles.spendingList}>
                    {analysis.topSpending.slice(0, 4).map((item) => (
                      <div key={item.category}><span>{item.category}</span><div className={styles.miniBar}><i style={{ width: Math.min(100, item.share * 100) + "%" }} /></div><b>{money(item.amount)}</b></div>
                    ))}
                    {!analysis.topSpending.length ? <p className={styles.empty}>Add recent expenses to see spending patterns.</p> : null}
                  </div>
                </article>
                <article className={styles.goalsPreview}>
                  <div className={styles.sectionHeader}><div><span className={styles.kicker}>GOALS</span><h2>What your money is for</h2></div><button type="button" onClick={() => setView("goals")}>Manage</button></div>
                  <div className={styles.goalPreviewList}>
                    {state.goals.slice(0, 3).map((goal) => {
                      const progress = goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
                      return <div key={goal.id}><div><strong>{goal.name}</strong><small>{dateLabel(goal.targetDate)}</small></div><div className={styles.goalTrack}><i style={{ width: progress + "%" }} /></div><span>{Math.round(progress)}%</span></div>;
                    })}
                    {!state.goals.length ? <p className={styles.empty}>No goals yet. Add one to give surplus money a purpose.</p> : null}
                  </div>
                </article>
              </section>

              <section className={styles.coach}>
                <div className={styles.coachIntro}>
                  <span className={styles.kicker}>ASK SOLPIENT</span>
                  <h2>Private by default.</h2>
                  <p>Use Qwen locally on this device, switch to cloud AI, or use the zero-AI rules explanation.</p>
                  <div className={styles.coachModeSwitch}>
                    <button type="button" data-active={coachMode === "local"} onClick={() => setCoachMode("local")}>Private AI</button>
                    <button type="button" data-active={coachMode === "cloud"} onClick={() => setCoachMode("cloud")}>Cloud AI</button>
                    <button type="button" data-active={coachMode === "rules"} onClick={() => setCoachMode("rules")}>Rules</button>
                  </div>
                </div>
                <div className={styles.coachBox}>
                  {coachMode === "local" ? (
                    <div className={styles.localAIStatus} data-status={localStatus}>
                      <div>
                        <strong>{localAIModelLabel()}</strong>
                        <span>
                          {localStatus === "ready"
                            ? "Running in your browser · no AI API"
                            : localStatus === "unsupported"
                              ? "This browser does not expose WebGPU"
                              : localProgressText}
                        </span>
                      </div>
                      {localStatus === "loading" ? (
                        <div className={styles.localProgress}>
                          <i style={{ width: Math.max(2, localProgress * 100) + "%" }} />
                        </div>
                      ) : null}
                      {(localStatus === "idle" || localStatus === "error") && localSupported ? (
                        <button type="button" onClick={prepareLocalAI}>
                          {localStatus === "error" ? "Try again" : "Enable Private AI"}
                        </button>
                      ) : null}
                    </div>
                  ) : coachMode === "cloud" ? (
                    <div className={styles.modeNote}>
                      Cloud AI sends only Solpient's privacy-safe summary and calculated action plan—not account names or raw transaction descriptions.
                    </div>
                  ) : (
                    <div className={styles.modeNote}>
                      Rules mode uses no AI model and makes no AI network request. It explains the deterministic Next Best Dollar sequence directly.
                    </div>
                  )}

                  <div className={styles.quickQuestions}>
                    {["Why is this first?", "What improves my score fastest?", "Can I invest more this month?"].map((question) => (
                      <button type="button" key={question} onClick={() => askCoach(question)}>{question}</button>
                    ))}
                  </div>
                  <div className={styles.coachComposer}>
                    <input value={coachQuestion} onChange={(event) => setCoachQuestion(event.target.value)} placeholder="Ask about your plan…" maxLength={600} />
                    <button type="button" disabled={coachLoading || !coachQuestion.trim()} onClick={() => askCoach()}>{coachLoading ? "…" : "Ask"}</button>
                  </div>
                  {coachAnswer ? (
                    <div className={styles.coachAnswer}>
                      <span>
                        {coachSource === "local"
                          ? "Private AI · on-device"
                          : coachSource === "cloud"
                            ? "Cloud AI"
                            : "Rules explanation"}
                      </span>
                      {coachAnswer}
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}

          {view === "cashflow" ? (
            <div className={styles.detailStack}>
              <section className={styles.detailCard}>
                <div className={styles.sectionHeader}><div><span className={styles.kicker}>BASELINE</span><h2>Monthly assumptions</h2></div><span className={styles.subtle}>Blank income/spending uses the last 31 days of transactions.</span></div>
                <div className={styles.formGrid}>
                  <NumberField label="Take-home income" value={state.settings.monthlyIncomeOverride} onChange={(value) => updateSettings("monthlyIncomeOverride", value)} />
                  <NumberField label="Monthly spending" value={state.settings.monthlyExpensesOverride} onChange={(value) => updateSettings("monthlyExpensesOverride", value)} />
                  <NumberField label="Retirement contribution" value={state.settings.monthlyRetirementContribution} onChange={(value) => updateSettings("monthlyRetirementContribution", value)} />
                  <NumberField label="Uncaptured employer match" value={state.settings.uncapturedEmployerMatchMonthly} onChange={(value) => updateSettings("uncapturedEmployerMatchMonthly", value)} />
                  <NumberField label="Emergency target" value={state.settings.emergencyTargetMonths} onChange={(value) => updateSettings("emergencyTargetMonths", Math.max(1, Math.min(12, value)))} suffix="months" />
                </div>
              </section>

              <section className={styles.detailCard}>
                <div className={styles.sectionHeader}><div><span className={styles.kicker}>TRANSACTIONS</span><h2>Recent money movement</h2></div><strong>{analysis.recentTransactionCount} recent</strong></div>
                <div className={styles.addRowTransaction}>
                  <TextField label="Date" value={transactionDraft.date} onChange={(value) => setTransactionDraft((current) => ({ ...current, date: value }))} type="date" />
                  <TextField label="Description" value={transactionDraft.description} onChange={(value) => setTransactionDraft((current) => ({ ...current, description: value }))} placeholder="Paycheck, groceries…" />
                  <NumberField label="Amount" value={transactionDraft.amount} onChange={(value) => setTransactionDraft((current) => ({ ...current, amount: value }))} />
                  <SelectField label="Type" value={transactionDraft.direction} onChange={(value) => setTransactionDraft((current) => ({ ...current, direction: value }))} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }, { value: "transfer", label: "Transfer" }]} />
                  <TextField label="Category" value={transactionDraft.category} onChange={(value) => setTransactionDraft((current) => ({ ...current, category: value }))} placeholder="Food, housing…" />
                  <button className={styles.addPrimary} type="button" onClick={addTransaction}>Add</button>
                </div>
                <div className={styles.table}>
                  {state.transactions.slice(0, 20).map((transaction) => (
                    <div className={styles.tableRow} key={transaction.id}><span>{dateLabel(transaction.date)}</span><div><strong>{transaction.description}</strong><small>{transaction.category}</small></div><b data-kind={transaction.direction}>{transaction.direction === "expense" ? "−" : transaction.direction === "income" ? "+" : ""}{money(transaction.amount)}</b><button type="button" onClick={() => remove("transactions", transaction.id)}>Remove</button></div>
                  ))}
                  {!state.transactions.length ? <p className={styles.empty}>No transactions yet.</p> : null}
                </div>
              </section>
            </div>
          ) : null}

          {view === "debt" ? (
            <div className={styles.detailStack}>
              <section className={styles.detailCard}>
                <div className={styles.sectionHeader}><div><span className={styles.kicker}>DEBT</span><h2>{money(analysis.debt)} outstanding</h2></div><span className={styles.subtle}>Highest consumer APR: {analysis.highestConsumerApr.toFixed(1)}%</span></div>
                <div className={styles.itemCards}>
                  {state.debts.map((debt) => <article key={debt.id}><div><span>{debtTypeLabels[debt.type]}</span><button type="button" onClick={() => remove("debts", debt.id)}>×</button></div><strong>{debt.name}</strong><b>{money(debt.balance)}</b><p>{debt.apr.toFixed(1)}% APR · minimum {money(debt.minimumPayment)}/mo</p></article>)}
                  {!state.debts.length ? <p className={styles.empty}>No debts added.</p> : null}
                </div>
              </section>
              <section className={styles.detailCard}>
                <div className={styles.sectionHeader}><div><span className={styles.kicker}>ADD DEBT</span><h2>New liability</h2></div></div>
                <div className={styles.formGrid}>
                  <TextField label="Name" value={debtDraft.name} onChange={(value) => setDebtDraft((current) => ({ ...current, name: value }))} placeholder="Visa, mortgage…" />
                  <SelectField label="Type" value={debtDraft.type} onChange={(value) => setDebtDraft((current) => ({ ...current, type: value }))} options={Object.entries(debtTypeLabels).map(([value, label]) => ({ value: value as DebtType, label }))} />
                  <NumberField label="Balance" value={debtDraft.balance} onChange={(value) => setDebtDraft((current) => ({ ...current, balance: value }))} />
                  <NumberField label="APR" value={debtDraft.apr} onChange={(value) => setDebtDraft((current) => ({ ...current, apr: value }))} suffix="%" />
                  <NumberField label="Minimum payment" value={debtDraft.minimumPayment} onChange={(value) => setDebtDraft((current) => ({ ...current, minimumPayment: value }))} />
                </div>
                <button className={styles.addPrimary} type="button" onClick={addDebt}>Add debt</button>
              </section>
            </div>
          ) : null}

          {view === "goals" ? (
            <div className={styles.detailStack}>
              <section className={styles.detailCard}>
                <div className={styles.sectionHeader}><div><span className={styles.kicker}>GOALS</span><h2>{analysis.activeGoalCount} active goals</h2></div></div>
                <div className={styles.itemCards}>
                  {state.goals.map((goal) => {
                    const progress = goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
                    return <article key={goal.id}><div><span>{goal.priority} priority</span><button type="button" onClick={() => remove("goals", goal.id)}>×</button></div><strong>{goal.name}</strong><b>{money(goal.currentAmount)} / {money(goal.targetAmount)}</b><p>{dateLabel(goal.targetDate)}</p><div className={styles.goalTrack}><i style={{ width: progress + "%" }} /></div></article>;
                  })}
                  {!state.goals.length ? <p className={styles.empty}>No goals added.</p> : null}
                </div>
              </section>
              <section className={styles.detailCard}>
                <div className={styles.sectionHeader}><div><span className={styles.kicker}>ADD GOAL</span><h2>Give your surplus a purpose</h2></div></div>
                <div className={styles.formGrid}>
                  <TextField label="Goal" value={goalDraft.name} onChange={(value) => setGoalDraft((current) => ({ ...current, name: value }))} placeholder="Trip, home repair…" />
                  <NumberField label="Target" value={goalDraft.targetAmount} onChange={(value) => setGoalDraft((current) => ({ ...current, targetAmount: value }))} />
                  <NumberField label="Already saved" value={goalDraft.currentAmount} onChange={(value) => setGoalDraft((current) => ({ ...current, currentAmount: value }))} />
                  <TextField label="Target date" value={goalDraft.targetDate} onChange={(value) => setGoalDraft((current) => ({ ...current, targetDate: value }))} type="date" />
                  <SelectField label="Priority" value={goalDraft.priority} onChange={(value) => setGoalDraft((current) => ({ ...current, priority: value }))} options={[{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
                </div>
                <button className={styles.addPrimary} type="button" onClick={addGoal}>Add goal</button>
              </section>
            </div>
          ) : null}

          {view === "accounts" ? (
            <div className={styles.detailStack}>
              <section className={styles.detailCard}>
                <div className={styles.sectionHeader}><div><span className={styles.kicker}>ACCOUNTS</span><h2>{money(analysis.assets)} in assets</h2></div></div>
                <div className={styles.itemCards}>
                  {state.accounts.map((account) => <article key={account.id}><div><span>{accountTypeLabels[account.type]}</span><button type="button" onClick={() => remove("accounts", account.id)}>×</button></div><strong>{account.name}</strong><b>{money(account.balance)}</b></article>)}
                  {!state.accounts.length ? <p className={styles.empty}>No accounts added.</p> : null}
                </div>
              </section>
              <section className={styles.detailCard}>
                <div className={styles.sectionHeader}><div><span className={styles.kicker}>ADD ACCOUNT</span><h2>New asset</h2></div></div>
                <div className={styles.formGrid}>
                  <TextField label="Account name" value={accountDraft.name} onChange={(value) => setAccountDraft((current) => ({ ...current, name: value }))} placeholder="Checking, TSP, brokerage…" />
                  <SelectField label="Type" value={accountDraft.type} onChange={(value) => setAccountDraft((current) => ({ ...current, type: value }))} options={Object.entries(accountTypeLabels).map(([value, label]) => ({ value: value as MoneyAccountType, label }))} />
                  <NumberField label="Balance" value={accountDraft.balance} onChange={(value) => setAccountDraft((current) => ({ ...current, balance: value }))} />
                </div>
                <button className={styles.addPrimary} type="button" onClick={addAccount}>Add account</button>
              </section>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
