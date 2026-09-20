import assert from "node:assert/strict";
import { normalizeYahooCapital } from "../lib/yahoo-capital-intelligence.mjs";

const company={id:"msft-id",ticker:"MSFT",company_name:"Microsoft Corporation"};
const body={
  quoteSummary:{
    result:[{
      insiderTransactions:{
        transactions:[
          {
            shares:{raw:1000},
            filerUrl:"/insider/example",
            transactionText:"Sale at price 500.00 per share.",
            filerName:"Example CFO",
            filerRelation:"Chief Financial Officer",
            moneyText:"$500,000",
            startDate:{raw:1789689600},
            ownership:"D",
            value:{raw:500000},
          },
          {
            shares:{raw:500},
            filerUrl:"/insider/example2",
            transactionText:"Purchase at price 480.00 per share.",
            filerName:"Example Director",
            filerRelation:"Director",
            moneyText:"$240,000",
            startDate:{raw:1789603200},
            ownership:"D",
            value:{raw:240000},
          },
          {
            shares:{raw:250},
            filerUrl:"/insider/example3",
            transactionText:"Stock gift.",
            filerName:"Example Officer",
            filerRelation:"Officer",
            startDate:{raw:1789516800},
            ownership:"D",
          }
        ]
      },
      institutionOwnership:{
        ownershipList:[
          {
            reportDate:{raw:1782777600},
            organization:"Example Asset Management",
            pctHeld:{raw:0.012},
            position:{raw:1000000},
            value:{raw:500000000},
            pctChange:{raw:0.15},
          },
          {
            reportDate:{raw:1782777600},
            organization:"Reduced Capital",
            pctHeld:{raw:0.008},
            position:{raw:600000},
            value:{raw:300000000},
            pctChange:{raw:-0.10},
          }
        ]
      }
    }]
  }
};

const result=normalizeYahooCapital({company,body,verifiedAt:"2026-09-20T20:00:00Z"});
assert.equal(result.summary.insider_rows,2);
assert.equal(result.summary.institutional_rows,2);
assert.equal(result.rows.filter((row)=>row.activity_type==="insider").length,2);
assert.equal(result.rows.find((row)=>row.actor_name==="Example CFO")?.action,"Sell");
assert.equal(result.rows.find((row)=>row.actor_name==="Example Director")?.action,"Buy");
assert.equal(result.rows.find((row)=>row.actor_name==="Example CFO")?.price,500);
assert.equal(result.rows.find((row)=>row.actor_name==="Example Asset Management")?.action,"Increased");
assert.equal(Math.round(result.rows.find((row)=>row.actor_name==="Example Asset Management")?.change_pct),15);
assert.equal(result.rows.find((row)=>row.actor_name==="Reduced Capital")?.action,"Reduced");
assert.equal(result.coverage.find((row)=>row.activity_type==="insider")?.status,"activity_found");
assert.equal(result.coverage.find((row)=>row.activity_type==="institutional")?.status,"activity_found");

const empty=normalizeYahooCapital({
  company,
  body:{quoteSummary:{result:[{insiderTransactions:{transactions:[]},institutionOwnership:{ownershipList:[]}}]}},
  verifiedAt:"2026-09-20T20:00:00Z",
});
assert.equal(empty.coverage.find((row)=>row.activity_type==="insider")?.status,"partial");
assert.equal(empty.coverage.find((row)=>row.activity_type==="institutional")?.status,"partial");

console.log("Yahoo capital intelligence tests passed.");
