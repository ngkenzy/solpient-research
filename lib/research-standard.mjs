import { validateResearchStandard as validateV1 } from "./research-standard-v1.mjs";
import { validateResearchStandardV2, SOLPIENT_STANDARD_VERSION_V2 } from "./research-standard-v2.mjs";
export function validateResearchStandard(payload){return payload?.research?.standard_version===SOLPIENT_STANDARD_VERSION_V2?validateResearchStandardV2(payload):validateV1(payload);}
export { validateResearchStandardV2, SOLPIENT_STANDARD_VERSION_V2 };
export * from "./research-standard-v1.mjs";
