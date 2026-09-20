import assert from "node:assert/strict";
import { normalizeQuiverPolitical } from "../lib/quiver-political-intelligence.mjs";

const company={id:"aos-id",ticker:"AOS",company_name:"A. O. Smith Corporation"};
const html=`
<table>
  <thead><tr><th>Stock</th><th>Transaction</th><th>Politician</th><th>Filed</th><th>Traded</th><th>Description</th></tr></thead>
  <tbody>
    <tr>
      <td><a>AOS A.O. SMITH CORP</a></td>
      <td><a>Sale $1,001 - $15,000</a></td>
      <td><a>Ro Khanna House / D</a></td>
      <td><a>Jul 06, 2026</a></td>
      <td><a>Jun 30, 2026</a></td>
      <td>-</td>
    </tr>
    <tr>
      <td>AOS A.O. SMITH CORP</td>
      <td>Purchase $15,001 - $50,000</td>
      <td>Jane Example Senate / R</td>
      <td>Aug 01, 2026</td>
      <td>Jul 20, 2026</td>
      <td>Joint</td>
    </tr>
    <tr>
      <td>AOS</td>
      <td>Sale $1,001 - $15,000</td>
      <td>Old Example House / D</td>
      <td>Jan 05, 2023</td>
      <td>Dec 20, 2022</td>
      <td>-</td>
    </tr>
  </tbody>
</table>`;

const result=normalizeQuiverPolitical({
  company,
  html,
  verifiedAt:"2026-09-20T20:00:00Z",
  windowStart:"2025-01-01",
  windowEnd:"2026-09-20",
});
assert.equal(result.rows.length,2);
assert.equal(result.rows[0].actor_name,"Ro Khanna");
assert.equal(result.rows[0].actor_detail,"House / D");
assert.equal(result.rows[0].action,"Sale");
assert.equal(result.rows[0].amount_range,"$1,001 - $15,000");
assert.equal(result.rows[0].transaction_date,"2026-06-30");
assert.equal(result.rows[0].disclosure_date,"2026-07-06");
assert.equal(result.rows[1].action,"Purchase");
assert.equal(result.coverage.status,"activity_found");
assert.equal(result.coverage.record_count,2);

const none=normalizeQuiverPolitical({
  company,
  html:"<html><body><h1>AOS Congress Trading Activity</h1><table><tbody></tbody></table></body></html>",
  verifiedAt:"2026-09-20T20:00:00Z",
  windowStart:"2025-01-01",
  windowEnd:"2026-09-20",
});
assert.equal(none.rows.length,0);
assert.equal(none.coverage.status,"verified_none");
assert.match(none.coverage.source_url,/AOS/);

const explicitNone=normalizeQuiverPolitical({
  company,
  html:"<html><body>No Congress Trading data for this ticker</body></html>",
  verifiedAt:"2026-09-20T20:00:00Z",
  sourceUrl:"https://www.quiverquant.com/stock/AOS/",
  explicitNone:true,
});
assert.equal(explicitNone.rows.length,0);
assert.equal(explicitNone.coverage.status,"verified_none");
assert.equal(explicitNone.coverage.source_url,"https://www.quiverquant.com/stock/AOS/");

console.log("Quiver political intelligence tests passed.");
