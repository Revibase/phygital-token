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

export type OnChainCompositionPattern = "inspect" | "cpi" | "standalone";

function buildVerifyAssetChallengeDescription(message: string): string {
  const messageBytes = new TextEncoder().encode(message);
  return `SHA256('verify_asset' || SHA256(message[${messageBytes.length} bytes]) || slotHash)`;
}

export async function planVerifyAsset(input: {
  message: string;
  identifier?: string;
  onChainPattern?: OnChainCompositionPattern;
}) {
  const messageBytes = new TextEncoder().encode(input.message);

  let assetPda: string | undefined;
  if (input.identifier) {
    assetPda = await findAssetPda(parseSecp256r1Pubkey(input.identifier));
  }

  const pattern = input.onChainPattern ?? "inspect";
  const patternMeta = {
    inspect: {
      transactionOrder: ["secp256r1_verify", "verify_asset", "your_program_ix"],
      clientSteps: [
        "beginVerifyAsset({ rpc, asset, message })",
        "authenticatePasskeyForVerifyAsset(session)",
        "completeVerifyAsset(session, response) — or buildVerifyAssetArgs + getVerifyAssetInstruction",
        "buildYourProgramInstruction(/* same message bytes */)",
        "sendTransaction([secp256r1Verify, verifyAssetIx, yourIx])",
      ],
      programSide:
        "Your Rust program scans instructions_sysvar for preceding verify_asset; validates message",
      clientSdk: ["completeVerifyAsset", "getVerifyAssetInstruction"],
    },
    cpi: {
      transactionOrder: ["secp256r1_verify", "your_program_ix"],
      clientSteps: [
        "beginVerifyAsset({ rpc, asset, message })",
        "authenticatePasskeyForVerifyAsset(session)",
        "buildVerifyAssetArgs(session, response) — secp256r1Verify + verify args",
        "buildYourProgramInstruction({ secp256r1VerifyArgs, message, assetPda })",
        "sendTransaction([secp256r1Verify, yourIx]) — your program CPIs verify_asset",
      ],
      programSide:
        "Your Rust program CPIs verify_asset via VerifyAssetCpiBuilder (phygital-token-client)",
      clientSdk: ["buildVerifyAssetArgs"],
    },
    standalone: {
      transactionOrder: ["secp256r1_verify", "verify_asset"],
      clientSteps: [
        "beginVerifyAsset({ rpc, asset, message })",
        "authenticatePasskeyForVerifyAsset(session)",
        "completeVerifyAsset(session, response)",
        "sendTransaction([secp256r1Verify, verifyAssetIx])",
      ],
      programSide: "None — no custom program",
      clientSdk: ["completeVerifyAsset"],
    },
  }[pattern];

  return {
    onChainPattern: pattern,
    patternName:
      pattern === "inspect"
        ? "A — client posts verify_asset, program inspects"
        : pattern === "cpi"
          ? "B — client posts secp256r1_verify, program CPIs verify_asset"
          : "Standalone verify_asset",
    flow: patternMeta.clientSteps,
    sdk: {
      begin: "beginVerifyAsset",
      authenticate: "authenticatePasskeyForVerifyAsset",
      buildArgs: "buildVerifyAssetArgs",
      complete: "completeVerifyAsset",
      instruction: "getVerifyAssetInstruction",
      offChainAuthOnly:
        "startAuthentication (client) + verifyResponse (server); does NOT submit verify_asset",
    },
    message: {
      utf8: input.message,
      byteLength: messageBytes.length,
      onChainHash: "SHA256(message) — must match bytes passed to verify_asset",
    },
    challenge: {
      formula: buildVerifyAssetChallengeDescription(input.message),
      fetchedAt: "beginVerifyAsset reads slot_hashes sysvar (~512 slot window)",
      note: "Run beginVerifyAsset with a live rpc to get challengeBase64 and slotNumber.",
    },
    derived: assetPda ? { assetPda, identifier: input.identifier } : undefined,
    transactionLayout: {
      order: patternMeta.transactionOrder,
      verifyAssetAccounts: {
        asset: "writable PDA seeded by chip identifier",
        slot_hashes: "SysvarS1otHashes111111111111111111111111111",
        instructions_sysvar: "Sysvar1nstructions1111111111111111111111111",
      },
      verifyAssetArgs: {
        secp256r1VerifyArgs: "{ signedMessageIndex, slotNumber, clientDataJson }",
        message: "same Uint8Array as beginVerifyAsset",
      },
    },
    programSide: patternMeta.programSide,
    buildVerifyAssetArgsReturns: {
      asset: "decoded on-chain Asset account",
      assetPda: "Address (from session.asset)",
      secp256r1Verify: "Instruction for Secp256r1SigVerify program",
      signedMessageIndex: "number",
      clientDataJson: "Uint8Array",
    },
    notes: [
      "startAuthentication + verifyResponse is off-chain only — it does not submit verify_asset. Verify on your server.",
      "Pass asset PDA into beginVerifyAsset (seeded by identifier, not the passkey).",
      "Pattern A: client includes verify_asset; your program inspects instructions sysvar.",
      "Pattern B: client uses buildVerifyAssetArgs; your program CPIs verify_asset.",
      "verify_asset updates asset.last_transfer_slot; slot must be strictly increasing.",
      "verify_asset does not change asset.owner.",
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
