import fs from "node:fs";
import process from "node:process";
import { validateCatalog, manifestHash } from "../lib/methodology-governance.mjs";
import { buildMethodologyImplementationFingerprint } from "../lib/methodology-implementation-hash.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
}

const key=arg("key");
const version=arg("version");
const catalogPath=arg("catalog","methodologies/catalog.json");
if(!key||!version)throw new Error("Provide --key and --version.");

const catalog=JSON.parse(fs.readFileSync(catalogPath,"utf8"));
const validation=validateCatalog(catalog.methodologies??[]);
if(!validation.valid){
  throw new Error("Invalid methodology catalog: "+validation.errors.join(" "));
}
const manifest=validation.manifests.find(
  x=>x.methodology_key===key&&x.version===version
);
if(!manifest)throw new Error("Methodology not found: "+key+" "+version);
const implementation=buildMethodologyImplementationFingerprint(manifest);
console.log(JSON.stringify({
  methodology_key:key,
  version,
  manifest_hash:manifestHash(manifest),
  implementation_hash:implementation.implementation_hash,
  implementation_files:implementation.files,
  excluded_nonoperational_files:implementation.excluded_nonoperational_files,
},null,2));
