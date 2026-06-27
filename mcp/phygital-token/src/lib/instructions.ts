import {
  address,
  getAddressEncoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  getU64Decoder,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  AssetType,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
  findProgramAuthorityPda,
  parseSecp256r1Pubkey,
  validateMetadataFields,
  findAssetPda,
  fetchAssetDisplayInfo,
  type MetadataFields,
} from "phygital-token-sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import type { OnChainCompositionPattern } from "./verification.js";

const TOKEN_2022_PROGRAM_ADDRESS = address(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const SLOT_HASHES_SYSVAR_ADDRESS = address(
  "SysvarS1otHashes111111111111111111111111111",
);
const TRANSFER_ACTION_BYTES = new TextEncoder().encode("transfer");

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function findAssociatedTokenAddress(
  owner: Address,
  mint: Address,
  tokenProgram: Address,
): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      getAddressEncoder().encode(owner),
      getAddressEncoder().encode(tokenProgram),
      getAddressEncoder().encode(mint),
    ],
  });
  return ata;
}

async function getLatestSlotHash(rpc: Rpc<SolanaRpcApi>) {
  const slotSysvarData = (
    await rpc
      .getAccountInfo(SLOT_HASHES_SYSVAR_ADDRESS, {
        encoding: "base64",
        commitment: "confirmed",
        dataSlice: { offset: 8, length: 40 },
      })
      .send()
  ).value?.data;

  if (!slotSysvarData) {
    throw new Error("Unable to fetch slot hashes sysvar");
  }

  const base64 = Array.isArray(slotSysvarData) ? slotSysvarData[0] : slotSysvarData;
  const slotHashData = new Uint8Array(getBase64Encoder().encode(base64));
  const slotNumber = getU64Decoder().decode(slotHashData.subarray(0, 8));
  const slotHash = slotHashData.subarray(8, 40);

  return { slotHash, slotNumber };
}

