import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import {
  type Address,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  authenticateDiscoverablePasskey,
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  fetchAssetCredentialFromCredentialId,
  findAssetPda,
  findAssociatedTokenAddress,
  getLatestSlotHash,
  parseSecp256r1Pubkey,
} from "phygital-token-sdk";

import { getExecuteSpendInstructionAsync } from "../generated/index.js";
import { buildSpendChallenge } from "../utils/message.js";

export type SpendSession = {
  rpc: Rpc<SolanaRpcApi>;
  mint: Address;
  tokenProgram:Address;
  recipient: Address;
  amount: bigint;
  slotHash: Uint8Array;
  slotNumber: bigint;
  challenge: Uint8Array;
};

/**
 * Prepares a spend session with slot-bound challenge data.
 * Asset and owner are unknown until after {@link authenticateSpend}.
 * Must be followed promptly by {@link authenticateSpend} and {@link completeSpend}.
 */
export async function beginSpend(input: {
  rpc: Rpc<SolanaRpcApi>;
  mint: Address;
  tokenProgram:Address;
  recipient: Address;
  amount: bigint | number;
}): Promise<SpendSession> {
  const amount = BigInt(input.amount);
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = await buildSpendChallenge({
    recipient: input.recipient,
    mint: input.mint,
    amount,
    slotHash,
  });

  return {
    rpc: input.rpc,
    mint: input.mint,
    tokenProgram: input.tokenProgram,
    recipient: input.recipient,
    amount,
    slotHash,
    slotNumber,
    challenge,
  };
}

/** Prompts the physical asset passkey (WebAuthn / NFC tap). */
export async function authenticateSpend(
  session: SpendSession,
): Promise<AuthenticationResponseJSON> {
  return authenticateDiscoverablePasskey({ challenge: session.challenge });
}

/**
 * Resolves asset and owner from the tap response, then builds the
 * secp256r1 + execute_spend instructions.
 */
export async function completeSpend(
  session: SpendSession,
  response: AuthenticationResponseJSON,
): Promise<Instruction[]> {
  const { publicKey, asset } = await fetchAssetCredentialFromCredentialId(
    response.id,
    session.rpc,
  );
  const owner = asset.owner;
  const tokenProgram = session.tokenProgram;

  const { secp256r1Verify, clientDataJson } =
    await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      response,
      publicKey,
    });

  const ownerTokenAccount = await findAssociatedTokenAddress(
    owner,
    session.mint,
    tokenProgram,
  );
  const recipientTokenAccount = await findAssociatedTokenAddress(
    session.recipient,
    session.mint,
    tokenProgram,
  );

  const executeSpend = await getExecuteSpendInstructionAsync({
    asset: await findAssetPda(parseSecp256r1Pubkey(publicKey)),
    owner,
    mint: session.mint,
    ownerTokenAccount,
    recipient: session.recipient,
    recipientTokenAccount,
    tokenProgram,
    signedMessageIndex: 0,
    slotNumber: session.slotNumber,
    clientDataJson,
    amount: session.amount,
  });

  return [secp256r1Verify, executeSpend];
}
