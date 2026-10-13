/**
 * A readable JSON form of accessory permissions (the policy's spending limits,
 * allowed sites and program rules): what the Revibase editor copies and pastes, and what a
 * project puts in a permission request link. Addresses are base58, bytes hex,
 * amounts raw-unit strings. `parsePermissionSet` is strict: anything it
 * doesn't know is rejected, and every rule is checked the way the program
 * checks it, so a set that parses can always be saved. It also rejects a rule
 * whose checks can never all hold, which the program would save but never match.
 */

export {
  bytesToHex,
  hexToBytes,
  isValidOrigin,
  periodFromSeconds,
  periodSeconds,
  PERMISSION_LIMITS,
  PermissionFormatError,
  type AccountCheckJson,
  type DataCheckJson,
  type LimitJson,
  type Period,
  type PermissionSet,
  type ProgramJson,
  type RuleJson,
} from "./model.js";
export { parsePermissionSet, parseRule, selectorsOverlap } from "./validate.js";
export { ruleFromProgram, ruleToArgs, sameRule } from "./codec.js";
