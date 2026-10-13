/** Local-only permissions round-trip: fresh validator with the current program loaded. */
import assert from 'node:assert/strict';
import { p256 } from '@noble/curves/nist.js';
import {
	address,
	airdropFactory,
	appendTransactionMessageInstructions,
	createSolanaRpc,
	createSolanaRpcSubscriptions,
	createTransactionMessage,
	generateKeyPairSigner,
	lamports,
	pipe,
	sendAndConfirmTransactionFactory,
	setTransactionMessageConfig,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
	type Instruction,
	type KeyPairSigner
} from '@solana/kit';
import {
	fetchAccessoryPolicy,
	findAdminConfigPda,
	findPhygitalTokenPda,
	findPolicyPda,
	getCreateConfigInstructionAsync,
	getInitializeInstructionAsync,
	getSetIssuerInstructionAsync,
	PhygitalTokenType
} from 'phygital-token-sdk';
import {
	draftFromPolicy,
	emptyDraft,
	policyDiff,
	SOL,
	type PolicyDraft
} from '../src/lib/shared/policy-draft';
import { buildPolicyInstruction } from '../src/lib/shared/wallet-instructions';

const rpc = createSolanaRpc('http://127.0.0.1:18999');
const rpcSubscriptions = createSolanaRpcSubscriptions('ws://127.0.0.1:19000');
const airdrop = airdropFactory({ rpc, rpcSubscriptions });
const confirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
async function fund() {
	const signer = await generateKeyPairSigner();
	await airdrop({
		recipientAddress: signer.address,
		lamports: lamports(2_000_000_000n),
		commitment: 'confirmed'
	});
	return signer;
}
async function send(payer: KeyPairSigner, instructions: Instruction[]) {
	const { value: lifetime } = await rpc.getLatestBlockhash().send();
	const tx = await signTransactionMessageWithSigners(
		pipe(
			createTransactionMessage({ version: 1 }),
			(m) => setTransactionMessageFeePayerSigner(payer, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
			(m) =>
				setTransactionMessageConfig(
					{ computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 64 * 1024 * 1024 },
					m
				),
			(m) => appendTransactionMessageInstructions(instructions, m)
		)
	);
	await confirm(tx as Parameters<typeof confirm>[0], { commitment: 'confirmed' });
}
const admin = await fund();
const owner = await fund();
const issuer = await fund();
const [adminConfig] = await findAdminConfigPda();
assert.equal(
	(await rpc.getAccountInfo(adminConfig).send()).value,
	null,
	'Use a fresh isolated validator'
);
await send(admin, [await getCreateConfigInstructionAsync({ authority: admin })]);
await send(admin, [await getSetIssuerInstructionAsync({ admin, issuer: issuer.address })]);
const publicKey = p256.getPublicKey(p256.utils.randomSecretKey(), true);
const pda = await findPhygitalTokenPda([publicKey]);
await send(issuer, [
	await getInitializeInstructionAsync({
		authority: issuer,
		adminConfig,
		phygitalToken: pda,
		identifier: [publicKey],
		secp256r1Pubkey: [publicKey],
		tokenType: PhygitalTokenType.Permanent,
		owner: owner.address
	})
]);
const draft: PolicyDraft = {
	origins: [],
	limits: new Map([[SOL, { cap: 500_000_000n, windowSeconds: 604_800n, maxPerTx: 100_000_000n }]]),
	programs: new Map([
		[
			address('11111111111111111111111111111111'),
			{
				kind: 'only',
				rules: [
					{
						selector: '02000000',
						dataLength: 12,
						accountCount: 2,
						accounts: [{ index: 0, key: 'wallet', signer: true, writable: true }],
						args: [{ offset: 4, unsigned: { width: 'u64', is: 'le', value: '100000000' } }]
					}
				]
			}
		]
	])
};
await send(owner, [
	await buildPolicyInstruction(owner, pda, policyDiff(emptyDraft(), draft), owner)
]);
const [policyAddress] = await findPolicyPda({ phygitalToken: pda });
const { data } = await fetchAccessoryPolicy(rpc, policyAddress, { commitment: 'confirmed' });
assert.deepEqual(draftFromPolicy(data), draft);
assert.deepEqual(policyDiff(draftFromPolicy(data), draft), []);
console.log(
	'PASS custom account/data rule, weekly SOL cap and max-per-tap round-trip on local validator'
);
