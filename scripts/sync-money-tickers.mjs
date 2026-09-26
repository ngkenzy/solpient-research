// scripts/sync-money-tickers.mjs
//
// Money → Research ticker bridge.
//
// Syncs Kz's holdings tickers from the local-first solpient-money Postgres
// into the research coverage universe (research public.companies).
//
// PRIVACY BOUNDARY: only ticker, name, holding_kind and sector are ever read
// from the money database. Shares, prices, cost basis and market values are
// never selected, never logged and never leave the money database.
//
// Behavior:
//   - reads DISTINCT tickers from money public.holdings
//   - inserts tickers missing from research public.companies
//   - updates company_name / sector (/ holding_kind when the column exists)
//     on tickers that already exist
//   - never deletes anything; idempotent (a second run changes nothing)
//
// Research connection (survives the hosted-Supabase → self-owned-Postgres
// migration):
//   --research-db / RESEARCH_DATABASE_URL / SUPABASE_URL (fallback chain)
//   - postgres:// URL  -> raw Postgres wire-protocol client (node builtins,
//     no npm deps), works against any Postgres incl. the Docker/local one
//   - https:// URL      -> @supabase/supabase-js PostgREST client with the
//     service-role key (works against hosted Supabase and self-hosted stacks)
//
// Money connection:
//   --money-db / MONEY_DATABASE_URL / MONEY_APP_DIR/.env.local DATABASE_URL
//
// Usage:
//   node scripts/sync-money-tickers.mjs [--dry-run] [--money-db <url>]
//       [--research-db <url>] [--money-app-dir <path>] [--all-kinds] [--help]

import net from "node:net";
import tls from "node:tls";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import process from "node:process";
import path from "node:path";
import { readFile } from "node:fs/promises";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Environment already supplied; nothing to load.
  }
}

// ---------------------------------------------------------------------------
// Pure mapping / planning logic (imported by the test script, no DB needed)
// ---------------------------------------------------------------------------

export const EQUITY_KINDS = ["stock", "etf"];
const KIND_ALLOWLIST = new Set(["stock", "etf", "bond", "cash"]);

/** Uppercase, trimmed ticker; "" when missing. */
export function normalizeTicker(ticker) {
  return typeof ticker === "string" ? ticker.trim().toUpperCase() : "";
}

/** Money uses "Other" as its default sector; research treats that as unknown. */
export function normalizeSector(sector) {
  const s = typeof sector === "string" ? sector.trim() : "";
  return s === "" || s.toLowerCase() === "other" ? null : s;
}

/**
 * Parameter-free SQL: kinds are interpolated from a fixed allowlist, never
 * from user input. Selects ONLY the four bridge columns — the privacy
 * boundary lives in this column list.
 */
export function buildMoneyTickerQuery({ kinds = EQUITY_KINDS } = {}) {
  const safe = [...new Set(kinds)].filter((k) => KIND_ALLOWLIST.has(k));
  if (safe.length === 0) throw new Error("No valid holding kinds requested.");
  const kindList = safe.map((k) => `'${k}'`).join(",");
  return (
    `select distinct on (upper(btrim(ticker))) upper(btrim(ticker)) as ticker,` +
    ` name, holding_kind, sector` +
    ` from public.holdings` +
    ` where ticker is not null and btrim(ticker) <> ''` +
    ` and holding_kind in (${kindList})` +
    ` order by upper(btrim(ticker)), updated_at desc`
  );
}

/** Normalize + dedupe money rows by ticker (query is already DISTINCT ON; this is defensive). */
export function dedupeMoneyRows(rows) {
  const seen = new Map();
  for (const row of rows ?? []) {
    const ticker = normalizeTicker(row?.ticker);
    if (!ticker || seen.has(ticker)) continue;
    const name = typeof row?.name === "string" && row.name.trim() !== "" ? row.name.trim() : ticker;
    seen.set(ticker, {
      ticker,
      name,
      holding_kind: typeof row?.holding_kind === "string" ? row.holding_kind : null,
      sector: typeof row?.sector === "string" ? row.sector : null,
    });
  }
  return [...seen.values()];
}

