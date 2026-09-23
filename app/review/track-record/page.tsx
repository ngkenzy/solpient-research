import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { getAdminSupabase } from "@/lib/admin-supabase";
import { requireReviewAccess } from "@/lib/review-auth";
import styles from "../review.module.css";

export const dynamic="force-dynamic";
export const runtime="nodejs";

const pct=(v:unknown,d=1)=>Number.isFinite(Number(v))?Number(v).toFixed(d)+"%":"—";
const num=(v:unknown,d=2)=>Number.isFinite(Number(v))?Number(v).toFixed(d):"—";
const grade=(v:string)=>v.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());

export default async function TrackRecordPage(){
  await requireReviewAccess();
  const supabase=getAdminSupabase();
  if(!supabase)return null;

  const {data:run,error:runError}=await supabase
    .from("track_record_runs")
    .select("*")
    .order("as_of_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(runError)throw runError;

  let snapshots:any[]=[];
  let buckets:any[]=[];
  if(run){
    const [snapR,bucketR]=await Promise.all([
      supabase.from("track_record_scope_snapshots")
        .select("*")
        .eq("track_record_run_id",run.id)
        .order("scope_type")
        .order("verified_sample_size",{ascending:false}),
      supabase.from("track_record_calibration_buckets")
        .select("*,track_record_scope_snapshots!inner(track_record_run_id,scope_type,scope_key)")
        .eq("track_record_scope_snapshots.track_record_run_id",run.id)
        .order("lower_bound"),
    ]);
    if(snapR.error)throw snapR.error;
    if(bucketR.error)throw bucketR.error;
    snapshots=snapR.data??[];
    buckets=bucketR.data??[];
  }

  const global=snapshots.find(s=>s.scope_type==="global"&&s.scope_key==="all")??null;
  const companies=snapshots.filter(s=>s.scope_type==="company");
  const models=snapshots.filter(s=>s.scope_type==="model");
  const metrics=snapshots.filter(s=>s.scope_type==="metric");
  const globalProb=buckets.filter(b=>b.track_record_scope_snapshots?.scope_type==="global"&&b.calibration_type==="probability");
  const globalConf=buckets.filter(b=>b.track_record_scope_snapshots?.scope_type==="global"&&b.calibration_type==="confidence");

  return <>
    <header className={styles.header}>
      <SolpientBrand subtitle="Verified Track Record" />
      <div>
        <Link href="/review">Research Review</Link>
        <Link href="/review/readiness-repair">Readiness Repair</Link>
        <Link href="/research">Public Research</Link>
      </div>
    </header>

    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>IMMUTABLE FORECAST ACCOUNTABILITY</span>
          <h1>Verified Track Record & Calibration</h1>
          <p>
            Locked forecasts are scored only after outcomes become observable. Calibration is
            reported separately for numeric error, directional calls, probabilities, confidence,
            and benchmark-relative results. Small samples are labeled explicitly.
          </p>
        </div>
        <div className={styles.heroProgress}>
          <span>Sample grade</span>
          <strong>{global?grade(global.sample_grade):"No history"}</strong>
          <small>{global?.verified_sample_size??0} verified outcomes</small>
        </div>
      </section>

      {!run||!global?(
        <section className={styles.preparePanel}>
          <div>
            <span className={styles.kicker}>LEDGER READY</span>
            <h2>No realized forecast outcomes yet.</h2>
            <p>
              Solpient currently has locked forecasts, but the first outcomes have not matured.
              This page will populate automatically after realized outcomes are verified and the
              calibration materializer runs.
            </p>
          </div>
        </section>
      ):<>
        <section className={styles.opsGrid}>
          <div className={styles.opsCard}><span>Verified outcomes</span><strong>{global.verified_sample_size}</strong><small>{grade(global.sample_grade)} sample</small></div>
          <div className={styles.opsCard}><span>Direction accuracy</span><strong>{pct(global.direction_metrics?.accuracy)}</strong><small>n={global.direction_metrics?.sample_size??0}</small></div>
          <div className={styles.opsCard}><span>Median numeric error</span><strong>{pct(global.numeric_metrics?.median_ape)}</strong><small>absolute percentage error</small></div>
          <div className={styles.opsCard}><span>Brier score</span><strong>{num(global.probability_metrics?.brier_score,3)}</strong><small>lower is better · n={global.probability_metrics?.sample_size??0}</small></div>
          <div className={styles.opsCard}><span>Benchmark win rate</span><strong>{pct(global.benchmark_relative_metrics?.benchmark_win_rate)}</strong><small>n={global.benchmark_relative_metrics?.sample_size??0}</small></div>
        </section>

        <section className={styles.preparePanel}>
          <div>
            <span className={styles.kicker}>INTERPRETATION</span>
            <h2>{grade(global.sample_grade)} sample</h2>
            <p>{global.caveat}</p>
          </div>
        </section>

        <section className={styles.detailGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><span className={styles.kicker}>PROBABILITY RELIABILITY</span><h2>Forecast probability vs outcome rate</h2></div><strong>{globalProb.reduce((s,b)=>s+b.sample_size,0)}</strong></div>
            <div className={styles.gapList}>
              {globalProb.length?globalProb.map((b:any)=><div key={b.id}>
                <strong>{b.lower_bound}–{b.upper_bound}% forecasts</strong>
                <span>mean forecast {pct(b.mean_forecast_probability)} · observed {pct(b.observed_rate)} · n={b.sample_size}</span>
              </div>):<span>Not enough resolved probability forecasts for calibration buckets.</span>}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><span className={styles.kicker}>CONFIDENCE CALIBRATION</span><h2>Snapshot confidence vs directional correctness</h2></div><strong>{globalConf.reduce((s,b)=>s+b.sample_size,0)}</strong></div>
            <div className={styles.gapList}>
              {globalConf.length?globalConf.map((b:any)=><div key={b.id}>
                <strong>{b.lower_bound}–{b.upper_bound}% confidence</strong>
                <span>mean confidence {pct(b.mean_forecast_probability)} · correct {pct(b.observed_rate)} · n={b.sample_size}</span>
              </div>):<span>Confidence calibration waits for genuinely directional outcomes; positive level forecasts are not counted as directional calls.</span>}
            </div>
          </section>
        </section>

        <section className={styles.queueHeader}>
          <div><span className={styles.kicker}>COMPANY TRACK RECORD</span><h2>{companies.length} companies with forecast history</h2></div>
          <span>Never rank tiny samples as skill</span>
        </section>
        <section className={styles.queue}>
          {companies.map((s:any)=><div className={styles.panel} key={s.id}>
            <div className={styles.panelHeader}>
              <div><span className={styles.kicker}>{grade(s.sample_grade)} · n={s.verified_sample_size}</span><h2>{s.label}</h2></div>
              <strong>{pct(s.direction_metrics?.accuracy)}</strong>
            </div>
            <div className={styles.opsGrid}>
              <div className={styles.opsCard}><span>Median APE</span><strong>{pct(s.numeric_metrics?.median_ape)}</strong><small>n={s.numeric_metrics?.sample_size??0}</small></div>
              <div className={styles.opsCard}><span>Brier</span><strong>{num(s.probability_metrics?.brier_score,3)}</strong><small>n={s.probability_metrics?.sample_size??0}</small></div>
              <div className={styles.opsCard}><span>Excess return</span><strong>{pct(s.benchmark_relative_metrics?.mean_excess_return)}</strong><small>mean · n={s.benchmark_relative_metrics?.sample_size??0}</small></div>
            </div>
            <p>{s.caveat}</p>
          </div>)}
        </section>

        <section className={styles.detailGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><span className={styles.kicker}>MODEL BREAKDOWN</span><h2>By model version</h2></div><strong>{models.length}</strong></div>
            <div className={styles.gapList}>
              {models.map((s:any)=><div key={s.id}><strong>{s.label}</strong><span>{grade(s.sample_grade)} · n={s.verified_sample_size} · direction {pct(s.direction_metrics?.accuracy)} · median APE {pct(s.numeric_metrics?.median_ape)}</span></div>)}
            </div>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><span className={styles.kicker}>METRIC BREAKDOWN</span><h2>By forecast target</h2></div><strong>{metrics.length}</strong></div>
            <div className={styles.gapList}>
              {metrics.slice(0,20).map((s:any)=><div key={s.id}><strong>{s.label}</strong><span>{grade(s.sample_grade)} · n={s.verified_sample_size} · median APE {pct(s.numeric_metrics?.median_ape)} · Brier {num(s.probability_metrics?.brier_score,3)}</span></div>)}
            </div>
          </section>
        </section>
      </>}
    </main>
  </>;
}
