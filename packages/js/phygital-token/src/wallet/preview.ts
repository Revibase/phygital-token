import { isSolanaError, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM } from "@solana/kit";
import {
  PHYGITAL_TOKEN_ERROR__DELEGATION_NOT_ALLOWED,
  PHYGITAL_TOKEN_ERROR__INSTRUCTION_NOT_ALLOWED,
  PHYGITAL_TOKEN_ERROR__MAX_PER_TX_EXCEEDED,
  PHYGITAL_TOKEN_ERROR__ORIGIN_MISMATCH,
  PHYGITAL_TOKEN_ERROR__OWNER_REQUIRED,
  PHYGITAL_TOKEN_ERROR__PREVIEW_PASSED,
  PHYGITAL_TOKEN_ERROR__PROGRAM_NOT_ALLOWED,
  PHYGITAL_TOKEN_ERROR__SPEND_LIMIT_EXCEEDED,
  PHYGITAL_TOKEN_ERROR__SPEND_NOT_ALLOWED,
  PHYGITAL_TOKEN_ERROR__TOKEN_AUTHORITY_CHANGED,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
} from "../generated/index.js";

/** Anchor's `AccountNotInitialized`: the token has no accessory policy. */
const ANCHOR_ACCOUNT_NOT_INITIALIZED = 3012;

/**
 * The accessory's policy would refuse this transaction. `code` is a stable
 * reason (e.g. `program_not_allowed`, `spend_limit`); `soft` marks states the
 * owner can fix by setting up a policy or an owner rather than by changing the
 * request.
 */
export class PolicyDeniedError extends Error {
  readonly code: string;
  readonly soft: boolean;
  readonly details?: Record<string, unknown>;

  constructor(args: {
    code: string;
    error: string;
    soft?: boolean;
    details?: Record<string, unknown>;
  }) {
    super(args.error);
    this.name = "PolicyDeniedError";
    this.code = args.code;
    this.soft = args.soft ?? false;
    this.details = args.details;
  }
}

const POLICY_SOFT_DENY_BY_CODE: ReadonlyMap<number, { code: string; message: string }> = new Map([
  [
    ANCHOR_ACCOUNT_NOT_INITIALIZED,
    { code: "no_policy", message: "The owner has not set an accessory policy" },
  ],
  [
    PHYGITAL_TOKEN_ERROR__OWNER_REQUIRED,
    { code: "no_owner", message: "The accessory has no owner" },
  ],
  [
    PHYGITAL_TOKEN_ERROR__ORIGIN_MISMATCH,
    { code: "origin_not_allowed", message: "The owner only allows taps from other sites" },
  ],
  [
    PHYGITAL_TOKEN_ERROR__SPEND_NOT_ALLOWED,
    { code: "spend_not_allowed", message: "No spend cap covers this SOL or token transfer" },
  ],
  [
    PHYGITAL_TOKEN_ERROR__SPEND_LIMIT_EXCEEDED,
    { code: "spend_limit", message: "Transfer exceeds the configured spending limit" },
  ],
  [
    PHYGITAL_TOKEN_ERROR__MAX_PER_TX_EXCEEDED,
    { code: "max_per_tx", message: "Transfer exceeds the configured max per transaction" },
  ],
  [
    PHYGITAL_TOKEN_ERROR__PROGRAM_NOT_ALLOWED,
    {
      code: "program_not_allowed",
      message: "Program is not allowed: the policy lists every program the accessory may call",
    },
  ],
  [
    PHYGITAL_TOKEN_ERROR__INSTRUCTION_NOT_ALLOWED,
    {
      code: "instruction_not_allowed",
      message: "Instruction does not satisfy the configured program rules",
    },
  ],
  [
    PHYGITAL_TOKEN_ERROR__DELEGATION_NOT_ALLOWED,
    {
      code: "delegation_not_allowed",
      message: "Accessory taps may not leave a delegate on a wallet token account",
    },
  ],
  [
    PHYGITAL_TOKEN_ERROR__TOKEN_AUTHORITY_CHANGED,
    {
      code: "token_authority_changed",
      message: "Accessory taps may not change who controls a wallet token account",
    },
  ],
]);

/**
 * Every code for a denial the policy makes and the owner can override
 * (`execute_with_owner` skips the policy). Anything else fails for the owner too.
 */
export const POLICY_DENIAL_CODES: ReadonlySet<string> = new Set(
  [...POLICY_SOFT_DENY_BY_CODE.values()].map((m) => m.code),
);

/**
 * The program whose failure ended the transaction: the first `failed` line is
 * the innermost frame. `undefined` when the logs don't say.
 */
export function failingProgramFromLogs(
  logs: readonly string[] | null | undefined,
): string | undefined {
  for (const line of logs ?? []) {
    const match = /^Program (\S+) failed: /.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

function programErrorCode(
  error: unknown,
  logs: readonly string[] | null | undefined,
): number | null {
  if (!isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) return null;
  const failing = failingProgramFromLogs(logs);
  if (failing !== undefined && failing !== PHYGITAL_TOKEN_PROGRAM_ADDRESS) return null;
  return error.context.code;
}

/** `preview_execute` ended in `PreviewPassed`: a tap would be allowed. */
export function isPreviewPassed(error: unknown, logs?: readonly string[] | null): boolean {
  return programErrorCode(error, logs) === PHYGITAL_TOKEN_ERROR__PREVIEW_PASSED;
}

/**
 * Maps a policy error to a soft denial. Pass the simulation `logs` when
 * available, so another Anchor program's custom error isn't mistaken for one.
 */
export function policyDeniedErrorFromSolanaError(
  error: unknown,
  logs?: readonly string[] | null,
): PolicyDeniedError | null {
  const code = programErrorCode(error, logs);
  const mapped = code === null ? undefined : POLICY_SOFT_DENY_BY_CODE.get(code);
  return mapped
    ? new PolicyDeniedError({ code: mapped.code, error: mapped.message, soft: true })
    : null;
}
