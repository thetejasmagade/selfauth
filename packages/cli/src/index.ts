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
export { addLayoutPath, normalizeSrcDir, planAdd, planAddFrontend, selfauthRoot } from "./plan.js";
export {
  preflightAdd,
  preflightAddFrontend,
  REQUIRED_COMPILER_OPTIONS,
  type FrontendPreflight,
} from "./preflight.js";
export {
  checkTsconfigCoverage,
  detectSourceLayout,
  findExpressEntryFiles,
  findWorkspacePackages,
  suggestSourceDir,
  type SourceLayout,
  type WorkspacePackage,
} from "./layout.js";
export { applyReorganize, planMoves, planReorganize } from "./reorganize.js";
export { inspect, type DetectReport } from "./commands/detect.js";
export { findAuthSignals, type AuthSignal } from "./auth-signals.js";
export { runValidation, type ValidationReport } from "./commands/validate.js";
export { INTEGRATIONS, PLANNED, type Integration } from "./commands/list.js";
export { AGENT_SKILL_DIRS, planSkillInstall, skillFiles, skillRoot } from "./commands/skill.js";
export { CLI_VERSION } from "./version.js";