/**
 * Decide what to create / update / leave alone.
 * existingCompanies: [{ticker, company_name, sector, holding_kind?}]
 * Returns { creates:[{ticker,company_name,sector,holding_kind?}],
 *           updates:[{ticker, ...changedFields}], unchanged:<n> }
 */
export function decideSyncPlan(moneyTickers, existingCompanies, { includeKind = false } = {}) {
  const existing = new Map();
  for (const c of existingCompanies ?? []) {
    const t = normalizeTicker(c?.ticker);
    if (t && !existing.has(t)) {
      existing.set(t, {
        company_name: typeof c?.company_name === "string" ? c.company_name : "",
        sector: typeof c?.sector === "string" ? c.sector : null,
        holding_kind: typeof c?.holding_kind === "string" ? c.holding_kind : null,
      });
    }
  }
  const creates = [];
  const updates = [];
  let unchanged = 0;
  for (const m of dedupeMoneyRows(moneyTickers)) {
    const e = existing.get(m.ticker);
    const sector = normalizeSector(m.sector);
    const base = { ticker: m.ticker, company_name: m.name, sector };
    if (includeKind) base.holding_kind = m.holding_kind;
    if (!e) {
      creates.push(base);
      continue;
    }
    const patch = { ticker: m.ticker };
    if (m.name !== e.company_name) patch.company_name = m.name;
    // Never overwrite a real research sector with money's "unknown".
    if (sector !== null && sector !== e.sector) patch.sector = sector;
    if (includeKind && m.holding_kind !== null && m.holding_kind !== e.holding_kind) {
      patch.holding_kind = m.holding_kind;
    }
    if (Object.keys(patch).length === 1) unchanged += 1;
    else updates.push(patch);
  }
  return { creates, updates, unchanged };
}

export function summarizePlan(plan) {
  return {
    create: plan.creates.length,
    update: plan.updates.length,
    unchanged: plan.unchanged,
  };
}

// ---------------------------------------------------------------------------
// Postgres connection-string parsing (node builtins only)
// ---------------------------------------------------------------------------

export function parsePgUrl(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`Invalid Postgres connection string: ${String(connectionString).slice(0, 24)}…`);
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new Error(`Not a postgres:// URL (got protocol "${url.protocol}").`);
  }
  return {
    host: url.hostname || "127.0.0.1",
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, "") || "postgres"),
    user: decodeURIComponent(url.username || "postgres"),
    password: decodeURIComponent(url.password || ""),
    sslmode: (url.searchParams.get("sslmode") || "prefer").toLowerCase(),
  };
}

// ---------------------------------------------------------------------------
// SCRAM-SHA-256 client (RFC 5802). Exported for the unit test.
// ---------------------------------------------------------------------------

