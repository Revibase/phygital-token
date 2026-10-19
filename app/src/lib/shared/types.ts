export type TokenKind = 'permanent' | 'bearer' | 'controlled' | 'unknown';

export type AccessoryStatus =
	/** Nothing linked; a tap can link a wallet. */
	| 'ready_to_link'
	/** Linked, and a tap can move the link (Bearer). */
	| 'linked'
	/** Linked and locked: Controlled (owner must release first) or Permanent. */
	| 'linked_locked'
	/** On-chain state the program should never produce (e.g. locked with no wallet). */
	| 'unavailable';

export type AccessoryView = {
	pda: string;
	/** Short human handle, e.g. `A1B2`. */
	tag: string;
	publicKey: string;
	kind: TokenKind;
	status: AccessoryStatus;
	owner: string | null;
	isLocked: boolean;
	mint: string | null;
	canLink: boolean;
	canRelease: boolean;
};

export type TapFailureReason =
	'malformed' | 'invalid' | 'replayed' | 'unknown' | 'network' | 'expired';

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
