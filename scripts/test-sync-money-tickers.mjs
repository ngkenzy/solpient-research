// scripts/test-sync-money-tickers.mjs
//
// Unit tests for the money → research ticker bridge.
// No database required: exercises the mapping / upsert-decision logic,
// the Postgres URL parsing, the money query's privacy boundary, and the
// SCRAM-SHA-256 math (RFC 5802 test vector) used by the zero-dependency
// Postgres client.
//
// Run: node scripts/test-sync-money-tickers.mjs

import assert from "node:assert/strict";
import {
  EQUITY_KINDS,
  buildMoneyTickerQuery,
  computeScramProof,
  decideSyncPlan,
  dedupeMoneyRows,
  normalizeSector,
  normalizeTicker,
  parsePgUrl,
  sqlLiteral,
  summarizePlan,
} from "./sync-money-tickers.mjs";

// --- ticker normalization -------------------------------------------------
assert.equal(normalizeTicker(" adbe "), "ADBE");
assert.equal(normalizeTicker("aapl"), "AAPL");
assert.equal(normalizeTicker(""), "");
assert.equal(normalizeTicker(null), "");
assert.equal(normalizeTicker(42), "");

// --- sector normalization ---------------------------------------------------
assert.equal(normalizeSector("Technology"), "Technology");
assert.equal(normalizeSector("Other"), null); // money's default -> unknown
assert.equal(normalizeSector("other"), null);
assert.equal(normalizeSector(""), null);
assert.equal(normalizeSector(null), null);

// --- money query: privacy boundary + shape ----------------------------------
const q = buildMoneyTickerQuery();
assert.match(q, /from public\.holdings/i);
assert.match(q, /upper\(btrim\(ticker\)\) as ticker/i);
for (const col of ["shares", "price", "cost_basis", "market_value", "day_change", "ytd_return"]) {
  assert.ok(!q.toLowerCase().includes(col), `query must not select ${col}`);
}
assert.ok(q.includes("'stock'") && q.includes("'etf'"), "default kinds are stock,etf");
assert.ok(!q.includes("'cash'"), "cash excluded by default");
const qAll = buildMoneyTickerQuery({ kinds: ["stock", "etf", "bond", "cash"] });
assert.ok(qAll.includes("'bond'") && qAll.includes("'cash'"), "--all-kinds includes bond,cash");
assert.throws(() => buildMoneyTickerQuery({ kinds: ["x'); drop table--"] }), /No valid holding kinds/);

// --- dedupe -------------------------------------------------------------------
const dupes = dedupeMoneyRows([
  { ticker: "ADBE", name: "Adobe Inc.", holding_kind: "stock", sector: "Technology" },
  { ticker: "adbe", name: "Adobe", holding_kind: "stock", sector: "Technology" },
  { ticker: "  ", name: "Blank", holding_kind: "stock", sector: "Technology" },
  { ticker: null, name: "Null", holding_kind: "stock", sector: "Technology" },
  { ticker: "AAPL", name: "", holding_kind: "stock", sector: "Technology" },
]);
assert.equal(dupes.length, 2);
assert.equal(dupes[0].ticker, "ADBE");
assert.equal(dupes[0].name, "Adobe Inc."); // first row wins
assert.equal(dupes[1].name, "AAPL"); // blank name falls back to ticker

// --- plan: creates --------------------------------------------------------------
let plan = decideSyncPlan(
  [{ ticker: "ADBE", name: "Adobe Inc.", holding_kind: "stock", sector: "Technology" }],
  []
);
assert.equal(plan.creates.length, 1);
assert.equal(plan.updates.length, 0);
assert.equal(plan.unchanged, 0);
assert.deepEqual(plan.creates[0], { ticker: "ADBE", company_name: "Adobe Inc.", sector: "Technology" });
assert.ok(!("holding_kind" in plan.creates[0]), "kind omitted when companies has no holding_kind column");

