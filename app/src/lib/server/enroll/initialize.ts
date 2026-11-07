import {
	address,
	type Address,
	type Instruction,
	type Rpc,
	type Signature,
	type SolanaRpcApi,
	type TransactionSigner,
	type V1TransactionConfig
} from '@solana/kit';
import { hexToBytes } from '@noble/curves/utils.js';
import {
	findAdminConfigPda,
	findPhygitalTokenPda,
	getInitializeInstruction,
	parseSecp256r1Pubkey,
	PhygitalTokenType
} from 'phygital-token-sdk';

import { DEFAULT_PUBKEY } from '#lib/shared/accessory-view.ts';
import {
	verifyClientData,
	verifyMakeCredentialAttestation,
	type EnrollmentResponse,
	type VerifyAttestationOptions
} from '#lib/shared/attestation.ts';
import { base64ToBytes, bytesEqual } from '#lib/shared/encoding.ts';
import { fetchAccessory } from '../accessory/resolve';
import { packedCardMint } from '../cards';
import { CHALLENGE_TTL_MS } from '../challenges';
import { ConfigError } from '../env';

/** Every card enrolled in the app starts as an unowned Controlled token. */
const NO_OWNER = address(DEFAULT_PUBKEY);
const TOKEN_TYPE = PhygitalTokenType.Controlled;
/** Namespace in `auth_challenges` holding one in-flight enrollment per identifier. */
const LOCK_NAMESPACE = 'enroll-lock';

export type EnrollErrorCode =
	'invalid_attestation' | 'not_packed' | 'already_enrolled' | 'in_progress';

export class EnrollError extends Error {
	constructor(
		readonly code: EnrollErrorCode,
		message: string
	) {
		super(message);
		this.name = 'EnrollError';
	}
}

/** The trusted roots (and optional AAGUID) from `ATTESTATION_ROOT_CERTS` / `ATTESTATION_AAGUID`. */
export function attestationOptions(env: Cloudflare.Env): VerifyAttestationOptions {
	const roots = (env.ATTESTATION_ROOT_CERTS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => base64ToBytes(s));
	if (roots.length === 0) throw new ConfigError('ATTESTATION_ROOT_CERTS is missing');
	const aaguid = env.ATTESTATION_AAGUID?.replace(/-/g, '').trim();
	if (aaguid && !/^[0-9a-fA-F]{32}$/.test(aaguid)) {
		throw new ConfigError('ATTESTATION_AAGUID must be 16 bytes of hex');
	}
	return { rootCertDers: roots, expectedAaguid: aaguid ? hexToBytes(aaguid) : undefined };
}

/**
 * `initialize`'s limits, measured on a local validator running the mainnet and
 * devnet builds of the program.
 * - Compute: 8,197 units when the token PDA's bump is 255, plus 1,500 for each
 *   bump below that, since `init` searches down from 255. 60,000 covers bumps
 *   down to 221; a card misses that about once in 34 billion.
 * - Loaded data: the program's data account (361,557 bytes on mainnet) plus 482
 *   bytes for the other accounts. 1 MiB leaves room for the program to grow.
 */
export const INITIALIZE_BUDGET = {
	computeUnitLimit: 60_000,
	loadedAccountsDataSizeLimit: 1024 * 1024
} as const satisfies V1TransactionConfig;

export type EnrollDeps = {
	db: D1Database;
	rpc: Rpc<SolanaRpcApi>;
	issuer: TransactionSigner;
	attestation: VerifyAttestationOptions;
	/** Sends and confirms the transaction; `signAndSend` in production. */
	send: (instructions: Instruction[], budget: V1TransactionConfig) => Promise<Signature>;
};

export type EnrollInput = {
	/** The card's NDEF key, from the verified tap that issued the enroll cookie. */
	identifier: string;
	/** The enroll session's challenge (`enrollChallenge`) this `credentials.create` was made over. */
	challenge: Uint8Array;
	response: EnrollmentResponse;
	/** The page origin the enrollment must have been made on. */
	origin: string;
};

