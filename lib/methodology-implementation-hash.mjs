import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalSha256 } from "./integrity-hash.mjs";

const fileSha256=(filePath)=>createHash("sha256")
  .update(fs.readFileSync(filePath))
  .digest("hex");

export function buildMethodologyImplementationFingerprint(manifest={},options={}){
  const root=path.resolve(options.root??process.cwd());
  const declaredSourceFiles=[...(manifest.source_files??[])].map(String).sort();
  if(!declaredSourceFiles.length){
    throw new Error("Methodology implementation fingerprint requires source_files.");
  }
  const operationalSourceFiles=declaredSourceFiles.filter(relativePath=>
    !relativePath.startsWith("docs/")&&
    !relativePath.startsWith("scripts/fixtures/")&&
    !/^scripts\/test[-_.]/.test(relativePath)&&
    !/^scripts\/audit[-_.]/.test(relativePath)
  );
  const sourceFiles=operationalSourceFiles.length
    ?operationalSourceFiles
    :declaredSourceFiles;
  const files=sourceFiles.map(relativePath=>{
    const absolutePath=path.resolve(root,relativePath);
    if(!absolutePath.startsWith(root+path.sep)&&absolutePath!==root){
      throw new Error("Methodology source path escapes repository root: "+relativePath);
    }
    if(!fs.existsSync(absolutePath)||!fs.statSync(absolutePath).isFile()){
      throw new Error("Methodology source file is missing: "+relativePath);
    }
    return{
      path:relativePath,
      sha256:fileSha256(absolutePath),
    };
  });
  return{
    implementation_hash:canonicalSha256({
      contract:"solpient-methodology-implementation-v1",
      methodology_key:String(manifest.methodology_key??""),
      version:String(manifest.version??""),
      files,
    }),
    files,
    excluded_nonoperational_files:declaredSourceFiles.filter(
      relativePath=>!sourceFiles.includes(relativePath)
    ),
  };
}
