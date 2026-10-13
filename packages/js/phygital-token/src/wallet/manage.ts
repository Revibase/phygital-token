import type { Address } from "@solana/kit";

/**
 * The Revibase page where an accessory's owner manages it: allows programs,
 * sets spending limits and refills network fees.
 */
export function accessoryManageUrl(phygitalToken: Address): string {
  return `https://portal.revibase.com/wallet/${phygitalToken}`;
}
