import assert from "node:assert/strict";
import { canonicalJson, canonicalSha256, CANONICALIZATION_VERSION } from "../lib/integrity-hash.mjs";

assert.equal(CANONICALIZATION_VERSION, "solpient-canonical-json-v1");

const left={
  z:3,
  a:{beta:2,alpha:1},
  list:[{b:2,a:1},2,1],
};
const right={
  list:[{a:1,b:2},2,1],
  a:{alpha:1,beta:2},
  z:3,
};

assert.equal(canonicalJson(left),canonicalJson(right));
assert.equal(canonicalSha256(left),canonicalSha256(right));
assert.notEqual(canonicalSha256([1,2,3]),canonicalSha256([3,2,1]));
assert.equal(canonicalJson({x:Number.NaN,y:Infinity,z:undefined}), '{"x":null,"y":null,"z":null}');

const changed=structuredClone(right);
changed.a.beta=3;
assert.notEqual(canonicalSha256(left),canonicalSha256(changed));

console.log("Integrity hash tests passed.");