// --- plan: unchanged --------------------------------------------------------------
plan = decideSyncPlan(
  [{ ticker: "adbe", name: "Adobe Inc.", holding_kind: "stock", sector: "Technology" }],
  [{ ticker: "ADBE", company_name: "Adobe Inc.", sector: "Technology", holding_kind: "stock" }],
  { includeKind: true }
);
assert.deepEqual(summarizePlan(plan), { create: 0, update: 0, unchanged: 1 });

// --- plan: name update ------------------------------------------------------------
plan = decideSyncPlan(
  [{ ticker: "AAPL", name: "Apple Inc.", holding_kind: "stock", sector: "Technology" }],
  [{ ticker: "AAPL", company_name: "Apple", sector: "Technology" }]
);
assert.equal(plan.updates.length, 1);
assert.deepEqual(plan.updates[0], { ticker: "AAPL", company_name: "Apple Inc." });

// --- plan: money "Other" sector never clobbers a real research sector -------------
plan = decideSyncPlan(
  [{ ticker: "AAPL", name: "Apple Inc.", holding_kind: "stock", sector: "Other" }],
  [{ ticker: "AAPL", company_name: "Apple Inc.", sector: "Technology" }]
);
assert.deepEqual(summarizePlan(plan), { create: 0, update: 0, unchanged: 1 });

// --- plan: real sector change is applied -------------------------------------------
plan = decideSyncPlan(
  [{ ticker: "AAPL", name: "Apple Inc.", holding_kind: "stock", sector: "Consumer Cyclical" }],
  [{ ticker: "AAPL", company_name: "Apple Inc.", sector: "Technology" }]
);
assert.deepEqual(plan.updates[0], { ticker: "AAPL", sector: "Consumer Cyclical" });

// --- plan: kind tracked only when the column exists ---------------------------------
plan = decideSyncPlan(
  [{ ticker: "SPY", name: "SPDR S&P 500", holding_kind: "etf", sector: "Other" }],
  [{ ticker: "SPY", company_name: "SPDR S&P 500", sector: null, holding_kind: "stock" }],
  { includeKind: true }
);
assert.deepEqual(plan.updates[0], { ticker: "SPY", holding_kind: "etf" });

plan = decideSyncPlan(
  [{ ticker: "SPY", name: "SPDR S&P 500", holding_kind: "etf", sector: "Other" }],
  [{ ticker: "SPY", company_name: "SPDR S&P 500", sector: null }],
  { includeKind: false }
);
assert.deepEqual(summarizePlan(plan), { create: 0, update: 0, unchanged: 1 });

// --- plan: create with unknown sector stores NULL -----------------------------------
plan = decideSyncPlan([{ ticker: "XYZ", name: "Xyz Corp", holding_kind: "stock", sector: "Other" }], []);
assert.equal(plan.creates[0].sector, null);

// --- plan: idempotency — applying the plan output twice changes nothing --------------
const money = [{ ticker: "ADBE", name: "Adobe Inc.", holding_kind: "stock", sector: "Technology" }];
const existing = [];
const first = decideSyncPlan(money, existing);
assert.equal(first.creates.length, 1);
const afterApply = [
  ...first.creates.map((c) => ({
    ticker: c.ticker,
    company_name: c.company_name,
    sector: c.sector,
    holding_kind: "stock",
  })),
];
const second = decideSyncPlan(money, afterApply, { includeKind: true });
assert.deepEqual(summarizePlan(second), { create: 0, update: 0, unchanged: 1 });

// --- postgres URL parsing -------------------------------------------------------------
const parsed = parsePgUrl("postgresql://solpient:s3cret@127.0.0.1:55433/solpient");
assert.deepEqual(
  { host: parsed.host, port: parsed.port, database: parsed.database, user: parsed.user },
  { host: "127.0.0.1", port: 55433, database: "solpient", user: "solpient" }
);
assert.equal(parsed.password, "s3cret");
assert.equal(parsePgUrl("postgres://u@db.local/mydb").port, 5432);
assert.equal(parsePgUrl("postgresql://u:p@h:5433/d?sslmode=require").sslmode, "require");
assert.throws(() => parsePgUrl("https://example.com/db"), /Not a postgres/);
assert.throws(() => parsePgUrl("not a url"), /Invalid Postgres connection string/);

