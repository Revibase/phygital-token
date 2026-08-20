import { type Address } from "@solana/kit";
import {
  PhygitalTokenType,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
  parseSecp256r1Pubkey,
  findTokenPda,
} from "phygital-token-sdk";

export async function planInitialize(input: {
  identifier: string;
  secp256r1PublicKey: string;
  tokenType: "Controlled" | "Bearer";
}) {
  const secp256r1Pubkey = parseSecp256r1Pubkey(input.secp256r1PublicKey);
  const tokenPda = await findTokenPda(secp256r1Pubkey);
  const tokenType =
    input.tokenType === "Controlled"
      ? PhygitalTokenType.Controlled
      : PhygitalTokenType.Bearer;

  return {
    instruction: "initialize",
    sdk: "buildInitializeInstruction",
    tokenType: input.tokenType,
    derivedAccounts: {
      tokenPda,
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    requiredSigners: [
      {
        name: "authority",
        role: "Must be ADMIN (G6kBnedts6uAivtY72ToaFHBs1UVbT9udiXmQZgMEjoF); pays rent and creates the token PDA",
      },
    ],
    requiredInputs: {
      identifier: input.identifier,
      secp256r1Pubkey: input.secp256r1PublicKey,
      tokenType,
    },
    notes: [
      "Creates a token PDA seeded by the passkey public key.",
      "identifier is stored on the token for binding and is distinct from the passkey.",
      "Ownership starts as the default (zero) pubkey until the first transfer.",
      "mint starts as the default pubkey until set_mint.",
      "Only the designated admin may call initialize and set_mint.",
      "On mainnet the authority is a Squads vault — use buildSquadsInitializeInstructions so a 1/1 member can create/propose/approve/execute/close in one transaction.",
    ],
  };
}

export async function planTransfer(input: {
  secp256r1PublicKey: string;
  recipient: string;
}) {
  const tokenPda = await findTokenPda(
    parseSecp256r1Pubkey(input.secp256r1PublicKey),
  );

  return {
    flow: [
      "1. beginTransfer({ rpc, token }) — fetch slot hash, build challenge",
      "2. authenticatePasskeyForTransfer(session) — NFC/WebAuthn tap on physical token",
      "3. completeTransfer(session, webAuthnResponse, recipientSigner) — passkey from response.id; builds secp256r1_verify + transfer_ownership",
    ],
    sdk: {
      begin: "beginTransfer",
      authenticate: "authenticatePasskeyForTransfer",
      complete: "completeTransfer",
    },
    challenge: {
      formula: "SHA256('transfer' || tokenPda || slotHash)",
      fetchedAt: "beginTransfer reads slot_hashes sysvar (~512 slot window)",
      note: "Run beginTransfer with a live rpc to get challengeBase64 and slotNumber.",
    },
    derived: {
      tokenPda,
      secp256r1PublicKey: input.secp256r1PublicKey,
    },
    transferAccounts: {
      recipient: `${input.recipient} (signer — must co-sign the transaction)`,
      token: tokenPda,
      slotHashes: "SysvarS1otHashes111111111111111111111111111",
      instructionsSysvar: "Sysvar1nstructions1111111111111111111111111",
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    requiredSigners: [
      {
        name: "recipient",
        role: "Recipient wallet accepting ownership — must sign the transfer transaction",
      },
    ],
    transferOwnershipArgs: {
      secp256r1VerifyArgs: "{ verifyArgsRelativeIndex, signedMessageIndex, clientDataJson }",
      slotNumber: "u64 — separate instruction arg; used to fetch slot hash for transfer challenge",
    },
    instructions: ["secp256r1_verify", "transfer_ownership"],
    notes: [
      "No SPL token transfer — transfer_ownership only updates token.owner.",
      "beginTransfer only needs rpc + token PDA; passkey comes from response.id at completeTransfer.",
      "Recipient must sign the transfer transaction to accept ownership.",
      "Challenge is slot-bound; complete the flow promptly (~512 slots).",
      "PDA is derived from the passkey public key, which also authorizes the signature.",
    ],
  };
}

export type OnChainCompositionPattern = "inspect" | "cpi" | "standalone";

function buildVerifyChallengeDescription(): string {
  return "messageHash (32 bytes) used directly as the WebAuthn challenge";
}

export async function planVerifyAsset(input: {
  message: string;
  secp256r1PublicKey?: string;
  onChainPattern?: OnChainCompositionPattern;
}) {
  const messageBytes = new TextEncoder().encode(input.message);
  const messageHash =
    "SHA256(message) — 32-byte hash passed to verify and used as WebAuthn challenge";

  let tokenPda: string | undefined;
  if (input.secp256r1PublicKey) {
    tokenPda = await findTokenPda(parseSecp256r1Pubkey(input.secp256r1PublicKey));
  }

  const pattern = input.onChainPattern ?? "inspect";
  const patternMeta = {
    inspect: {
      transactionOrder: ["secp256r1_verify", "verify", "your_program_ix"],
      clientSteps: [
        "beginVerify({ messageHash })",
        "authenticatePasskeyForVerify(session)",
        "completeVerify(session, response) — or buildVerifyArgs + getVerifyInstruction",
        "buildYourProgramInstruction(/* same messageHash */)",
        "sendTransaction([secp256r1Verify, verifyIx, yourIx])",
      ],
      programSide:
        "Your Rust program scans instructions_sysvar for preceding verify; validates message_hash",
      clientSdk: ["completeVerify", "getVerifyInstruction"],
    },
    cpi: {
      transactionOrder: ["secp256r1_verify", "your_program_ix"],
      clientSteps: [
        "beginVerify({ messageHash })",
        "authenticatePasskeyForVerify(session)",
        "buildVerifyArgs(response) — tokenPda from tap + secp256r1Verify + verify args",
        "buildYourProgramInstruction({ secp256r1VerifyArgs, messageHash, tokenPda })",
        "sendTransaction([secp256r1Verify, yourIx]) — your program CPIs verify",
      ],
      programSide:
        "Your Rust program CPIs verify via VerifyCpiBuilder (phygital-token-client)",
      clientSdk: ["buildVerifyArgs"],
    },
    standalone: {
      transactionOrder: ["secp256r1_verify", "verify"],
      clientSteps: [
        "beginVerify({ messageHash })",
        "authenticatePasskeyForVerify(session)",
        "completeVerify(session, response)",
        "sendTransaction([secp256r1Verify, verifyIx])",
      ],
      programSide: "None — no custom program",
      clientSdk: ["completeVerify"],
    },
  }[pattern];

  return {
    onChainPattern: pattern,
    patternName:
      pattern === "inspect"
        ? "A — client posts verify, program inspects"
        : pattern === "cpi"
          ? "B — client posts secp256r1_verify, program CPIs verify"
          : "Standalone verify",
    flow: patternMeta.clientSteps,
    sdk: {
      begin: "beginVerify",
      authenticate: "authenticatePasskeyForVerify",
      buildArgs: "buildVerifyArgs",
      complete: "completeVerify",
      instruction: "getVerifyInstruction",
      offChainAuthOnly:
        "startAuthentication (client) + verifyResponse (server); does NOT submit verify",
    },
    message: {
      utf8: input.message,
      byteLength: messageBytes.length,
      onChainHash: messageHash,
    },
    challenge: {
      formula: buildVerifyChallengeDescription(),
      note: "Hash your canonical payload to 32 bytes, then pass as messageHash to beginVerify.",
    },
    derived: tokenPda
      ? { tokenPda, secp256r1PublicKey: input.secp256r1PublicKey }
      : undefined,
    transactionLayout: {
      order: patternMeta.transactionOrder,
      verifyAccounts: {
        token: "writable PDA seeded by passkey public key",
        instructions_sysvar: "Sysvar1nstructions1111111111111111111111111",
      },
      verifyArgs: {
        secp256r1VerifyArgs: "{ verifyArgsRelativeIndex, signedMessageIndex, clientDataJson }",
        messageHash: "32-byte WebAuthn challenge",
        expectedRpId: "optional string — SHA256(rpId) must match authenticatorData[0..32]",
        expectedOrigin: "optional string — must match clientDataJSON.origin",
      },
    },
    programSide: patternMeta.programSide,
    buildVerifyArgsReturns: {
      tokenPda: "Address derived from response.id via findTokenPda",
      secp256r1Verify: "Instruction for Secp256r1SigVerify program",
      signedMessageIndex: "number",
      clientDataJson: "Uint8Array",
    },
    notes: [
      "startAuthentication + verifyResponse is off-chain only — it does not submit verify. Verify on your server.",
      "beginVerify does not take a token — PDA is derived after the NFC tap from response.id.",
      "Pattern A: client includes verify; your program inspects instructions sysvar.",
      "Pattern B: client uses buildVerifyArgs; your program CPIs verify.",
      "verify updates token.last_sign_count; WebAuthn signCount must be strictly increasing.",
      "verify does not change token.owner.",
    ],
  };
}

export async function planRemoveOwnership(input: {
  secp256r1PublicKey: string;
  owner: string;
}) {
  const tokenPda = await findTokenPda(
    parseSecp256r1Pubkey(input.secp256r1PublicKey),
  );

  return {
    instruction: "remove_ownership",
    sdk: "getRemoveOwnershipInstruction",
    flow: [
      "1. Confirm the connected wallet is token.owner on-chain",
      "2. Build remove_ownership with getRemoveOwnershipInstruction",
      "3. Owner signs and submits the transaction (no passkey tap required)",
    ],
    derivedAccounts: {
      tokenPda,
      secp256r1PublicKey: input.secp256r1PublicKey,
      owner: input.owner,
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    requiredSigners: [
      {
        name: "owner",
        role: "Current token owner wallet — must match token.owner on-chain",
      },
    ],
    onChainEffects: [
      "Sets token.owner to the default (zero) pubkey",
      "Clears token.is_locked (forfeiture unlocks Controlled tokens)",
      "Preserves token.last_sign_count",
    ],
    notes: [
      "Wallet-signed forfeiture — unlike transfer_ownership, no secp256r1_verify or passkey tap.",
      "Fails if signer is not token.owner.",
    ],
  };
}

export function parseTokenType(value: string): "Controlled" | "Bearer" {
  const normalized = value.trim();
  if (normalized === "Controlled" || normalized === "Bearer") {
    return normalized;
  }
  throw new Error('tokenType must be "Controlled" or "Bearer".');
}

export type { Address };
