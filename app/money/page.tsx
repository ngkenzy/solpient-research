"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  analyzeFinancialProfile,
  demoFinancialProfile,
  emptyFinancialProfile,
  type FinancialProfile,
} from "@/lib/financial-planner";
import styles from "./money.module.css";

const STORAGE_KEY = "solpient.money.profile.v1";

type NumericField = keyof FinancialProfile;

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function percent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function Field({
  label,
  field,
  value,
  onChange,
  suffix,
  hint,
}: {
  label: string;
  field: NumericField;
  value: number;
  onChange: (field: NumericField, value: number) => void;
  suffix?: string;
  hint?: string;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <div className={styles.inputWrap}>
        <input
          inputMode="decimal"
          min="0"
          step={suffix === "%" ? "0.1" : "1"}
          type="number"
          value={value || ""}
          onChange={(event) => onChange(field, Number(event.target.value) || 0)}
        />
        {suffix ? <em>{suffix}</em> : null}
      </div>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export default function MoneyPage() {
  const [profile, setProfile] = useState<FinancialProfile>(emptyFinancialProfile);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setProfile({ ...emptyFinancialProfile, ...JSON.parse(saved) });
      }
    } catch {
      // Local storage can be unavailable in privacy-restricted browsers.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch {
      // The planner remains usable even if persistence is unavailable.
    }
  }, [loaded, profile]);

  const result = useMemo(() => analyzeFinancialProfile(profile), [profile]);

  const update = (field: NumericField, value: number) => {
    setProfile((current) => ({ ...current, [field]: Math.max(0, value) }));
  };

  const hasProfile =
    profile.monthlyIncome > 0 ||
    profile.monthlyExpenses > 0 ||
    result.assets > 0 ||
    result.debt > 0;

  const reset = () => {
    setProfile(emptyFinancialProfile);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <strong>SOLPIENT</strong>
          <span>Financial Intelligence</span>
        </Link>
        <nav>
          <Link href="/">Home</Link>
          <Link href="/research">Research</Link>
          <Link className={styles.active} href="/money">Money</Link>
        </nav>
        <div className={styles.privacyPill}>Private browser profile</div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>SOLPIENT MONEY · V1</span>
            <h1>Know what your next dollar should do.</h1>
            <p>
              Turn income, cash, debt, retirement savings, and goals into one
              prioritized financial action plan. No bank connection is required.
            </p>
          </div>
          <div className={styles.heroActions}>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => setProfile(demoFinancialProfile)}
            >
              Load example
            </button>
            <button className={styles.secondaryButton} type="button" onClick={reset}>
              Reset
            </button>
          </div>
        </section>

        <section className={styles.metrics}>
          <article className={styles.scoreCard}>
            <span>Financial Health</span>
            <div>
              <strong>{hasProfile ? result.score : "—"}</strong>
              <em>/100</em>
            </div>
            <p>{hasProfile ? result.scoreLabel : "Add your numbers to begin"}</p>
          </article>
          <article>
            <span>Net worth</span>
            <strong>{hasProfile ? money(result.netWorth) : "—"}</strong>
            <p>{money(result.assets)} assets · {money(result.debt)} debt</p>
          </article>
          <article>
            <span>Monthly free cash flow</span>
            <strong>{hasProfile ? money(result.freeCashFlow) : "—"}</strong>
            <p>{hasProfile ? percent(result.savingsRate) + " of monthly income" : "Income minus monthly spending"}</p>
          </article>
          <article>
            <span>Emergency runway</span>
            <strong>{hasProfile ? result.emergencyMonths.toFixed(1) + " mo" : "—"}</strong>
            <p>Target: {profile.emergencyTargetMonths || 4} months</p>
          </article>
        </section>

        <div className={styles.workspace}>
          <section className={styles.profilePanel}>
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.eyebrow}>FINANCIAL PROFILE</span>
                <h2>Your numbers</h2>
              </div>
              <span className={styles.autoSave}>{loaded ? "Saved locally" : "Loading…"}</span>
            </div>

            <div className={styles.formSection}>
              <div className={styles.formHeading}>
                <strong>Cash flow</strong>
                <span>Use monthly take-home income. Include required minimum debt payments in expenses.</span>
              </div>
              <div className={styles.formGrid}>
                <Field label="Monthly income" field="monthlyIncome" value={profile.monthlyIncome} onChange={update} suffix="$" />
                <Field label="Monthly expenses" field="monthlyExpenses" value={profile.monthlyExpenses} onChange={update} suffix="$" />
                <Field
                  label="Monthly retirement contributions"
                  field="monthlyRetirementContribution"
                  value={profile.monthlyRetirementContribution}
                  onChange={update}
                  suffix="$"
                />
                <Field
                  label="Uncaptured employer match"
                  field="uncapturedEmployerMatchMonthly"
                  value={profile.uncapturedEmployerMatchMonthly}
                  onChange={update}
                  suffix="$"
                  hint="Monthly employer contribution available if you increase eligible contributions."
                />
              </div>
            </div>

            <div className={styles.formSection}>
              <div className={styles.formHeading}>
                <strong>Assets</strong>
                <span>Keep this first version simple. Property value can be included in Other assets.</span>
              </div>
              <div className={styles.formGrid}>
                <Field label="Cash & savings" field="cashSavings" value={profile.cashSavings} onChange={update} suffix="$" />
                <Field label="Retirement accounts" field="retirementBalance" value={profile.retirementBalance} onChange={update} suffix="$" />
                <Field label="Brokerage investments" field="brokerageBalance" value={profile.brokerageBalance} onChange={update} suffix="$" />
                <Field label="Other assets" field="otherAssets" value={profile.otherAssets} onChange={update} suffix="$" />
              </div>
            </div>

            <div className={styles.formSection}>
              <div className={styles.formHeading}>
                <strong>Debt</strong>
                <span>APR is used to sequence debt priorities. Mortgage debt is tracked but treated differently from consumer debt.</span>
              </div>
              <div className={styles.debtGrid}>
                <div className={styles.debtRow}>
                  <Field label="Credit card balance" field="creditCardBalance" value={profile.creditCardBalance} onChange={update} suffix="$" />
                  <Field label="APR" field="creditCardApr" value={profile.creditCardApr} onChange={update} suffix="%" />
                </div>
                <div className={styles.debtRow}>
                  <Field label="Auto loan balance" field="autoLoanBalance" value={profile.autoLoanBalance} onChange={update} suffix="$" />
                  <Field label="APR" field="autoLoanApr" value={profile.autoLoanApr} onChange={update} suffix="%" />
                </div>
                <div className={styles.debtRow}>
                  <Field label="Student loan balance" field="studentLoanBalance" value={profile.studentLoanBalance} onChange={update} suffix="$" />
                  <Field label="APR" field="studentLoanApr" value={profile.studentLoanApr} onChange={update} suffix="%" />
                </div>
                <div className={styles.debtRow}>
                  <Field label="Mortgage balance" field="mortgageBalance" value={profile.mortgageBalance} onChange={update} suffix="$" />
                  <Field label="APR" field="mortgageApr" value={profile.mortgageApr} onChange={update} suffix="%" />
                </div>
              </div>
            </div>

            <div className={styles.formSection}>
              <div className={styles.formHeading}>
                <strong>Planning preferences</strong>
                <span>This changes the reserve target used by the rules engine.</span>
              </div>
              <div className={styles.compactField}>
                <Field
                  label="Emergency fund target"
                  field="emergencyTargetMonths"
                  value={profile.emergencyTargetMonths}
                  onChange={update}
                  suffix="months"
                />
              </div>
            </div>
          </section>

          <aside className={styles.planPanel}>
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.eyebrow}>NEXT BEST DOLLAR</span>
                <h2>Your priority sequence</h2>
              </div>
            </div>

            {!hasProfile ? (
              <div className={styles.emptyPlan}>
                <div>◎</div>
                <strong>Build your financial map</strong>
                <p>
                  Enter your income, expenses, assets, and debt. Solpient will
                  convert them into an auditable action sequence.
                </p>
                <button type="button" onClick={() => setProfile(demoFinancialProfile)}>
                  Preview with sample data
                </button>
              </div>
            ) : (
              <>
                <div className={styles.available}>
                  <span>Available this month</span>
                  <strong>{money(Math.max(0, result.freeCashFlow))}</strong>
                  <small>
                    Rules-based allocation after the monthly expenses you entered.
                  </small>
                </div>

                <div className={styles.actionList}>
                  {result.nextDollarActions.map((action, index) => (
                    <article className={styles.action} data-tone={action.tone} key={action.id}>
                      <span className={styles.actionNumber}>{index + 1}</span>
                      <div>
                        <div className={styles.actionTitle}>
                          <strong>{action.title}</strong>
                          <b>{action.amount > 0 ? money(action.amount) : "Action"}</b>
                        </div>
                        <p>{action.reason}</p>
                      </div>
                    </article>
                  ))}
                </div>

                {result.debtInterestImpact > 0 ? (
                  <div className={styles.impactBox}>
                    <span>Approx. first-year interest avoided</span>
                    <strong>{money(result.debtInterestImpact)}</strong>
                    <small>
                      Simple APR estimate on the recommended principal reduction; actual
                      interest depends on timing, compounding, and lender terms.
                    </small>
                  </div>
                ) : null}

                <div className={styles.breakdown}>
                  <div className={styles.breakdownHeader}>
                    <strong>Health score</strong>
                    <span>{result.score}/100</span>
                  </div>
                  <div><span>Cash flow</span><b>{result.scoreBreakdown.cashFlow}/25</b></div>
                  <div><span>Liquidity</span><b>{result.scoreBreakdown.liquidity}/25</b></div>
                  <div><span>Consumer debt</span><b>{result.scoreBreakdown.debt}/30</b></div>
                  <div><span>Retirement contribution</span><b>{result.scoreBreakdown.retirement}/20</b></div>
                </div>
              </>
            )}

            <div className={styles.disclosure}>
              <strong>How v1 works</strong>
              <p>
                Calculations are deterministic and run in your browser. Solpient Money
                v1 does not connect to banks, move money, or recommend individual
                securities. This prototype is educational planning software, not tax,
                legal, or individualized investment advice.
              </p>
            </div>
          </aside>
        </div>

        <section className={styles.nextLayer}>
          <span className={styles.eyebrow}>PRODUCT ROADMAP</span>
          <h2>The intelligence layer comes first.</h2>
          <div>
            <article><b>01</b><strong>Money v1</strong><p>Manual financial map + Next Best Dollar.</p></article>
            <article><b>02</b><strong>Connected accounts</strong><p>Read-only bank, debt, and investment aggregation.</p></article>
            <article><b>03</b><strong>AI coach</strong><p>Explain the deterministic plan and answer financial questions.</p></article>
            <article><b>04</b><strong>Wealth</strong><p>Portfolio intelligence and, later, properly regulated advisory services.</p></article>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div><strong>SOLPIENT</strong><span>See clearly. Decide deliberately.</span></div>
        <span>Money v1 · local profile · deterministic planning</span>
      </footer>
    </div>
  );
}
