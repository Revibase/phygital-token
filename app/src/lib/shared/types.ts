/** Wire contracts shared by server routes and client code. */

export type TokenKind = 'permanent' | 'bearer' | 'controlled' | 'unknown';

export type AccessoryStatus =
	/** Nothing linked; a tap can link a wallet. */
	| 'ready_to_link'
	/** Linked, and a tap can move the link (Bearer). */
	| 'linked'
	/** Linked and locked: Controlled (linked wallet must release first) or Permanent. */
	| 'linked_locked'
	/** On-chain state the program should never produce (e.g. locked with no wallet). */
	| 'unavailable';

export type AccessoryView = {
	pda: string;
	identifier: string;
	/** Short human handle, e.g. `A1B2`. */
	tag: string;
	publicKey: string;
	kind: TokenKind;
	status: AccessoryStatus;
	linkedWallet: string | null;
	isLocked: boolean;
	mint: string | null;
	lastSignCount: number;
	canLink: boolean;
	canRelease: boolean;
};

export type TapFailureReason = 'malformed' | 'invalid' | 'replayed' | 'unknown' | 'network' | 'expired';

export type LinkKind = 'phone' | 'desktop';

export type LinkState =
	| 'pairing'
	| 'paired'
	| 'accessory_attached'
	| 'accessory_confirmed'
	| 'created'
	| 'awaiting_passkey'
	| 'tapped'
	| 'claimed'
	| 'finishing'
	| 'submitted'
	| 'linked'
	| 'cancelled'
	| 'expired'
	| 'failed';

export const TERMINAL_LINK_STATES: readonly LinkState[] = ['linked', 'cancelled', 'expired', 'failed'];

export type LinkErrorCode =
	| 'accessory_locked'
	| 'accessory_permanent'
	| 'different_accessory'
	| 'tap_rejected'
	| 'too_slow'
	| 'insufficient_sol'
	| 'already_used'
	| 'wallet_rejected'
	| 'network'
	| 'unknown';

/** What either side of a ceremony may see about it. Never contains secrets. */
export type LinkStatusView = {
	id: string;
	kind: LinkKind;
	state: LinkState;
	accessory: { pda: string; tag: string } | null;
	recipient: string | null;
	/** Desktop flow: shown on both screens so the user can match them. */
	pairingCode: string | null;
	/** Someone tried to open the handoff/pair link a second time. */
	claimConflict: boolean;
	/**
	 * Unix ms when the pending tap stops being usable: its slot hash leaves the
	 * SlotHashes sysvar (minus a short landing margin), from live chain data.
	 */
	tapExpiresAt: number | null;
	/** Full length of that window, for progress display. */
	tapWindowMs: number | null;
	expiresAt: number;
	txSignature: string | null;
	errorCode: LinkErrorCode | null;
};

/** Everything a wallet context needs to build `[secp256r1_verify, set_linked_wallet]`. */
export type TransferPayload = {
	linkId: string;
	phygitalToken: string;
	secp256r1Pubkey: string;
	slotNumber: string;
	slotHash: string;
	challenge: string;
	rpId: string;
	/** `AuthenticationResponseJSON` from the accessory tap. */
	response: {
		id: string;
		rawId: string;
		type: string;
		clientExtensionResults: Record<string, unknown>;
		authenticatorAttachment?: string;
		response: {
			clientDataJSON: string;
			authenticatorData: string;
			signature: string;
			userHandle?: string;
		};
	};
};

/** Challenge returned to the tapping browser (the TransferSession fields, minus rpc). */
export type TransferChallenge = {
	linkId: string;
	phygitalToken: string;
	secp256r1Pubkey: string;
	slotNumber: string;
	slotHash: string;
	challenge: string;
	rpId: string;
};

export type ApiError = { error: string; code?: LinkErrorCode | string };
