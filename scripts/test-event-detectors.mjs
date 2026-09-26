import assert from "node:assert/strict";
import {
  EVENT_CATEGORIES,
  TAXONOMY_VERSION,
  LEGACY_CATEGORY_MAP,
  mapLegacyCategory,
  guidanceDirectionFromText,
  classifyManagementEvent,
  extractEightKItems,
  classifyEightKItem,
  classifyEightKDocument,
  detectShareCountEvent,
} from "../lib/event-detectors.mjs";

// Taxonomy surface: 8 PRD §15 categories, versioned.
assert.equal(EVENT_CATEGORIES.length, 8);
assert.deepEqual([...EVENT_CATEGORIES].sort(), [
  "business","capital_allocation","competition","financial",
  "guidance","management","regulatory","research",
]);
assert.equal(TAXONOMY_VERSION, "event-taxonomy-v1");
for (const [legacy, mapped] of Object.entries(LEGACY_CATEGORY_MAP)) {
  assert.ok(EVENT_CATEGORIES.includes(mapped), `legacy ${legacy} -> ${mapped}`);
}
assert.equal(mapLegacyCategory("thesis"), "research");
assert.equal(mapLegacyCategory("market"), "financial");
assert.equal(mapLegacyCategory("bogus"), null);

// Guidance direction — deterministic priority: withdrawn > lowered > raised > new > maintained.
assert.equal(guidanceDirectionFromText("The company raised its full-year revenue guidance.").direction, "raised");
assert.equal(guidanceDirectionFromText("Management lowered its fiscal 2026 outlook.").direction, "lowered");
assert.equal(guidanceDirectionFromText("The company withdrew its previously issued guidance.").direction, "withdrawn");
assert.equal(guidanceDirectionFromText("Today we introduce our fiscal 2027 outlook.").direction, "new");
assert.equal(guidanceDirectionFromText("We reaffirm our guidance for the year.").direction, "maintained");
assert.equal(guidanceDirectionFromText("Results were in line with expectations.").direction, null);

// Management events — role detection, departure beats appointment on ambiguity.
const ceoExit = classifyManagementEvent("The board announced the resignation of its Chief Executive Officer.");
assert.equal(ceoExit.category, "management");
assert.equal(ceoExit.materiality, "high");
assert.equal(ceoExit.decision_impact, "weakening");
const cfoJoin = classifyManagementEvent("We are pleased to appoint Jane Doe as Chief Financial Officer.");
assert.equal(cfoJoin.materiality, "high");
assert.equal(cfoJoin.decision_impact, "monitor");
const dirJoin = classifyManagementEvent("The board elected a new director to the board of directors.");
assert.equal(dirJoin.materiality, "material");

// 8-K item rules.
const item502 = classifyEightKItem("5.02", "resignation of Chief Financial Officer effective immediately");
assert.ok(item502.label.startsWith("8-K Item 5.02 — CFO departure"));
assert.ok(item502.confidence >= 90);
const item202 = classifyEightKItem("2.02", "The company lowered its fiscal 2026 outlook and revenue guidance.");
assert.equal(item202.category, "guidance");
assert.equal(item202.materiality, "high");
const item202plain = classifyEightKItem("2.02", "Net revenue was $1.2 billion for the quarter.");
assert.equal(item202plain.category, "financial");
assert.equal(item202plain.subtype, "earnings results");
assert.equal(classifyEightKItem("5.07", "Shareholders voted on the election of directors.").materiality, "not_material");
assert.equal(classifyEightKItem("3.02", "Unregistered sale of equity securities.").subtype, "dilution");
assert.equal(classifyEightKItem("1.03", "The company filed for chapter 11.").materiality, "high");
assert.equal(classifyEightKItem("1.02", "Termination of the supply agreement.").decision_impact, "weakening");
assert.equal(classifyEightKItem("9.01", "Exhibits."), null);

// Item 8.01 cascade: regulatory > guidance > management > capital > competition > business > dismissed.
const fda = classifyEightKItem("8.01", "The FDA approved the company's new drug application.");
assert.equal(fda.category, "regulatory");
assert.equal(fda.subtype, "approval");
assert.equal(fda.decision_impact, "improving");
const sec = classifyEightKItem("8.01", "The SEC issued a subpoena regarding accounting practices.");
assert.equal(sec.subtype, "investigation");
const dividend = classifyEightKItem("8.01", "The board declared a quarterly dividend and approved an increase to the dividend.");
assert.equal(dividend.category, "capital_allocation");
assert.equal(dividend.subtype, "dividend");
assert.ok(dividend.label.includes("raised"));
const buyback = classifyEightKItem("8.01", "The company repurchased shares under its repurchase program.");
assert.equal(buyback.subtype, "buyback");
const noise = classifyEightKItem("8.01", "The company issued a press release about its annual meeting of stockholders.");
assert.equal(noise.materiality, "not_material");
assert.equal(noise.confidence, 90);
assert.ok(classifyEightKItem("7.77", "Something unusual.").label.includes("unclassified"));
assert.ok(classifyEightKItem("7.77", "Something unusual.").confidence < 88);

// Document-level: item extraction, exhibits-only, multi-item.
assert.deepEqual(extractEightKItems("ITEM 1.01 and Item 5.02 and item 9.01 stuff"), ["1.01","5.02","9.01"]);
const exhibitsOnly = classifyEightKDocument({ text: "Item 9.01 Financial Statements and Exhibits" });
assert.equal(exhibitsOnly.length, 1);
assert.equal(exhibitsOnly[0].materiality, "not_material");
const multi = classifyEightKDocument({ text: "Item 5.02 Departure of Chief Executive Officer. Item 9.01 Exhibits." });
assert.equal(multi.length, 1);
assert.equal(multi[0].item, "5.02");

// Share-count derivation.
const bb = detectShareCountEvent({ prevShares: 100, currShares: 94, periodEnd: "2026-06-30" });
assert.equal(bb.category, "capital_allocation");
assert.equal(bb.subtype, "buyback");
assert.equal(bb.materiality, "material");
assert.equal(bb.event_key, "shares:2026-06-30");
assert.equal(detectShareCountEvent({ prevShares: 100, currShares: 103 }).materiality, "notable");
assert.equal(detectShareCountEvent({ prevShares: 100, currShares: 100.5 }), null);
assert.equal(detectShareCountEvent({ prevShares: 0, currShares: 5 }), null);

// Determinism: same input, same output.
const a = classifyEightKItem("8.01", "The FDA approved the company's new drug application.");
const b = classifyEightKItem("8.01", "The FDA approved the company's new drug application.");
assert.deepEqual(a, b);

console.log("Event detector tests passed.");
