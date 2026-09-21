declare module "@/lib/methodology-governance.mjs" {
  export type ActivationReadiness = {
    ready: boolean;
    manifestErrors: string[];
    required: string[];
    passed: string[];
    waived: string[];
    failed: string[];
    missing: string[];
    criticalWaiverBlocked?: boolean;
  };

  export function assessActivationReadiness(
    input?: Record<string, unknown>,
    validations?: Array<Record<string, unknown>>
  ): ActivationReadiness;

  export function deriveLifecycle(
    events?: Array<Record<string, unknown>>
  ): string;
}
