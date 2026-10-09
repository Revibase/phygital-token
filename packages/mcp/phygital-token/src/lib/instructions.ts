import { type Address } from "@solana/kit";
import {
  PhygitalTokenType,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
  findPhygitalTokenPda,
  findAdminConfigPda,
} from "phygital-token-sdk";

export async function planInitialize(input: {
  identifier: string;
  secp256r1PublicKey: string;
  tokenType: "Permanent" | "Controlled" | "Bearer";
  owner: string;
}) {
  const [tokenPda] = await findPhygitalTokenPda(input.secp256r1PublicKey);
  const [adminConfig] = await findAdminConfigPda();
  const tokenType =
    input.tokenType === "Permanent"
      ? PhygitalTokenType.Permanent
      : input.tokenType === "Controlled"
        ? PhygitalTokenType.Controlled
        : PhygitalTokenType.Bearer;

  return {
    instruction: "initialize",
    sdk: "getInitializeInstruction",
    tokenType: input.tokenType,
    derivedAccounts: {
      tokenPda,
      adminConfig,
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    requiredSigners: [
      {
        name: "authority",
        role: "Must be AdminConfig.issuer; pays rent and creates the token PDA",
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
      "owner is stored on phygital_token.owner at init (required non-default for Permanent; use the default zero pubkey for unowned Bearer/Controlled tokens).",
      "Tokens initialized with a non-default owner start locked (is_locked = 1).",
      "Permanent tokens stay locked forever (remove_owner is rejected); set_owner fails with TokenIsCurrentlyLocked.",
      "mint starts as the default pubkey until assign_mint.",
      "Bootstrap AdminConfig with create_config, then set_issuer before calling initialize.",
      "Derive the token PDA with findPhygitalTokenPda; AdminConfig with findAdminConfigPda.",
    ],
  };
}

export async function planAssignMint(input: {
  secp256r1PublicKey: string;
  mint: string;
}) {
  const [tokenPda] = await findPhygitalTokenPda(input.secp256r1PublicKey);
  const [adminConfig] = await findAdminConfigPda();

  return {
    instruction: "assign_mint",
    sdk: "getAssignMintInstruction",
    derivedAccounts: {
      tokenPda,
      adminConfig,
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    requiredSigners: [
      {
        name: "authority",
        role: "Must be AdminConfig.minter; signer only (not writable)",
      },
    ],
    requiredInputs: {
      secp256r1Pubkey: input.secp256r1PublicKey,
      mint: input.mint,
    },
    notes: [
      "Binds an SPL mint pubkey onto phygital_token.mint. Does not mint or transfer tokens.",
      "Only AdminConfig.minter may call assign_mint (admin and issuer cannot).",
      "Bootstrap with create_config → set_minter before calling assign_mint.",
      "Derive the token PDA with findPhygitalTokenPda; AdminConfig with findAdminConfigPda.",
    ],
  };
}

/** @deprecated Use {@link planAssignMint}. */
export const planSetMint = planAssignMint;

export async function planCreateConfig() {
  const [adminConfig] = await findAdminConfigPda();
  return {
    instruction: "create_config",
    sdk: "getCreateConfigInstruction",
    derivedAccounts: {
      adminConfig,
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    requiredSigners: [
      {
        name: "authority",
        role: "Becomes AdminConfig.admin; pays rent. Callable once.",
      },
    ],
    related: {
      set_admin: "getSetAdminInstruction — transfer sole admin (cannot promote issuer/minter)",
      set_issuer: "getSetIssuerInstruction — set the single issuer pubkey",
      set_minter: "getSetMinterInstruction — set the single minter pubkey",
    },
    notes: [
      "Creates the singleton AdminConfig PDA (seeds = [\"admin\"]).",
      "Signer becomes the sole admin. issuer and minter start as default until set.",
      "Roles must be distinct pubkeys (KeyAlreadyExists if overlapping).",
      "initialize requires issuer; assign_mint requires minter.",
    ],
  };
}

export async function planTransfer(input: {
  secp256r1PublicKey: string;
  recipient: string;
}) {
  const [tokenPda] = await findPhygitalTokenPda(input.secp256r1PublicKey);

  return {
    flow: [
      "1. beginTransfer({ rpc, secp256r1Pubkey, rpId? }) — derives token PDA from passkey; fetch slot hash, build challenge; rpId defaults to hostname",
      "2. authenticatePasskeyForTransfer(session, { transceive? }) — browser WebAuthn or native APDU when transceive is set",
      "3. completeTransfer(session, webAuthnResponse, recipientSigner) — passkey from response.id; builds secp256r1_verify + set_owner",
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
    setOwnerAccounts: {
      recipient: `${input.recipient} (signer — must co-sign the transaction)`,
      phygital_token: tokenPda,
      slotHashes: "SysvarS1otHashes111111111111111111111111111",
      instructionsSysvar: "Sysvar1nstructions1111111111111111111111111",
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    requiredSigners: [
      {
        name: "recipient",
        role: "Recipient wallet accepting the owner assignment — must sign the transaction",
      },
    ],
    setOwnerArgs: {
      secp256r1VerifyArgs: "{ verifyArgsRelativeIndex, signedMessageIndex, clientDataJson }",
      slotNumber: "u64 — separate instruction arg; used to fetch slot hash for transfer challenge",
    },
    instructions: ["secp256r1_verify", "set_owner"],
    notes: [
      "No SPL token transfer — set_owner only updates phygital_token.owner.",
      "Requires is_locked == 0 for every token type. Permanent tokens start locked (owner set at init).",
      "Controlled tokens re-lock after a successful claim; remove_owner clears the lock.",
      "Permanent tokens remain locked (cannot forfeit), so set_owner always fails with TokenIsCurrentlyLocked.",
      "beginTransfer takes Kit Rpc + base64url secp256r1Pubkey; derives phygital token PDA internally. Optional rpId defaults to window.location.hostname.",
      "Browser tap: pass rpc to recover a 16-byte placeholder on-chain; allowList gates the tapped credential id and is the no-RPC recovery fallback. Pass { transceive } for native/kiosk APDU.",
      "completeTransfer takes a Kit TransactionSigner for recipient.",
      "Challenge is slot-bound; complete the flow promptly (~512 slots).",
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
    [tokenPda] = await findPhygitalTokenPda(input.secp256r1PublicKey);
  }

  return {
    flow: [
      "buildMessageHash(message) — 32-byte digest",
      "authenticatePasskeyForSecp256r1Verify({ rpc, allowList?, messageHash, rpId?, transceive? }) — browser or native APDU",
      "buildSecp256r1VerifyInstruction(tap) — { secp256r1VerifyInstruction, phygitalTokenPda, secp256r1VerifyArgs }",
      "sendTransaction([secp256r1VerifyInstruction, yourProgramInstruction]) — your instruction carries phygitalTokenPda + secp256r1VerifyArgs; message_hash and instructions sysvar are yours",
    ],
    sdk: {
      hash: "buildMessageHash",
      authenticate: "authenticatePasskeyForSecp256r1Verify",
      build: "buildSecp256r1VerifyInstruction",
      offChainAuthOnly:
        "startAuthentication + verifyResponse → your session; does NOT submit verify",
    },
    message: {
      utf8: input.message,
      byteLength: messageBytes.length,
      onChainHash: messageHash,
    },
    challenge: {
      formula: buildVerifyChallengeDescription(),
      note: "Hash with buildMessageHash, then pass { rpc, allowList?, messageHash } to authenticatePasskeyForSecp256r1Verify. Use the same digest as VerifyCpiBuilder.message_hash.",
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
      "Off-chain login (startAuthentication + verifyResponse) does not submit verify.",
      "On-chain tap helpers (authenticatePasskeyForTransfer, authenticatePasskeyForSecp256r1Verify) share authenticatePasskey: transceive → APDU, else browser WebAuthn.",
      "Browser WebAuthn: rpc recovers a rawId-length-16 placeholder on-chain; allowList gates the tapped id and is the no-RPC recovery fallback.",
      "Do not pass a token PDA up front — it is derived after the NFC tap from response.id.",
      "Your program CPIs verify. Do not include a client-side verify instruction.",
      "verify updates phygital_token.last_sign_count; it does not change owner.",
    ],
  };
}

export async function planRemoveOwner(input: {
  secp256r1PublicKey: string;
  owner: string;
}) {
  const [tokenPda] = await findPhygitalTokenPda(input.secp256r1PublicKey);

  return {
    instruction: "remove_owner",
    sdk: "getRemoveOwnerInstruction",
    flow: [
      "1. Confirm the connected wallet is phygital_token.owner on-chain",
      "2. Build remove_owner with getRemoveOwnerInstruction",
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
        role: "Current owner — must match phygital_token.owner on-chain",
      },
    ],
    onChainEffects: [
      "Sets phygital_token.owner to the default (zero) pubkey",
      "Clears phygital_token.is_locked (required before the next set_owner when locked)",
      "Preserves phygital_token.last_sign_count",
    ],
    notes: [
      "Wallet-signed forfeiture — unlike set_owner, no secp256r1_verify or passkey tap.",
      "Fails if signer is not phygital_token.owner.",
      "Rejected for Permanent tokens (PermanentOwnerImmutable).",
    ],
  };
}

export function parseTokenType(value: string): "Permanent" | "Controlled" | "Bearer" {
  const normalized = value.trim();
  if (
    normalized === "Permanent" ||
    normalized === "Controlled" ||
    normalized === "Bearer"
  ) {
    return normalized;
  }
  throw new Error('tokenType must be "Permanent", "Controlled", or "Bearer".');
}

export type { Address };
