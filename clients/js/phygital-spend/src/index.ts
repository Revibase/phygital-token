export {
  authenticateSpend,
  beginSpend,
  completeSpend,
  type SpendSession,
} from "./instructions/executeSpend.js";

export {
  getApproveSpendInstruction,
  type ApproveSpendInput,
} from "./instructions/approveSpend.js";

export {
  getRevokeSpendInstruction,
  type RevokeSpendInput,
} from "./instructions/revokeSpend.js";
