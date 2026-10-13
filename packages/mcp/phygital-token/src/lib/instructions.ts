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
      "Locked is derived, not stored: Controlled and Permanent tokens are locked whenever they have an owner (isPhygitalTokenLocked).",
      "Permanent tokens stay locked forever (remove_owner is rejected); set_owner fails with TokenIsCurrentlyLocked.",
      "mint starts as the default pubkey until assign_mint.",
      "Bootstrap AdminConfig with create_config, then set_issuer before calling initialize.",
      "Derive the token PDA with findPhygitalTokenPda; AdminConfig with findAdminConfigPda.",
    ],
  };
}

export async function planAssignMint(input: { secp256r1PublicKey: string; mint: string }) {
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
      'Creates the singleton AdminConfig PDA (seeds = ["admin"]).',
      "Signer becomes the sole admin. issuer and minter start as default until set.",
      "Roles must be distinct pubkeys (KeyAlreadyExists if overlapping).",
      "initialize requires issuer; assign_mint requires minter.",
    ],
  };
}

export async function planTransfer(input: { secp256r1PublicKey: string; recipient: string }) {
  const [tokenPda] = await findPhygitalTokenPda(input.secp256r1PublicKey);

  return {
    flow: [
      "1. beginTransfer({ rpc, secp256r1Pubkey, rpId? }) — derives token PDA from passkey; fetch slot hash, build challenge; rpId defaults to hostname",
      "2. authenticatePasskeyForTransfer(session) — browser WebAuthn tap",
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
      verifyArgsRelativeIndex:
        "i64 — position of the secp256r1 precompile instruction (usually -1)",
      signedMessageIndex: "u8 — which signature inside the precompile instruction",
      clientDataJson: "bytes — the exact clientDataJSON the authenticator signed",
      slotNumber: "u64 — separate instruction arg; used to fetch slot hash for transfer challenge",
    },
    instructions: ["secp256r1_verify", "set_owner"],
    notes: [
      "No SPL token transfer — set_owner only updates phygital_token.owner.",
      "Requires an unlocked token: Bearer always; Controlled only with no owner. Permanent tokens are always locked (owner set at init).",
      "A claimed Controlled token is locked until remove_owner.",
      "Permanent tokens remain locked (cannot forfeit), so set_owner always fails with TokenIsCurrentlyLocked.",
      "beginTransfer takes Kit Rpc and base64url secp256r1Pubkey; derives phygital token PDA internally. Optional rpId defaults to window.location.hostname.",
      "The challenge does not name the recipient, so the tap can happen before the wallet is chosen (handoffs). Anyone who sees the assertion before it lands could submit it for their own wallet: send it promptly.",
      "Browser tap: pass rpc to recover a 16-byte placeholder on-chain; allowList gates the tapped credential id and is the no-RPC recovery fallback.",
      "completeTransfer takes a Kit TransactionSigner for recipient.",
      "Challenge is slot-bound; complete the flow promptly (~512 slots).",
    ],
  };
}

export async function planRemoveOwner(input: { secp256r1PublicKey: string; owner: string }) {
  const [tokenPda] = await findPhygitalTokenPda(input.secp256r1PublicKey);

  return {
    instruction: "remove_owner",
    sdk: "getRemoveOwnerInstruction",
    flow: [
      "1. Confirm the connected wallet is phygital_token.owner on-chain",
      "2. Build remove_owner with getRemoveOwnerInstruction({ owner, phygitalToken: tokenPda })",
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
      "Unlocks a Controlled token (locked is derived from having an owner)",
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
  if (normalized === "Permanent" || normalized === "Controlled" || normalized === "Bearer") {
    return normalized;
  }
  throw new Error('tokenType must be "Permanent", "Controlled", or "Bearer".');
}

export type { Address };
