export const METHODOLOGY_REGISTRY_VERSION: string;

export const LIFECYCLE: {
  readonly REGISTERED: "registered";
  readonly CANDIDATE: "candidate";
  readonly VALIDATED: "validated";
  readonly ACTIVE: "active";
  readonly BLOCKED: "blocked";
  readonly DEPRECATED: "deprecated";
  readonly SUPERSEDED: "superseded";
  readonly RETIRED: "retired";
};

export const RISK_CLASS: {
  readonly LOW: "low";
  readonly MODERATE: "moderate";
  readonly HIGH: "high";
  readonly CRITICAL: "critical";
};

export type MethodologyValidationRow = {
  validation_type: string;
  status: "pass" | "fail" | "waived";
  validated_at?: string | null;
  created_at?: string | null;
};

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

export function validateManifest(input?: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest: Record<string, any>;
};

export function manifestHash(input?: Record<string, unknown>): string;

export function requiredValidations(input?: Record<string, unknown>): string[];

export function assessActivationReadiness(
  input?: Record<string, unknown>,
  validations?: MethodologyValidationRow[]
): ActivationReadiness;

export function deriveLifecycle(events?: Array<Record<string, any>>): string;

export function canTransition(from: string, to: string): boolean;

export function diffMethodologies(
  previousInput?: Record<string, unknown>,
  nextInput?: Record<string, unknown>
): {
  changed: boolean;
  materiality: "none" | "patch" | "minor" | "major";
  changes: Array<Record<string, any>>;
  requiresNewVersion: boolean;
};

export function validateCatalog(catalog?: Array<Record<string, unknown>>): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifests: Array<Record<string, any>>;
};

export function registrySummary(
  definitions?: Array<Record<string, any>>,
  events?: Array<Record<string, any>>,
  validations?: MethodologyValidationRow[]
): Record<string, any>;