export function computeScramProof({ username, password, clientNonce, serverFirstMessage, hash = "sha256" }) {
  if (hash !== "sha1" && hash !== "sha256") throw new Error(`Unsupported SCRAM hash: ${hash}`);
  const digestLen = hash === "sha1" ? 20 : 32;
  const attrs = {};
  for (const part of String(serverFirstMessage).split(",")) attrs[part[0]] = part.slice(2);
  const serverNonce = attrs.r;
  const salt = Buffer.from(attrs.s ?? "", "base64");
  const iterations = Number.parseInt(attrs.i ?? "0", 10);
  if (!serverNonce || !serverNonce.startsWith(clientNonce)) {
    throw new Error("SCRAM server nonce does not extend the client nonce.");
  }
  if (!Number.isFinite(iterations) || iterations < 1) throw new Error("Bad SCRAM iteration count.");
  const saltedPassword = pbkdf2Sync(String(password), salt, iterations, digestLen, hash);
  const clientKey = createHmac(hash, saltedPassword).update("Client Key").digest();
  const storedKey = createHash(hash).update(clientKey).digest();
  const clientFirstBare = `n=${username},r=${clientNonce}`;
  const clientFinalWithoutProof = `c=biws,r=${serverNonce}`;
  const authMessage = `${clientFirstBare},${serverFirstMessage},${clientFinalWithoutProof}`;
  const clientSignature = createHmac(hash, storedKey).update(authMessage).digest();
  const proof = Buffer.from(clientKey.map((b, i) => b ^ clientSignature[i]));
  const serverKey = createHmac(hash, saltedPassword).update("Server Key").digest();
  const serverSignature = createHmac(hash, serverKey).update(authMessage).digest().toString("base64");
  return {
    clientFinalMessage: `${clientFinalWithoutProof},p=${proof.toString("base64")}`,
    serverSignature,
  };
}

// ---------------------------------------------------------------------------
// Minimal Postgres wire-protocol client (simple query protocol).
// No npm dependencies; supports trust, MD5 and SCRAM-SHA-256 auth.
// ---------------------------------------------------------------------------

function writeCString(buffers, str) {
  buffers.push(Buffer.from(str, "utf8"));
  buffers.push(Buffer.from([0]));
}

