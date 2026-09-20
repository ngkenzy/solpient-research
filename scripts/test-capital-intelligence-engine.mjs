import assert from "node:assert/strict";
import {
  buildInstitutionalActivity,
  latestInstitutionalRows,
  matchTrackedCompany,
  normalizeIssuerName,
  parse13FInformationTable,
  parseForm4,
} from "../lib/capital-intelligence-engine.mjs";

assert.equal(normalizeIssuerName("Microsoft Corporation"),"MICROSOFT");
assert.equal(normalizeIssuerName("A. O. Smith Corp."),"A O SMITH");

const companies=[
  {id:"msft",ticker:"MSFT",company_name:"Microsoft Corporation"},
  {id:"googl",ticker:"GOOGL",company_name:"Alphabet Inc."},
];
assert.equal(matchTrackedCompany("MICROSOFT CORP",companies)?.ticker,"MSFT");
assert.equal(matchTrackedCompany("ALPHABET INC CL A",companies)?.ticker,"GOOGL");

const form4=`<ownershipDocument>
<issuer><issuerTradingSymbol>MSFT</issuerTradingSymbol></issuer>
<reportingOwner><reportingOwnerId><rptOwnerName>Test Executive</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isOfficer>1</isOfficer><officerTitle>CEO</officerTitle></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable>
<nonDerivativeTransaction>
<securityTitle><value>Common Stock</value></securityTitle>
<transactionDate><value>2026-09-18</value></transactionDate>
<transactionCoding><transactionCode>S</transactionCode></transactionCoding>
<transactionAmounts>
<transactionShares><value>100</value></transactionShares>
<transactionPricePerShare><value>500.25</value></transactionPricePerShare>
<transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
</transactionAmounts>
</nonDerivativeTransaction>
<nonDerivativeTransaction>
<transactionCoding><transactionCode>M</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>50</value></transactionShares></transactionAmounts>
</nonDerivativeTransaction>
</nonDerivativeTable></ownershipDocument>`;
const insider=parseForm4(form4,{companyId:"msft",ticker:"MSFT",accession:"0001",filingDate:"2026-09-19",sourceUrl:"https://sec.test/form4.xml"});
assert.equal(insider.length,1);
assert.equal(insider[0].action,"Sell");
assert.equal(insider[0].shares,100);
assert.equal(insider[0].value,50025);
assert.match(insider[0].actor_detail,/CEO/);

const info=`<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
<infoTable><nameOfIssuer>MICROSOFT CORP</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>594918104</cusip><value>1500</value><shrsOrPrnAmt><sshPrnamt>3000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
<infoTable><nameOfIssuer>ALPHABET INC</nameOfIssuer><titleOfClass>CL A</titleOfClass><cusip>02079K305</cusip><value>800</value><shrsOrPrnAmt><sshPrnamt>4000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><putCall>CALL</putCall></infoTable>
</informationTable>`;
const holdings=parse13FInformationTable(info);
assert.equal(holdings.length,1);
assert.equal(holdings[0].issuer,"MICROSOFT CORP");
assert.equal(holdings[0].value_usd,1500000);

const prior=[{issuer:"MICROSOFT CORP",shares:2000,value_usd:900000,cusip:"594918104"}];
const rows=buildInstitutionalActivity({
  manager:{name:"Example Capital",investor:"Famous Investor",cik:"0000000001"},
  companies,latestHoldings:holdings,previousHoldings:prior,
  positionDate:"2026-06-30",disclosureDate:"2026-08-14",sourceUrl:"https://sec.test/13f.xml",accession:"0002",
});
assert.equal(rows.length,1);
assert.equal(rows[0].company_id,"msft");
assert.equal(rows[0].action,"Increased");
assert.equal(Math.round(rows[0].change_pct),50);

const latest=latestInstitutionalRows([
  {...rows[0],position_date:"2026-06-30"},
  {...rows[0],position_date:"2026-03-31",shares:2000},
]);
assert.equal(latest.length,1);
assert.equal(latest[0].position_date,"2026-06-30");

console.log("Capital Intelligence Engine tests passed.");
