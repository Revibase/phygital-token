import { type Address } from "@solana/kit";
import {
  PhygitalTokenType,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
  findPhygitalTokenPda,
} from "phygital-token-sdk";

export async function planInitialize(input: {
  identifier: string;
  secp256r1PublicKey: string;
  tokenType: "Controlled" | "Bearer";
  owner: string;
}) {
  const tokenPda = await findPhygitalTokenPda(input.secp256r1PublicKey);
  const tokenType =
    input.tokenType === "Controlled"
      ? PhygitalTokenType.Controlled
      : PhygitalTokenType.Bearer;

  return {
    instruction: "initialize",
    sdk: "getInitializeInstruction",
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
      owner: input.owner,
    },
    notes: [
      "Creates a token PDA seeded by the passkey public key.",
      "identifier is stored on the token for binding and is distinct from the passkey.",
      "owner is stored on phygital_token.owner at init (use the default zero pubkey for unowned tokens).",
      "mint starts as the default pubkey until set_mint.",
      "Derive the token PDA with findPhygitalTokenPda, then pass it to getInitializeInstruction.",
      "On mainnet the authority is a Squads vault — wrap `getInitializeInstruction` with your own Squads client so the vault can sign.",
    ],
  };
}

export async function planSetMint(input: {
  secp256r1PublicKey: string;
  mint: string;
}) {
  const tokenPda = await findPhygitalTokenPda(input.secp256r1PublicKey);

  return {
    instruction: "set_mint",
    sdk: "getSetMintInstruction",
    derivedAccounts: {
      tokenPda,
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    requiredSigners: [
      {
        name: "authority",
        role: "Must be ADMIN (G6kBnedts6uAivtY72ToaFHBs1UVbT9udiXmQZgMEjoF); signer only (not writable)",
      },
    ],
    requiredInputs: {
      secp256r1Pubkey: input.secp256r1PublicKey,
      mint: input.mint,
    },
    notes: [
      "Binds an SPL mint pubkey onto phygital_token.mint. Does not mint or transfer tokens.",
      "Only the designated admin may call set_mint.",
      "Derive the token PDA with findPhygitalTokenPda, then pass it to getSetMintInstruction.",
      "On mainnet the authority is a Squads vault — wrap `getSetMintInstruction` with your own Squads client so the vault can sign.",
    ],
  };
}

export async function planTransfer(input: {
  secp256r1PublicKey: string;
  recipient: string;
}) {
  const tokenPda = await findPhygitalTokenPda(input.secp256r1PublicKey);

  return {
    flow: [
      "1. beginTransfer({ rpc, secp256r1Pubkey, rpId? }) — derives token PDA from passkey; fetch slot hash, build challenge; rpId defaults to hostname",
      "2. authenticatePasskeyForTransfer(session) — NFC/WebAuthn tap; passes secp256r1Pubkey in allowCredentials",
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
      phygital_token: tokenPda,
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
      "No SPL token transfer — transfer_ownership only updates phygital_token.owner.",
      "Controlled tokens must be unlocked (is_locked == 0) before transfer and auto-lock after a successful claim; remove_ownership clears the lock.",
      "beginTransfer takes Kit Rpc + base64url secp256r1Pubkey; derives phygital token PDA internally. Optional rpId defaults to window.location.hostname.",
      "Browser tap requires rpc for placeholder credential-id recovery (16-byte rawId). When rawId is 33 bytes, authenticator returned the passkey directly.",
      "completeTransfer takes a Kit TransactionSigner for recipient. web3.js callers convert with toRpc / toAddress / toTransactionSigner, then toWeb3Instructions.",
      "Challenge is slot-bound; complete the flow promptly (~512 slots).",
      "PDA is derived from the passkey public key, which also authorizes the signature.",
    ],
  };
}

function buildVerifyChallengeDescription(): string {
  return "messageHash (32 bytes) used directly as the WebAuthn challenge";
}

export async function planVerify(input: {
  message: string;
  secp256r1PublicKey?: string;
}) {
  const messageBytes = new TextEncoder().encode(input.message);
  const messageHash =
    "SHA256(message) — 32-byte hash passed to verify and used as WebAuthn challenge";

  let tokenPda: string | undefined;
  if (input.secp256r1PublicKey) {
    tokenPda = await findPhygitalTokenPda(input.secp256r1PublicKey);
  }

  return {
    flow: [
      "buildMessageHash(message) — 32-byte digest",
      "authenticatePasskeyForSecp256r1Verify({ rpc, messageHash }) — rpc required; optional rpId defaults to hostname",
      "buildSecp256r1VerifyInstruction(tap) — { secp256r1VerifyInstruction, phygitalTokenPda, secp256r1VerifyArgs }",
      "sendTransaction([secp256r1VerifyInstruction, yourProgramInstruction]) — your instruction carries phygitalTokenPda + secp256r1VerifyArgs; message_hash and instructions sysvar are yours",
    ],
    sdk: {
      hash: "buildMessageHash",
      authenticate: "authenticatePasskeyForSecp256r1Verify",
      build: "buildSecp256r1VerifyInstruction",
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
      note: "Hash with buildMessageHash, then pass { rpc, messageHash } to authenticatePasskeyForSecp256r1Verify. Use the same digest as VerifyCpiBuilder.message_hash.",
    },
    derived: tokenPda
      ? { tokenPda, secp256r1PublicKey: input.secp256r1PublicKey }
      : undefined,
    transactionLayout: {
      order: ["secp256r1_verify", "your_program_instruction"],
      verifyAccounts: {
        phygital_token: "writable PDA seeded by passkey public key — from phygitalTokenPda",
        instructions_sysvar: "Sysvar1nstructions1111111111111111111111111",
      },
      verifyArgs: {
        secp256r1VerifyArgs: "{ verifyArgsRelativeIndex, signedMessageIndex, clientDataJson }",
        messageHash: "32-byte WebAuthn challenge — from your instruction",
        expectedRpId: "Option<string> — omit/None skips; when set, SHA256(rpId) must match authenticatorData[0..32]",
        expectedOrigins: "Option<string[]> — omit/None skips; when set, clientDataJSON.origin must match one entry",
      },
    },
    programSide:
      "Your Rust program CPIs verify via VerifyCpiBuilder (phygital-token-client)",
    buildSecp256r1VerifyInstructionReturns: {
      secp256r1VerifyInstruction: "Instruction to prepend immediately before your program instruction",
      phygitalTokenPda: "Phygital token PDA — VerifyCpiBuilder.phygital_token",
      secp256r1VerifyArgs: "VerifyCpiBuilder.secp256r1_verify_args (relative index -1)",
    },
    notes: [
      "startAuthentication(message, rpc) + verifyResponse is off-chain only — it does not submit verify. Verify on your server.",
      "Browser WebAuthn requires rpc for placeholder recovery (rawId length 16). Authenticator returns passkey directly when rawId is 33 bytes.",
      "When recovery is ambiguous, the SDK picks the candidate with an initialized PhygitalToken PDA on-chain.",
      "Do not pass a token PDA up front — it is derived after the NFC tap from response.id.",
      "Hash with buildMessageHash before authenticatePasskeyForSecp256r1Verify. Optional rpId defaults to window.location.hostname.",
      "Your program CPIs verify. Do not include a client-side verify instruction. message_hash and instructions sysvar come from your instruction.",
      "Optional expected_rp_id / expected_origins are set on VerifyCpiBuilder, not the tap helper. Omit them to skip. When expected_origins is set, clientDataJSON.origin must match one listed origin.",
      "verify updates phygital_token.last_sign_count; WebAuthn signCount must be strictly increasing.",
      "verify does not change phygital_token.owner.",
    ],
  };
}

export async function planRemoveOwnership(input: {
  secp256r1PublicKey: string;
  owner: string;
}) {
  const tokenPda = await findPhygitalTokenPda(input.secp256r1PublicKey);

  return {
    instruction: "remove_ownership",
    sdk: "getRemoveOwnershipInstruction",
    flow: [
      "1. Confirm the connected wallet is phygital_token.owner on-chain",
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
        role: "Current phygital token owner wallet — must match phygital_token.owner on-chain",
      },
    ],
    onChainEffects: [
      "Sets phygital_token.owner to the default (zero) pubkey",
      "Clears phygital_token.is_locked (forfeiture unlocks Controlled tokens)",
      "Preserves phygital_token.last_sign_count",
    ],
    notes: [
      "Wallet-signed forfeiture — unlike transfer_ownership, no secp256r1_verify or passkey tap.",
      "Fails if signer is not phygital_token.owner.",
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