// --- SQL literal quoting ------------------------------------------------------------------
assert.equal(sqlLiteral("O'Brien"), "'O''Brien'");
assert.equal(sqlLiteral(null), "NULL");
assert.equal(sqlLiteral("ADBE"), "'ADBE'");

// --- SCRAM: RFC 5802 section 5 test vector (SCRAM-SHA-1) ---------------------------------
// Verified against the RFC text at https://www.rfc-editor.org/rfc/rfc5802.txt
// (L608-L615): username 'user', password 'pencil'.
const scramSha1 = computeScramProof({
  username: "user",
  password: "pencil",
  clientNonce: "fyko+d2lbbFgONRv9qkxdawL",
  serverFirstMessage: "r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096",
  hash: "sha1",
});
assert.equal(
  scramSha1.clientFinalMessage,
  "c=biws,r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,p=v0X8v3Bz2T0CJGbJQyF0X+HI4Ts="
);
assert.equal(scramSha1.serverSignature, "rmF9pqV8S7suAoZWja4dJRkFsKQ=");

// --- SCRAM-SHA-256 (what Postgres uses): cross-checked against an independent ----------
// Python implementation of RFC 5802 written from the spec text.
const scramSha256 = computeScramProof({
  username: "user",
  password: "pencil",
  clientNonce: "fyko+d2lbbFgONRv9qkxdawL",
  serverFirstMessage: "r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096",
});
assert.equal(
  scramSha256.clientFinalMessage,
  "c=biws,r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,p=qQRLRHGPDGjB+7iVAE7NNi5xEoHKHuLCHPNQ8BTmvds="
);
assert.equal(scramSha256.serverSignature, "XKW6VuW1FANROQabnJBz1KaeCnQL/HZByQtX/iU+o30=");
assert.throws(
  () =>
    computeScramProof({
      username: "user",
      password: "pencil",
      clientNonce: "abc",
      serverFirstMessage: "r=zzz,s=QSXCR+Q6sek8bf92,i=4096",
    }),
  /nonce/
);
assert.throws(
  () =>
    computeScramProof({
      username: "user",
      password: "pencil",
      clientNonce: "abc",
      serverFirstMessage: "r=abc,s=QSXCR+Q6sek8bf92,i=4096",
      hash: "md5",
    }),
  /Unsupported SCRAM hash/
);

// --- RawPgClient: end-to-end against a fake Postgres server -------------------------------
import net from "node:net";
import { createHash as _createHash, createHmac as _createHmac, pbkdf2Sync as _pbkdf2 } from "node:crypto";
import { RawPgClient } from "./sync-money-tickers.mjs";

function frame(type, payload) {
  const h = Buffer.alloc(5);
  h.writeUInt8(type.charCodeAt(0), 0);
  h.writeUInt32BE(payload.length + 4, 1);
  return Buffer.concat([h, payload]);
}
const cstr = (s) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);

async function readMsg(state) {
  while (state.buf.length < 5) await new Promise((r) => state.wait.push(r));
  const type = String.fromCharCode(state.buf[0]);
  const len = state.buf.readUInt32BE(1);
  while (state.buf.length < 1 + len) await new Promise((r) => state.wait.push(r));
  const payload = state.buf.subarray(5, 1 + len);
  state.buf = state.buf.subarray(1 + len);
  return { type, payload };
}

