declare module "@/lib/universe-qa-engine.mjs" {
  export const UNIVERSE_QA_VERSION: string;
  export const DEFAULT_QA_THRESHOLDS: Record<string,number>;
  export function buildUniverseQAReport(
    rows?: Array<Record<string,any>>,
    options?: {limit?:number;thresholds?:Record<string,number>}
  ): Record<string,any>;
}