function frameMessage(type, buildPayload) {
  const parts = [];
  buildPayload(parts);
  const payload = Buffer.concat(parts);
  const header = Buffer.alloc(5);
  header.writeUInt8(type.charCodeAt(0), 0);
  header.writeUInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

function frameQuery(sql) {
  return frameMessage("Q", (parts) => writeCString(parts, sql));
}

export class RawPgClient {
  constructor(connectionString) {
    this.params = parsePgUrl(connectionString);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
  }

  _feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const ready = this.waiters.splice(0);
    for (const w of ready) w();
  }

  async _readBytes(n) {
    while (this.buffer.length < n) {
      await new Promise((resolve, reject) => {
        const onErr = (err) => reject(err);
        this.socket.once("error", onErr);
        this.waiters.push(() => {
          this.socket.off("error", onErr);
          resolve();
        });
      });
    }
    const out = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }

  async _readMessage() {
    const header = await this._readBytes(5);
    const type = String.fromCharCode(header[0]);
    const length = header.readUInt32BE(1) - 4;
    const payload = await this._readBytes(length);
    return { type, payload };
  }

  _send(buf) {
    return new Promise((resolve, reject) => {
      this.socket.write(buf, (err) => (err ? reject(err) : resolve()));
    });
  }

  _pgError(payload, prefix) {
    const fields = {};
    let i = 0;
    while (i < payload.length && payload[i] !== 0) {
      const code = String.fromCharCode(payload[i]);
      const end = payload.indexOf(0, i + 1);
      fields[code] = payload.toString("utf8", i + 1, end);
      i = end + 1;
    }
    const err = new Error(`${prefix}: ${fields.M || fields.S || "unknown error"}`);
    err.code = fields.C;
    return err;
  }

  _md5Password(user, password, salt) {
    const inner = createHash("md5").update(password + user, "utf8").digest("hex");
    return "md5" + createHash("md5").update(inner + salt.toString("binary"), "binary").digest("hex");
  }

  async _authenticate() {
    for (;;) {
      const { type, payload } = await this._readMessage();
      if (type === "R") {
        const authType = payload.readUInt32BE(0);
        if (authType === 0) continue; // AuthenticationOk
        if (authType === 5) {
          // MD5
          const salt = payload.subarray(4, 8);
          const hashed = this._md5Password(this.params.user, this.params.password, salt);
          await this._send(frameMessage("p", (p) => writeCString(p, hashed)));
          continue;
        }
        if (authType === 10) {
          // SASL: pick SCRAM-SHA-256
          const mechanisms = payload.toString("utf8", 4).split("\0").filter(Boolean);
          if (!mechanisms.includes("SCRAM-SHA-256")) {
            throw new Error(`Server SASL mechanisms not supported: ${mechanisms.join(",")}`);
          }
          const clientNonce = randomBytes(18).toString("base64");
          const clientFirst = `n,,n=${this.params.user},r=${clientNonce}`;
          await this._send(
            frameMessage("p", (p) => {
              writeCString(p, "SCRAM-SHA-256");
              const body = Buffer.from(clientFirst, "utf8");
              const len = Buffer.alloc(4);
              len.writeInt32BE(body.length, 0);
              p.push(len, body);
            })
          );
          const cont = await this._readMessage();
          if (cont.type !== "R" || cont.payload.readUInt32BE(0) !== 11) {
            throw new Error("Expected SASLContinue from server.");
          }
          const serverFirst = cont.payload.toString("utf8", 4);
          const { clientFinalMessage, serverSignature } = computeScramProof({
            username: this.params.user,
            password: this.params.password,
            clientNonce,
            serverFirstMessage: serverFirst,
          });
          await this._send(frameMessage("p", (p) => p.push(Buffer.from(clientFinalMessage, "utf8"))));
          const fin = await this._readMessage();
          if (fin.type !== "R" || fin.payload.readUInt32BE(0) !== 12) {
            throw new Error("Expected SASLFinal from server.");
          }
          const serverFinal = fin.payload.toString("utf8", 4);
          const sig = Object.fromEntries(serverFinal.split(",").map((s) => [s[0], s.slice(2)]));
          if (sig.v !== serverSignature) throw new Error("SCRAM server signature mismatch.");
          continue;
        }
        throw new Error(`Unsupported Postgres auth type ${authType}.`);
      }
      if (type === "E") throw this._pgError(payload, "Postgres authentication failed");
      if (type === "Z") return; // ReadyForQuery
      // S (ParameterStatus), K (BackendKeyData), N (Notice): ignore during startup
    }
  }

  async _maybeUpgradeTls() {
    const mode = this.params.sslmode;
    if (mode === "disable") return;
    const req = Buffer.alloc(8);
    req.writeInt32BE(8, 0);
    req.writeInt32BE(80877103, 4); // SSLRequest
    await this._send(req);
    const verdict = await this._readBytes(1);
    if (verdict[0] === 0x53) {
      // 'S': server accepts SSL
      await new Promise((resolve, reject) => {
        const secure = tls.connect({ socket: this.socket, rejectUnauthorized: false });
        secure.once("secureConnect", () => {
          this.socket.removeAllListeners("data");
          this.socket = secure;
          secure.on("data", (c) => this._feed(c));
          secure.on("error", () => {});
          resolve();
        });
        secure.once("error", (err) => {
          if (mode === "require") reject(err);
          else resolve(); // fall back to plaintext below
        });
      });
      return;
    }
    if (mode === "require") throw new Error("Server refused SSL but sslmode=require.");
    // 'N': plaintext fallback for prefer/allow
  }

  async connect() {
    const { host, port } = this.params;
    this.socket = net.createConnection({ host, port });
    this.socket.on("data", (c) => this._feed(c));
    this.socket.on("error", () => {});
    this.socket.setTimeout(15000, () => {
      this.socket.destroy(new Error("Connection timed out."));
    });
    await new Promise((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
    });
    try {
      await this._maybeUpgradeTls();
      const parts = [];
      const payloadParts = [];
      writeCString(payloadParts, "user");
      writeCString(payloadParts, this.params.user);
      writeCString(payloadParts, "database");
      writeCString(payloadParts, this.params.database);
      writeCString(payloadParts, "client_encoding");
      writeCString(payloadParts, "UTF8");
      writeCString(payloadParts, "application_name");
      writeCString(payloadParts, "solpient-money-ticker-bridge");
      payloadParts.push(Buffer.from([0]));
      const payload = Buffer.concat(payloadParts);
      const header = Buffer.alloc(8);
      header.writeInt32BE(payload.length + 8, 0);
      header.writeInt32BE(196608, 4);
      parts.push(header, payload);
      await this._send(Buffer.concat(parts));
      await this._authenticate();
    } catch (err) {
      await this.end().catch(() => {});
      throw err;
    }
  }

  async query(sql) {
    await this._send(frameQuery(sql));
    const fields = [];
    const rows = [];
    for (;;) {
      const { type, payload } = await this._readMessage();
      if (type === "T") {
        let o = 2;
        const count = payload.readUInt16BE(0);
        for (let i = 0; i < count; i++) {
          const end = payload.indexOf(0, o);
          fields.push(payload.toString("utf8", o, end));
          o = end + 1 + 4 + 2 + 4 + 2 + 4 + 2;
        }
      } else if (type === "D") {
        const count = payload.readUInt16BE(0);
        let o = 2;
        const row = [];
        for (let i = 0; i < count; i++) {
          const len = payload.readInt32BE(o);
          o += 4;
          if (len === -1) row.push(null);
          else {
            row.push(payload.toString("utf8", o, o + len));
            o += len;
          }
        }
        rows.push(row);
      } else if (type === "E") {
        throw this._pgError(payload, "Postgres query failed");
      } else if (type === "Z") {
        break;
      }
      // C (CommandComplete), N (Notice), S (ParameterStatus): ignored
    }
    return { fields, rows };
  }

  async end() {
    if (this.socket && !this.socket.destroyed) {
      try {
        await this._send(Buffer.from([0x58, 0, 0, 0, 4])); // Terminate
      } catch {
        // best effort
      }
      this.socket.destroy();
    }
    this.socket = null;
  }
}