function startFakeServer(onSession) {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      const state = { buf: Buffer.alloc(0), wait: [] };
      sock.on("data", (c) => {
        state.buf = Buffer.concat([state.buf, c]);
        state.wait.splice(0).forEach((r) => r());
      });
      (async () => {
        try {
          await onSession(sock, state);
        } catch {
          // client closed early; fine
        } finally {
          sock.destroy();
        }
      })();
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function readStartup(state) {
  while (state.buf.length < 4) await new Promise((r) => state.wait.push(r));
  const len = state.buf.readUInt32BE(0);
  while (state.buf.length < len) await new Promise((r) => state.wait.push(r));
  const payload = state.buf.subarray(4, len);
  state.buf = state.buf.subarray(len);
  return payload;
}

function authOkReady(sock) {
  const ok = Buffer.alloc(8);
  ok.writeUInt32BE(8, 0);
  ok.writeUInt32BE(0, 4);
  const ready = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);
  sock.write(Buffer.concat([frame("R", ok.subarray(4)), ready]));
}

function sendRows(sock, fields, rows) {
  const parts = [];
  const n = Buffer.alloc(2);
  n.writeUInt16BE(fields.length, 0);
  parts.push(n);
  for (const f of fields) {
    parts.push(cstr(f));
    const meta = Buffer.alloc(18);
    meta.writeUInt32BE(0, 0); // table oid
    meta.writeUInt16BE(0, 4); // column
    meta.writeUInt32BE(25, 6); // type oid (text)
    meta.writeInt16BE(-1, 10); // type len
    meta.writeInt32BE(-1, 12); // type mod
    meta.writeUInt16BE(0, 16); // format text
    parts.push(meta);
  }
  sock.write(frame("T", Buffer.concat(parts)));
  for (const row of rows) {
    const rp = [Buffer.from([0, row.length])];
    for (const v of row) {
      if (v === null) rp.push(Buffer.from([255, 255, 255, 255]));
      else {
        const b = Buffer.from(v, "utf8");
        const l = Buffer.alloc(4);
        l.writeInt32BE(b.length, 0);
        rp.push(l, b);
      }
    }
    const cnt = Buffer.alloc(2);
    cnt.writeUInt16BE(row.length, 0);
    sock.write(frame("D", Buffer.concat([cnt, ...rp.slice(1)])));
  }
  sock.write(frame("C", cstr(`SELECT ${rows.length}`)));
  sock.write(Buffer.from([0x5a, 0, 0, 0, 5, 0x49]));
}

// 1) trust auth + simple query round trip (incl. NULL handling)
{
  const server = await startFakeServer(async (sock, state) => {
    await readStartup(state);
    authOkReady(sock);
    const q = await readMsg(state);
    assert.equal(q.type, "Q");
    sendRows(sock, ["ticker", "sector"], [["ADBE", "Technology"], ["AAPL", null]]);
  });
  const port = server.address().port;
  const pg = new RawPgClient(`postgresql://u@127.0.0.1:${port}/db?sslmode=disable`);
  await pg.connect();
  const res = await pg.query("select ticker, sector from public.companies");
  assert.deepEqual(res.fields, ["ticker", "sector"]);
  assert.deepEqual(res.rows, [["ADBE", "Technology"], ["AAPL", null]]);
  await pg.end();
  server.close();
}

// 2) MD5 auth path
{
  const user = "solpient";
  const password = "s3cret";
  const salt = Buffer.from([1, 2, 3, 4]);
  const server = await startFakeServer(async (sock, state) => {
    await readStartup(state);
    const saltMsg = Buffer.concat([Buffer.from([0, 0, 0, 5]), salt]);
    sock.write(frame("R", saltMsg));
    const resp = await readMsg(state);
    assert.equal(resp.type, "p");
    const inner = _createHash("md5").update(password + user, "utf8").digest("hex");
    const expected = "md5" + _createHash("md5").update(inner + salt.toString("binary"), "binary").digest("hex");
    assert.equal(resp.payload.toString("utf8").replace(/\0$/, ""), expected);
    authOkReady(sock);
    const q = await readMsg(state);
    assert.equal(q.type, "Q");
    sendRows(sock, ["one"], [["1"]]);
  });
  const port = server.address().port;
  const pg = new RawPgClient(`postgresql://${user}:${password}@127.0.0.1:${port}/db?sslmode=disable`);
  await pg.connect();
  const res = await pg.query("select 1");
  assert.deepEqual(res.rows, [["1"]]);
  await pg.end();
  server.close();
}

