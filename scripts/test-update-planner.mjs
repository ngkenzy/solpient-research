import assert from"node:assert/strict";import{planCompanyUpdate}from"../lib/update-planner.mjs";
assert.equal(planCompanyUpdate({asOfDate:"2026-09-21",researchReviewedAt:null,latestMarketDate:"2026-09-18"}).action,"deep_research_refresh");
assert.equal(planCompanyUpdate({asOfDate:"2026-09-21",researchReviewedAt:"2026-09-01",latestMaterialFilingDate:"2026-09-15",latestMarketDate:"2026-09-18"}).action,"deep_research_refresh");
assert.equal(planCompanyUpdate({asOfDate:"2026-09-21",researchReviewedAt:"2026-09-20",latestFundamentalObservedAt:"2026-09-21",latestMarketDate:"2026-09-18"}).action,"fundamentals_refresh");
assert.equal(planCompanyUpdate({asOfDate:"2026-09-21",researchReviewedAt:"2026-09-20",latestMarketDate:"2026-09-18",priceAtResearch:100,latestPrice:125}).action,"valuation_review");
assert.equal(planCompanyUpdate({asOfDate:"2026-09-24",researchReviewedAt:"2026-09-20",latestMarketDate:"2026-09-21",priceAtResearch:100,latestPrice:101}).action,"market_refresh");
assert.equal(planCompanyUpdate({asOfDate:"2026-09-21",researchReviewedAt:"2026-09-20",latestMarketDate:"2026-09-18",priceAtResearch:100,latestPrice:101}).action,"no_action");console.log("Research update planner tests passed.");
