import {
  AccountRole,
  address,
  getAddressDecoder,
  getSolanaErrorFromTransactionError,
  type AccountMeta,
  type Address,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  PHYGITAL_TOKEN_ERROR__PREVIEW_PASSED,
  PHYGITAL_TOKEN_ERROR__SPEND_NOT_ALLOWED,
  PHYGITAL_TOKEN_ERROR__STALE_SIGN_COUNT,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
} from "../generated/index.js";
import {
  buildExecuteChallenge,
  compileWalletInstructions,
  elevateRemainingForExecuteChallenge,
} from "../wallet/compile.js";
import {
  isPreviewPassed,
  PolicyDeniedError,
  policyDeniedErrorFromSolanaError,
} from "../wallet/preview.js";

const WALLET_PDA = address("11111111111111111111111111111112");
const MINT = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const RECIPIENT = address("So11111111111111111111111111111111111111112");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

const filled = (byte: number) => getAddressDecoder().decode(new Uint8Array(32).fill(byte));

function ix(programAddress: Address, accounts: AccountMeta[]): Instruction {
  return { programAddress, accounts, data: new Uint8Array([2, 0, 0, 0]) };
}

const customError = (code: number) =>
  getSolanaErrorFromTransactionError({ InstructionError: [0, { Custom: code }] });

describe("compileWalletInstructions", () => {
  it("drops the wallet PDA's signer role and keeps its writability", () => {
    const compiled = compileWalletInstructions(
      [
        ix(SYSTEM_PROGRAM, [
          { address: WALLET_PDA, role: AccountRole.WRITABLE_SIGNER },
          { address: RECIPIENT, role: AccountRole.WRITABLE },
        ]),
      ],
      WALLET_PDA,
    );
    expect(compiled.compactInstructions[0]?.programIdIndex).toBe(0);
    expect(compiled.compactInstructions[0]?.accountIndexes).toEqual(Uint8Array.from([1, 2]));
    expect(compiled.remainingAccounts[1]).toEqual({
      address: WALLET_PDA,
      role: AccountRole.WRITABLE,
    });
  });

  it("leaves a read-only wallet read-only", () => {
    const compiled = compileWalletInstructions(
      [ix(SYSTEM_PROGRAM, [{ address: WALLET_PDA, role: AccountRole.READONLY }])],
      WALLET_PDA,
    );
    expect(compiled.remainingAccounts[1]?.role).toBe(AccountRole.READONLY);
  });

  it("keeps other signers and merges duplicate roles", () => {
    const compiled = compileWalletInstructions(
      [
        ix(SYSTEM_PROGRAM, [{ address: MINT, role: AccountRole.READONLY_SIGNER }]),
        ix(SYSTEM_PROGRAM, [{ address: MINT, role: AccountRole.WRITABLE }]),
      ],
      WALLET_PDA,
    );
    expect(compiled.remainingAccounts).toHaveLength(2);
    expect(compiled.remainingAccounts[1]?.role).toBe(AccountRole.WRITABLE_SIGNER);
  });

  it("rejects calls into phygital-token", () => {
    expect(() =>
      compileWalletInstructions([ix(PHYGITAL_TOKEN_PROGRAM_ADDRESS, [])], WALLET_PDA),
    ).toThrow(/not allowed/);
  });
});

describe("buildExecuteChallenge", () => {
  it("matches the program's challenge (shared vector in wallet.rs)", () => {
    const challenge = buildExecuteChallenge({
      phygitalToken: filled(1),
      slotHash: new Uint8Array(32).fill(2),
      compactInstructions: [
        {
          programIdIndex: 0,
          accountIndexes: Uint8Array.from([1, 2]),
          data: Uint8Array.from([2, 0, 0, 0, 64, 66, 15, 0, 0, 0, 0, 0]),
        },
      ],
      remainingAccounts: [
        { address: filled(3), role: AccountRole.READONLY },
        { address: filled(4), role: AccountRole.WRITABLE },
        { address: filled(5), role: AccountRole.WRITABLE_SIGNER },
      ],
    });
    expect(Buffer.from(challenge).toString("hex")).toBe(
      "1f3caba256268aa7782228a5e86e9bb0292e17fa8b1578ab93308cadb02aad77",
    );
  });

  it("elevates remaining accounts the outer instruction makes writable or signing", () => {
    const [meta] = elevateRemainingForExecuteChallenge(
      [{ address: RECIPIENT, role: AccountRole.READONLY }],
      { writableAddresses: [RECIPIENT], signerAddresses: [RECIPIENT] },
    );
    expect(meta?.role).toBe(AccountRole.WRITABLE_SIGNER);
  });
});

describe("policy preview", () => {
  it("recognizes PreviewPassed and maps policy denials to soft errors", () => {
    expect(isPreviewPassed(customError(PHYGITAL_TOKEN_ERROR__PREVIEW_PASSED))).toBe(true);
    const denial = policyDeniedErrorFromSolanaError(
      customError(PHYGITAL_TOKEN_ERROR__SPEND_NOT_ALLOWED),
    );
    expect(denial).toBeInstanceOf(PolicyDeniedError);
    expect(denial?.code).toBe("spend_not_allowed");
    expect(denial?.soft).toBe(true);
    expect(policyDeniedErrorFromSolanaError(customError(3012))?.code).toBe("no_policy");
  });

  it("ignores non-policy errors and other programs' errors", () => {
    expect(
      policyDeniedErrorFromSolanaError(customError(PHYGITAL_TOKEN_ERROR__STALE_SIGN_COUNT)),
    ).toBeNull();
    const otherProgram = [`Program ${SYSTEM_PROGRAM} failed: custom program error`];
    expect(
      policyDeniedErrorFromSolanaError(
        customError(PHYGITAL_TOKEN_ERROR__SPEND_NOT_ALLOWED),
        otherProgram,
      ),
    ).toBeNull();
  });
});