function buildTransferChallenge(input: {
  asset: Address;
  slotHash: Uint8Array;
}): Uint8Array {
  const assetBytes = new Uint8Array(getAddressEncoder().encode(input.asset));
  const messageHash = sha256(assetBytes);
  return sha256(
    concatBytes(TRANSFER_ACTION_BYTES, messageHash, new Uint8Array(input.slotHash)),
  );
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function planCreateMint(fields: MetadataFields) {
  validateMetadataFields(fields);

  return {
    instruction: "create_mint",
    sdk: "buildCreateMintInstructions",
    metadata: fields,
    requiredSigners: [
      { name: "payer", role: "Pays rent and transaction fees" },
      { name: "owner", role: "Design mint owner / update authority" },
      { name: "groupMintAuthority", role: "Authority over the collection group mint" },
      { name: "mint", role: "New design mint keypair (caller-supplied signer)" },
    ],
    requiredAccounts: [
      { name: "groupMint", role: "Token-2022 collection (group) parent mint" },
    ],
    notes: [
      "Creates a shared design mint (SFT template) within a collection.",
      "Metadata name ≤ 32, symbol ≤ 10, uri ≤ 200 characters.",
    ],
  };
}

export async function planMintToken(input: {
  assetPublicKey: string;
  mint: string;
  assetType: "Lockable" | "Transferable";
  credentialId?: string;
}) {
  const secp256r1Pubkey = parseSecp256r1Pubkey(input.assetPublicKey);
  const assetPda = await findAssetPda(secp256r1Pubkey);
  const [programAuthority] = await findProgramAuthorityPda();
  const mint = address(input.mint);
  const programAuthorityTokenAccount = await findAssociatedTokenAddress(
    programAuthority,
    mint,
    TOKEN_2022_PROGRAM_ADDRESS,
  );

  const assetType =
    input.assetType === "Lockable" ? AssetType.Lockable : AssetType.Transferable;

  return {
    instruction: "mint_token",
    sdk: "buildMintTokenInstructions",
    assetType: input.assetType,
    derivedAccounts: {
      assetPda,
      programAuthority,
      programAuthorityTokenAccount,
      mint: input.mint,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    requiredSigners: [
      { name: "authority", role: "Mint authority for the design mint" },
    ],
    requiredInputs: {
      secp256r1Pubkey: input.assetPublicKey,
      credentialId: input.credentialId ?? "(base64url, 64 bytes when decoded)",
      assetType,
    },
    notes: [
      "Mints one SPL token into program custody and initializes the asset PDA.",
      "Passkey pubkey must be compressed secp256r1 (33 bytes, 0x02/0x03 prefix).",
    ],
  };
}

export async function planTransfer(input: {
  rpc: Rpc<SolanaRpcApi>;
  assetPublicKey: string;
  recipient: string;
}) {
  const displayInfo = await fetchAssetDisplayInfo(input.rpc, input.assetPublicKey);
  const recipient = address(input.recipient);
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = buildTransferChallenge({
    asset: displayInfo.asset,
    slotHash,
  });

  const senderTokenAccount = await findAssociatedTokenAddress(
    displayInfo.currentOwner,
    displayInfo.mint,
    TOKEN_2022_PROGRAM_ADDRESS,
  );
  const recipientTokenAccount = await findAssociatedTokenAddress(
    recipient,
    displayInfo.mint,
    TOKEN_2022_PROGRAM_ADDRESS,
  );

  return {
    flow: [
      "1. beginTransfer({ rpc, displayInfo }) — fetch slot hash, build challenge",
      "2. authenticatePasskeyForTransfer(session) — NFC/WebAuthn tap on physical asset",
      "3. completeTransfer(session, webAuthnResponse, recipient) — build secp256r1_verify + execute_transfer",
    ],
    sdk: {
      begin: "beginTransfer",
      authenticate: "authenticatePasskeyForTransfer",
      complete: "completeTransfer",
    },
    slot: {
      slotNumber: slotNumber.toString(),
      challengeBase64: toBase64(challenge),
      expiresInSlots: 512,
    },
    asset: {
      assetPda: displayInfo.asset,
      mint: displayInfo.mint,
      currentOwner: displayInfo.currentOwner,
      credentialId: displayInfo.credentialId,
      publicKey: displayInfo.publicKey,
    },
    transferAccounts: {
      sender: displayInfo.currentOwner,
      recipient: input.recipient,
      senderTokenAccount,
      recipientTokenAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      program: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    },
    instructions: ["secp256r1_verify", "execute_transfer"],
    notes: [
      "Recipient is chosen at wallet confirmation — not bound in the passkey signature.",
      "Challenge is slot-bound; complete the flow promptly (~512 slots).",
    ],
  };
}

const VERIFY_ASSET_ACTION_BYTES = new TextEncoder().encode("verify_asset");

function buildVerifyAssetChallenge(input: {
  message: Uint8Array;
  slotHash: Uint8Array;
}): Uint8Array {
  const messageHash = sha256(input.message);
  return sha256(
    concatBytes(
      VERIFY_ASSET_ACTION_BYTES,
      messageHash,
      new Uint8Array(input.slotHash),
    ),
  );
}

export async function planVerifyAsset(input: {
  rpc: Rpc<SolanaRpcApi>;
  message: string;
  assetPublicKey?: string;
  onChainPattern?: OnChainCompositionPattern;
}) {
  const messageBytes = new TextEncoder().encode(input.message);
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = buildVerifyAssetChallenge({ message: messageBytes, slotHash });

  let assetPda: string | undefined;
  if (input.assetPublicKey) {
    assetPda = await findAssetPda(parseSecp256r1Pubkey(input.assetPublicKey));
  }

  const pattern = input.onChainPattern ?? "inspect";
  const patternMeta = {
    inspect: {
      transactionOrder: ["secp256r1_verify", "verify_asset", "your_program_ix"],
      clientSteps: [
        "beginVerifyAsset({ rpc, message })",
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
        "beginVerifyAsset({ rpc, message })",
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
        "beginVerifyAsset({ rpc, message })",
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
    patternName: pattern === "inspect"
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
      offChainAuthOnly: "verifyWithChallengeResponse (does NOT submit verify_asset)",
    },
    message: {
      utf8: input.message,
      byteLength: messageBytes.length,
      onChainHash: "SHA256(message) — must match bytes passed to verify_asset",
    },
    slot: {
      slotNumber: slotNumber.toString(),
      challengeBase64: toBase64(challenge),
      expiresInSlots: 512,
    },
    derived: assetPda ? { assetPda, assetPublicKey: input.assetPublicKey } : undefined,
    transactionLayout: {
      order: patternMeta.transactionOrder,
      verifyAssetAccounts: {
        asset: "writable PDA matching passkey pubkey",
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
      assetPda: "Address",
      secp256r1Verify: "Instruction for Secp256r1SigVerify program",
      signedMessageIndex: "number",
      clientDataJson: "Uint8Array",
    },
    notes: [
      "verifyWithChallengeResponse is off-chain only — it does not submit verify_asset.",
      "Pattern A: client includes verify_asset; your program inspects instructions sysvar.",
      "Pattern B: client uses buildVerifyAssetArgs; your program CPIs verify_asset.",
      "verify_asset updates asset.last_transfer_slot; slot must be strictly increasing.",
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
