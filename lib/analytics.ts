import "server-only";
import { createConsumerServerClient } from "@/lib/supabase/server-client";

// V1 §22 instrumented analytics events. Week-1/4/8/12 retention events are
// deliberately NOT here — they are computed later from history, never faked.
export const ANALYTICS_EVENTS=[
  "account_created",
  "portfolio_created",
  "position_added",
  "position_removed",
  "what_matters_opened",
  "material_item_opened",
  "material_item_positive_feedback",
  "material_item_negative_feedback",
  "missed_event_reported",
  "research_opened",
  "research_requested",
] as const;

export type AnalyticsEventName=(typeof ANALYTICS_EVENTS)[number];

const ANALYTICS_ALLOWLIST=new Set<string>(ANALYTICS_EVENTS);

export function isAllowedAnalyticsEvent(eventName:string):eventName is AnalyticsEventName{
  return ANALYTICS_ALLOWLIST.has(eventName);
}

// Server-side product analytics. Never throws: callers never see errors from here.
export async function track(
  eventName:string,
  properties:Record<string,unknown>= {}
):Promise<void>{
  try{
    if(!isAllowedAnalyticsEvent(eventName)){
      console.warn(`[analytics] blocked unknown event: ${eventName}`);
      return;
    }

    const supabase=await createConsumerServerClient();
    const {data:claims}=await supabase.auth.getClaims();
    const userId=claims?.claims?.sub?String(claims.claims.sub):null;
    if(!userId) return; // anonymous traffic: skip silently

    const {error}=await supabase.from("analytics_events").insert({
      user_id:userId,
      event_name:eventName,
      properties,
    });
    if(error) console.warn("[analytics] insert failed:",error.message);
  }catch(err){
    console.warn("[analytics] track failed:",err instanceof Error?err.message:err);
  }
}
