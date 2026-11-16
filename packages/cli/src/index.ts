export { detectProject, type ProjectInfo } from "./detect.js";
export { applyPlan, ConflictError, planInit, sha256, type PlannedFile } from "./plan.js";
export { buildConfig, type InitAnswers } from "./render.js";
export { diagnose, type DoctorReport } from "./commands/doctor.js";
export { fileDrift, loadConfig, loadManifest } from "./project.js";
export { stackFiles, templateSource } from "./templates.js";
export {
  applyUpgrade,
  planUpgrade,
  PROPOSAL_SUFFIX,
  type UpgradeItem,
  type UpgradePlan,
} from "./upgrade.js";
export { buildManifest, templateFiles } from "./plan.js";
export { planAdd, addLayoutPath } from "./plan.js";
export { preflightAdd, REQUIRED_COMPILER_OPTIONS } from "./preflight.js";
