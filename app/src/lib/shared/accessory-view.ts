import type { PhygitalToken } from 'phygital-token-sdk';

import { accessoryTag, bytesToBase64Url } from '$lib/shared/encoding';
import type { AccessoryStatus, AccessoryView, TokenKind } from '$lib/shared/types';

/** `11111111111111111111111111111111` — the program's "unset" pubkey. */
export const DEFAULT_PUBKEY = '11111111111111111111111111111111';

/** Discriminants of the program's `PhygitalTokenType` (`#[repr(u8)]`). */
export const TOKEN_KINDS: Record<number, TokenKind> = { 0: 'permanent', 1: 'bearer', 2: 'controlled' };

/**
 * What an accessory of each type may do, given its on-chain state:
 *
 * - Bearer:     link when unlocked (a tap can move it to a new wallet); the
 *               linked wallet may release it.
 * - Controlled: link ONLY when no wallet is linked. Once linked it can't move to
 *               another wallet until the linked wallet releases it.
 * - Permanent:  fixed forever. Never links, never releases.
 *
 * `is_locked` must also be 0 for `set_linked_wallet`; these rules are the
 * product contract on top of that, so an unexpected on-chain combination can
 * never be presented as linkable.
 */
export function accessoryRules(kind: TokenKind, linkedWallet: string | null, isLocked: boolean) {
	switch (kind) {
		case 'bearer':
			return { canLink: !isLocked, canRelease: linkedWallet !== null };
		case 'controlled':
			return { canLink: linkedWallet === null && !isLocked, canRelease: linkedWallet !== null };
		default: // permanent, unknown
			return { canLink: false, canRelease: false };
	}
}

export function toAccessoryView(pda: string, account: PhygitalToken): AccessoryView {
	const kind = TOKEN_KINDS[account.tokenType] ?? 'unknown';
	const linkedWallet = account.linkedWallet === DEFAULT_PUBKEY ? null : String(account.linkedWallet);
	const isLocked = account.isLocked !== 0;
	const identifier = bytesToBase64Url(new Uint8Array(account.identifier[0]));
	const publicKey = bytesToBase64Url(new Uint8Array(account.publicKey[0]));
	const rules = accessoryRules(kind, linkedWallet, isLocked);

	let status: AccessoryStatus;
	if (kind === 'unknown') status = 'unavailable';
	else if (!linkedWallet) status = rules.canLink ? 'ready_to_link' : 'unavailable'; // e.g. a Permanent token with no wallet
	else status = rules.canLink ? 'linked' : 'linked_locked';

	return {
		pda,
		identifier,
		tag: accessoryTag(publicKey),
		publicKey,
		kind,
		status,
		linkedWallet,
		isLocked,
		mint: account.mint === DEFAULT_PUBKEY ? null : String(account.mint),
		lastSignCount: account.lastSignCount,
		...rules
	};
}