/** Quote a text literal for the simple query protocol (no bind params). */
export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Research writers
// ---------------------------------------------------------------------------

function kindColumnSql(hasKind) {
  return hasKind ? ", holding_kind" : "";
}

export async function createRestResearchWriter({ baseUrl, serviceKey }) {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(baseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Does public.companies have a holding_kind column? (optional, no migration needed)
  let includeKind = false;
  const probe = await sb.from("companies").select("holding_kind").limit(1);
  if (!probe.error) includeKind = true;
  else if (probe.error.code !== "42703") throw probe.error;

  const fetchExisting = async () => {
    const select = includeKind
      ? "ticker,company_name,sector,holding_kind"
      : "ticker,company_name,sector";
    const { data, error } = await sb.from("companies").select(select).order("ticker");
    if (error) throw error;
    return data ?? [];
  };

  const apply = async (plan) => {
    let created = 0;
    let updated = 0;
    for (let i = 0; i < plan.creates.length; i += 200) {
      const batch = plan.creates.slice(i, i + 200);
      const { error } = await sb.from("companies").insert(batch);
      if (error) throw error;
      created += batch.length;
    }
    for (let i = 0; i < plan.updates.length; i += 200) {
      const batch = plan.updates.slice(i, i + 200);
      const { error } = await sb.from("companies").upsert(batch, { onConflict: "ticker" });
      if (error) throw error;
      updated += batch.length;
    }
    return { created, updated, includeKind };
  };

  return { kind: "rest", includeKind, fetchExisting, apply };
}

export function createPgResearchWriter(pg) {
  const detectKind = async () => {
    const { rows } = await pg.query(
      `select 1 from information_schema.columns` +
        ` where table_schema='public' and table_name='companies' and column_name='holding_kind' limit 1`
    );
    return rows.length > 0;
  };

  const fetchExisting = async (includeKind) => {
    const { rows, fields } = await pg.query(
      `select ticker, company_name, sector${includeKind ? ", holding_kind" : ""} from public.companies order by ticker`
    );
    return rows.map((r) => Object.fromEntries(fields.map((f, i) => [f, r[i]])));
  };

  const apply = async (plan, includeKind) => {
    const cols = ["ticker", "company_name", "sector"];
    if (includeKind) cols.push("holding_kind");
    let created = 0;
    let updated = 0;
    await pg.query("begin");
    try {
      if (plan.creates.length > 0) {
        const values = plan.creates
          .map((c) => `(${cols.map((col) => sqlLiteral(c[col])).join(",")})`)
          .join(",");
        const res = await pg.query(
          `insert into public.companies (${cols.join(",")}) values ${values}` +
            ` on conflict (ticker) do nothing returning ticker`
        );
        created = res.rows.length;
      }
      for (const u of plan.updates) {
        const sets = Object.keys(u)
          .filter((k) => k !== "ticker")
          .map((k) => `${k}=${sqlLiteral(u[k])}`)
          .join(",");
        if (sets) {
          await pg.query(
            `update public.companies set ${sets}, updated_at=now() where ticker=${sqlLiteral(u.ticker)}`
          );
          updated += 1;
        }
      }
      await pg.query("commit");
    } catch (err) {
      await pg.query("rollback").catch(() => {});
      throw err;
    }
    return { created, updated, includeKind };
  };

  return { kind: "pg", detectKind, fetchExisting, apply };
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function readEnvFileValue(dir, key) {
  // Best-effort parse of a KEY=VALUE dotenv file (money repo .env.local).
  return readFile(path.join(dir, ".env.local"), "utf8")
    .then((text) => {
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && m[1] === key) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          return v || null;
        }
      }
      return null;
    })
    .catch(() => null);
}

