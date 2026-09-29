
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

export type LinkStatusView = {
	id: string;
	kind: LinkKind;
	state: LinkState;
	/** `kind` is the token type, so each side can word the link for it ('unknown' on older rows). */
	accessory: { pda: string; tag: string; kind: TokenKind } | null;
	recipient: string | null;
	pairingCode: string | null;
	claimConflict: boolean;
	/**
	 * Unix ms when the pending tap stops being usable: its slot hash leaves the
	 * SlotHashes sysvar (minus a short landing margin), from live chain data.
	 */
	tapExpiresAt: number | null;
	tapWindowMs: number | null;
	expiresAt: number;
	txSignature: string | null;
	/** Name of the wallet app that finished the link (e.g. "Phantom"), for the picker's "Recent". */
	walletApp: string | null;
	errorCode: LinkErrorCode | null;
};

export type TransferPayload = {
	linkId: string;
	phygitalToken: string;
	secp256r1Pubkey: string;
	slotNumber: string;
	slotHash: string;
	challenge: string;
	rpId: string;
	response: {
		id: string;
		rawId: string;
		type: 'public-key';
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

export type TransferChallenge = {
	linkId: string;
	phygitalToken: string;
	secp256r1Pubkey: string;
	slotNumber: string;
	slotHash: string;
	challenge: string;
	rpId: string;
};