export type EnrollResult = { pda: Address; signature: Signature | null };

/**
 * Register an enrolled card: check the enrollment was made on this origin over
 * the session's challenge and that its attestation chains to a Revi root,
 * then `initialize` an unowned Controlled token (signed and paid for by the
 * issuer) under the tapped identifier, carrying the mint the pack station gave
 * the card in `cards`. The webhook mirrors it into D1.
 *
 * Safe to retry. The card's enrollment is idempotent (every `create` returns
 * the same product key), so a failed attempt just enrolls again; a token an
 * earlier attempt already initialized for this card counts as done. The tap
 * landing already checked the identifier has no token before issuing the
 * enroll cookie, so only the product key's PDA is checked here.
 *
 * Only genuine cards pass the attestation, and each product key can be
 * initialized once, so the issuer pays rent for at most one account per card.
 */
export async function registerCard(deps: EnrollDeps, input: EnrollInput): Promise<EnrollResult> {
	let publicKey: Uint8Array;
	try {
		verifyClientData(input.response, { challenge: input.challenge, origin: input.origin });
		({ publicKey } = verifyMakeCredentialAttestation(input.response, deps.attestation));
	} catch (err) {
		throw new EnrollError(
			'invalid_attestation',
			err instanceof Error ? err.message : 'Invalid card attestation.'
		);
	}
	const pda = await findPhygitalTokenPda(publicKey);
	// The tap landing checked this too, but the enroll cookie predates this read.
	const mint = await packedCardMint(deps.db, input.identifier);
	if (!mint) throw new EnrollError('not_packed', 'This card isn’t registered.');

	if (!(await lock(deps.db, input.identifier))) {
		throw new EnrollError('in_progress', 'This card is already being enrolled.');
	}
	try {
		const identifier = parseSecp256r1Pubkey(input.identifier);
		// The PDA on chain is the source of truth: this card's token under this identifier
		// means an earlier attempt finished; under another identifier, it's a conflict.
		const existing = await fetchAccessory(deps.rpc, pda);
		if (existing && !bytesEqual(existing.account.identifier[0], identifier[0])) {
			throw new EnrollError('already_enrolled', 'This card is already enrolled.');
		}

		let signature: Signature | null = null;
		if (!existing) {
			const [adminConfig] = await findAdminConfigPda();
			signature = await deps.send(
				[
					getInitializeInstruction({
						authority: deps.issuer,
						adminConfig,
						phygitalToken: pda,
						identifier,
						secp256r1Pubkey: [publicKey],
						tokenType: TOKEN_TYPE,
						owner: NO_OWNER,
						mint
					})
				],
				INITIALIZE_BUDGET
			);
		}

		// `phygital_tokens` follows from the `InitializeEvent` via the Helius webhook.
		return { pda, signature };
	} finally {
		await unlock(deps.db, input.identifier);
	}
}

/** Claim the identifier for one enrollment at a time; a stale claim expires with the challenge TTL. */
async function lock(db: D1Database, identifier: string, now = Date.now()): Promise<boolean> {
	const [, claimed] = await db.batch([
		db
			.prepare('DELETE FROM auth_challenges WHERE id = ? AND namespace = ? AND expires_at < ?')
			.bind(identifier, LOCK_NAMESPACE, now),
		db
			.prepare(
				`INSERT INTO auth_challenges (id, namespace, value, expires_at) VALUES (?, ?, '', ?)
         ON CONFLICT(id) DO NOTHING`
			)
			.bind(identifier, LOCK_NAMESPACE, now + CHALLENGE_TTL_MS)
	]);
	return (claimed.meta?.changes ?? 0) > 0;
}

async function unlock(db: D1Database, identifier: string) {
	await db
		.prepare('DELETE FROM auth_challenges WHERE id = ? AND namespace = ?')
		.bind(identifier, LOCK_NAMESPACE)
		.run();
}