// 3) SCRAM-SHA-256 full round trip (server verifies the client proof independently)
{
  const user = "solpient";
  const password = "s3cret";
  const salt = Buffer.from("saltsaltsaltsalts", "utf8");
  const iter = 4096;
  const server = await startFakeServer(async (sock, state) => {
    await readStartup(state);
    sock.write(frame("R", Buffer.concat([Buffer.from([0, 0, 0, 10]), cstr("SCRAM-SHA-256")])));
    const init = await readMsg(state);
    assert.equal(init.type, "p");
    let o = 0;
    const mechEnd = init.payload.indexOf(0, 0);
    assert.equal(init.payload.toString("utf8", 0, mechEnd), "SCRAM-SHA-256");
    o = mechEnd + 1;
    const ilen = init.payload.readInt32BE(o);
    const clientFirst = init.payload.toString("utf8", o + 4, o + 4 + ilen);
    const cnonce = clientFirst.split(",").find((p) => p.startsWith("r=")).slice(2);
    const snonce = cnonce + "SERVER";
    const serverFirst = `r=${snonce},s=${salt.toString("base64")},i=${iter}`;
    sock.write(frame("R", Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from(serverFirst, "utf8")])));
    const fin = await readMsg(state);
    assert.equal(fin.type, "p");
    const clientFinal = fin.payload.toString("utf8");
    const parts = Object.fromEntries(clientFinal.split(",").map((p) => [p[0], p.slice(2)]));
    assert.equal(parts.r, snonce);
    // independent server-side verification of the proof
    const salted = _pbkdf2(password, salt, iter, 32, "sha256");
    const storedKey = _createHash("sha256").update(_createHmac("sha256", salted).update("Client Key").digest()).digest();
    const authMessage = `n=${user},r=${cnonce},${serverFirst},c=biws,r=${snonce}`;
    const clientSig = _createHmac("sha256", storedKey).update(authMessage).digest();
    const proof = Buffer.from(parts.p, "base64");
    const clientKey = Buffer.from(proof.map((b, i) => b ^ clientSig[i]));
    assert.deepEqual(_createHash("sha256").update(clientKey).digest(), storedKey);
    const serverKey = _createHmac("sha256", salted).update("Server Key").digest();
    const serverSig = _createHmac("sha256", serverKey).update(authMessage).digest().toString("base64");
    sock.write(frame("R", Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from(`v=${serverSig}`, "utf8")])));
    authOkReady(sock);
    const q = await readMsg(state);
    assert.equal(q.type, "Q");
    sendRows(sock, ["ok"], [["yes"]]);
  });
  const port = server.address().port;
  const pg = new RawPgClient(`postgresql://${user}:${password}@127.0.0.1:${port}/db?sslmode=disable`);
  await pg.connect(); // throws if the server signature check fails
  const res = await pg.query("select 1");
  assert.deepEqual(res.rows, [["yes"]]);
  await pg.end();
  server.close();
}

// 4) server error surfaces as a thrown Error
{
  const server = await startFakeServer(async (sock, state) => {
    await readStartup(state);
    authOkReady(sock);
    await readMsg(state);
    const msg = Buffer.concat([Buffer.from("M"), cstr("relation does not exist"), Buffer.from([0])]);
    sock.write(frame("E", msg));
    sock.write(Buffer.from([0x5a, 0, 0, 0, 5, 0x49]));
  });
  const port = server.address().port;
  const pg = new RawPgClient(`postgresql://u@127.0.0.1:${port}/db?sslmode=disable`);
  await pg.connect();
  await assert.rejects(pg.query("select * from nope"), /relation does not exist/);
  await pg.end();
  server.close();
}

// --- equity kinds default -------------------------------------------------------------------
assert.deepEqual(EQUITY_KINDS, ["stock", "etf"]);

console.log("sync-money-tickers tests passed.");
