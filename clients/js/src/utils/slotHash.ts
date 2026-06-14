import {
  getBase64Encoder,
  getU64Decoder,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { SLOT_HASHES_SYSVAR_ADDRESS } from "./consts";

export function decodeBase64AccountData(
  data: string | [string, string] | Uint8Array,
): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  const base64 = Array.isArray(data) ? data[0] : data;
  return new Uint8Array(getBase64Encoder().encode(base64));
}

export async function getLatestSlotHash(rpc: Rpc<SolanaRpcApi>) {
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

  const slotHashData = decodeBase64AccountData(slotSysvarData);
  const slotNumber = getU64Decoder().decode(slotHashData.subarray(0, 8));
  const slotHash = slotHashData.subarray(8, 40);
  const estimatedSlotHashExpiry = Date.now() + 512 * 400;

  return { slotHash, slotNumber, estimatedSlotHashExpiry };
}

export async function fetchAccountData(
  rpc: Rpc<SolanaRpcApi>,
  account: Address,
): Promise<Uint8Array> {
  const response = await rpc
    .getAccountInfo(account, {
      encoding: "base64",
      commitment: "confirmed",
    })
    .send();

  if (!response.value?.data) {
    throw new Error(`Account not found: ${account}`);
  }

  return decodeBase64AccountData(response.value.data);
}
