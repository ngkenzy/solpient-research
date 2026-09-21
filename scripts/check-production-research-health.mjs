const base = (process.env.SOLPIENT_PRODUCTION_URL || "https://solpient-research-app.vercel.app").replace(/\/$/, "");
const ticker = (process.env.SOLPIENT_HEALTH_TICKER || "PFE").toUpperCase();
const url = `${base}/api/health/research?ticker=${encodeURIComponent(ticker)}`;

const response = await fetch(url, {
  headers: { "User-Agent": "SOLPIENT production health check" },
});

let payload;
try {
  payload = await response.json();
} catch {
  throw new Error(`Research health endpoint returned non-JSON HTTP ${response.status}`);
}

console.log(JSON.stringify({ url, httpStatus: response.status, ...payload }, null, 2));

if (!response.ok || payload.status !== "healthy") {
  process.exitCode = 1;
}
