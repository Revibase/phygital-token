import { address, type Address } from "@solana/kit";
import {
  AssetType,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
  parseSecp256r1Pubkey,
  findAssetPda,
} from "phygital-token-sdk";

export async function planInitialize(input: {
  identifier: string;
  secp256r1PublicKey: string;
  assetType: "Lockable" | "Transferable";
}) {
  const identifier = parseSecp256r1Pubkey(input.identifier);
  const secp256r1Pubkey = parseSecp256r1Pubkey(input.secp256r1PublicKey);
  const assetPda = await findAssetPda(identifier);
  const assetType =
    input.assetType === "Lockable" ? AssetType.Lockable : AssetType.Transferable;

  return {
    instruction: "initialize",
    sdk: "buildInitializeInstruction",
    assetType: input.assetType,
    derivedAccounts: {
      assetPda,
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    requiredSigners: [
      { name: "authority", role: "Pays rent; creates the asset PDA" },
    ],
    requiredInputs: {
      identifier: input.identifier,
      secp256r1Pubkey: input.secp256r1PublicKey,
      assetType,
    },
    notes: [
      "Creates an asset PDA seeded by the chip identifier (not the passkey).",
      "identifier and secp256r1Pubkey are independent 33-byte compressed values.",
      "Ownership starts as the default (zero) pubkey until the first transfer.",
    ],
  };
}

export async function planTransfer(input: {
  identifier: string;
  recipient: string;
}) {
  const assetPda = await findAssetPda(parseSecp256r1Pubkey(input.identifier));
  const recipient = address(input.recipient);

  return {
    flow: [
      "1. beginTransfer({ rpc, asset }) — fetch slot hash, build challenge",
      "2. authenticatePasskeyForTransfer(session) — NFC/WebAuthn tap on physical asset",
      "3. completeTransfer(session, webAuthnResponse, recipient) — pubkey from response.id; build secp256r1_verify + execute_transfer",
    ],
    sdk: {
      begin: "beginTransfer",
      authenticate: "authenticatePasskeyForTransfer",
      complete: "completeTransfer",
    },
    challenge: {
      formula: "SHA256('transfer' || SHA256(assetPda) || slotHash)",
      fetchedAt: "beginTransfer reads slot_hashes sysvar (~512 slot window)",
      note: "Run beginTransfer with a live rpc to get challengeBase64 and slotNumber.",
    },
    derived: {
      assetPda,
      identifier: input.identifier,
      recipient,
    },
    transferAccounts: {
      recipient: input.recipient,
      asset: assetPda,
      slotHashes: "SysvarS1otHashes111111111111111111111111111",
      instructionsSysvar: "Sysvar1nstructions1111111111111111111111111",
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    instructions: ["secp256r1_verify", "execute_transfer"],
    notes: [
      "No SPL token transfer — execute_transfer only updates asset.owner.",
      "beginTransfer only needs rpc + asset PDA; passkey comes from response.id at completeTransfer.",
      "Recipient is chosen at wallet confirmation — not bound in the passkey signature.",
      "Challenge is slot-bound; complete the flow promptly (~512 slots).",
      "PDA is derived from identifier; passkey public key authorizes the signature.",
    ],
  };
}

export async function planRemoveOwnership(input: {
  identifier: string;
  owner: string;
}) {
  const assetPda = await findAssetPda(parseSecp256r1Pubkey(input.identifier));

  return {
    instruction: "remove_ownership",
    sdk: "getRemoveOwnershipInstruction",
    flow: [
      "1. Confirm the connected wallet is asset.owner on-chain",
      "2. Build remove_ownership with getRemoveOwnershipInstruction",
      "3. Owner signs and submits the transaction (no passkey tap required)",
    ],
    derivedAccounts: {
      assetPda,
      identifier: input.identifier,
      owner: input.owner,
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    requiredSigners: [
      {
        name: "owner",
        role: "Current asset owner wallet — must match asset.owner on-chain",
      },
    ],
    onChainEffects: [
      "Sets asset.owner to the default (zero) pubkey",
      "Clears asset.is_locked (forfeiture unlocks lockable assets)",
      "Preserves asset.last_transfer_slot",
    ],
    notes: [
      "Wallet-signed forfeiture — unlike execute_transfer, no secp256r1_verify or passkey tap.",
      "Fails if signer is not asset.owner.",
    ],
  };
}

export function parseAssetType(value: string): "Lockable" | "Transferable" {
  const normalized = value.trim();
  if (normalized === "Lockable" || normalized === "Transferable") {
    return normalized;
  }
  throw new Error('assetType must be "Lockable" or "Transferable".');
}

export type { Address };
