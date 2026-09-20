import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminSupabaseConfigured } from "@/lib/admin-supabase";

const COOKIE_NAME="solpient-review-access";
const fingerprint=(secret:string)=>createHash("sha256").update("solpient-review-workbench:"+secret).digest("hex");
function safeEqual(a:string,b:string) {
  const aa=Buffer.from(a), bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}
export function reviewAccessConfigured() {
  return Boolean(process.env.REVIEW_WORKBENCH_KEY) && adminSupabaseConfigured();
}
export async function hasReviewAccess() {
  const secret=process.env.REVIEW_WORKBENCH_KEY;
  if (!secret || !adminSupabaseConfigured()) return false;
  const store=await cookies();
  return safeEqual(store.get(COOKIE_NAME)?.value ?? "",fingerprint(secret));
}
export async function requireReviewAccess() {
  if (!(await hasReviewAccess())) redirect("/review/login");
}
export async function unlockReviewAccess(candidate:string) {
  const secret=process.env.REVIEW_WORKBENCH_KEY;
  if (!secret || !adminSupabaseConfigured()) return false;
  if (!safeEqual(fingerprint(candidate),fingerprint(secret))) return false;
  const store=await cookies();
  store.set(COOKIE_NAME,fingerprint(secret),{
    httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",
    path:"/review",maxAge:60*60*12,
  });
  return true;
}
export async function clearReviewAccess() {
  const store=await cookies();
  store.delete(COOKIE_NAME);
}