export async function resolveMoneyDbUrl({ moneyDb, moneyAppDir }) {
  if (moneyDb) return moneyDb;
  if (process.env.MONEY_DATABASE_URL?.trim()) return process.env.MONEY_DATABASE_URL.trim();
  const appDir = moneyAppDir || process.env.MONEY_APP_DIR?.trim();
  if (appDir) {
    const fromFile = await readEnvFileValue(appDir, "DATABASE_URL");
    if (fromFile) return fromFile;
  }
  throw new Error(
    "Money database URL not found. Provide --money-db <postgres://...>, set MONEY_DATABASE_URL, " +
      "or set MONEY_APP_DIR to the solpient-money checkout so DATABASE_URL can be read from its .env.local."
  );
}

export function resolveResearchConfig({ researchDb } = {}) {
  const url = researchDb || process.env.RESEARCH_DATABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Research database URL not found. Provide --research-db <url>, set RESEARCH_DATABASE_URL, " +
        "or set SUPABASE_URL."
    );
  }
  if (/^postgres(ql)?:\/\//i.test(url)) return { mode: "pg", url };
  const serviceKey =
    process.env.RESEARCH_SERVICE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!serviceKey) {
    throw new Error(
      "Research target is a Supabase REST URL but no service key was found. " +
        "Set RESEARCH_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  return { mode: "rest", url, serviceKey };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { dryRun: false, allKinds: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--all-kinds") opts.allKinds = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--money-db") opts.moneyDb = argv[++i];
    else if (a === "--research-db") opts.researchDb = argv[++i];
    else if (a === "--money-app-dir") opts.moneyAppDir = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

const HELP = `sync-money-tickers.mjs — money → research ticker bridge

Reads DISTINCT ticker/name/kind/sector from the money app's public.holdings
and upserts them into the research app's public.companies (insert new,
update name/sector/kind on existing, never delete).

Privacy: shares, prices, cost basis and market values are never selected.

Flags:
  --dry-run            print the planned creates/updates without writing
  --money-db <url>     money Postgres URL (default: MONEY_DATABASE_URL,
                       or DATABASE_URL from MONEY_APP_DIR/.env.local)
  --research-db <url>  research target: postgres:// URL for direct Postgres,
                       https:// URL for Supabase REST
                       (default: RESEARCH_DATABASE_URL, else SUPABASE_URL)
  --money-app-dir <p>  solpient-money checkout dir (reads its .env.local)
  --all-kinds          include bond/cash holdings (default: stock,etf only)
  --help               this text

Env vars:
  MONEY_DATABASE_URL, MONEY_APP_DIR,
  RESEARCH_DATABASE_URL, RESEARCH_SERVICE_KEY,
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fallbacks)
`;

const log = (...args) => console.log("[money-ticker-bridge]", ...args);

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const moneyUrl = await resolveMoneyDbUrl(opts);
  const research = resolveResearchConfig(opts);

  const money = new RawPgClient(moneyUrl);
  try {
    await money.connect();
  } catch (err) {
    console.error(
      `[money-ticker-bridge] Cannot connect to the money database: ${err.message}\n` +
        `  Check MONEY_DATABASE_URL (or --money-db). The money app's local Postgres ` +
        `is usually postgresql://solpient:<password>@127.0.0.1:<port>/solpient ` +
        `(see DATABASE_URL in the money checkout's .env.local).`
    );
    process.exit(1);
  }

  let plan;
  let includeKind = false;
  try {
    const moneyQuery = buildMoneyTickerQuery({ kinds: opts.allKinds ? [...KIND_ALLOWLIST] : EQUITY_KINDS });
    const { rows, fields } = await money.query(moneyQuery);
    const moneyTickers = rows.map((r) => Object.fromEntries(fields.map((f, i) => [f, r[i]])));

    let existing;
    let apply;
    if (research.mode === "rest") {
      const writer = await createRestResearchWriter({ baseUrl: research.url, serviceKey: research.serviceKey });
      includeKind = writer.includeKind;
      existing = await writer.fetchExisting();
      apply = (p) => writer.apply(p);
    } else {
      const pg = new RawPgClient(research.url);
      try {
        await pg.connect();
      } catch (err) {
        console.error(`[money-ticker-bridge] Cannot connect to the research database: ${err.message}`);
        process.exit(1);
      }
      const writer = createPgResearchWriter(pg);
      includeKind = await writer.detectKind();
      existing = await writer.fetchExisting(includeKind);
      apply = (p) => writer.apply(p, includeKind).finally(() => pg.end());
    }

    plan = decideSyncPlan(moneyTickers, existing, { includeKind });
    const s = summarizePlan(plan);
    log(`money tickers read: ${moneyTickers.length} (kinds: ${opts.allKinds ? "all" : EQUITY_KINDS.join(",")})`);
    log(`research companies known: ${existing.length}; kind column: ${includeKind ? "yes" : "no"}`);
    log(`plan: ${s.create} create, ${s.update} update, ${s.unchanged} unchanged`);

    if (opts.dryRun) {
      for (const c of plan.creates.slice(0, 25)) log(`CREATE ${c.ticker} — ${c.company_name}`);
      if (plan.creates.length > 25) log(`... and ${plan.creates.length - 25} more creates`);
      for (const u of plan.updates.slice(0, 25)) {
        const changes = Object.keys(u)
          .filter((k) => k !== "ticker")
          .map((k) => `${k}=${JSON.stringify(u[k])}`)
          .join(", ");
        log(`UPDATE ${u.ticker} — ${changes}`);
      }
      if (plan.updates.length > 25) log(`... and ${plan.updates.length - 25} more updates`);
      log("dry-run: no writes performed");
      return;
    }

    const result = await apply(plan);
    log(`done: read=${moneyTickers.length} created=${result.created} updated=${result.updated} unchanged=${s.unchanged}`);
  } finally {
    await money.end().catch(() => {});
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  main().catch((err) => {
    console.error(`[money-ticker-bridge] FAILED: ${err.message}`);
    process.exit(1);
  });
}
