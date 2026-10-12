/** Local-only NFT CPI integration. NFT_PROGRAM_FIXTURES points to hash-pinned Metaplex programs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AccountRole, address, appendTransactionMessageInstructions, createTransactionMessage, generateKeyPairSigner, getProgramDerivedAddress, getAddressDecoder, getAddressEncoder, getBase64Decoder, lamports, pipe, setTransactionMessageConfig, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, type Address, type Blockhash, type Instruction, type KeyPairSigner } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { findTokenRecordPda, getTokenRecordSize, getCreateV1InstructionAsync as createPnft, getMintV1InstructionAsync as mintPnft, TokenStandard } from '@metaplex-foundation/mpl-token-metadata-kit';
import { getCreateV1Instruction as createCore, getCreateCollectionV1Instruction, getAssetV1Decoder, DataState } from '@macalinao/clients-mpl-core';
import { findAssetIdPda, getCreateTreeInstructionAsync, getMetadataArgsEncoder, getMintV1InstructionAsync as mintCnft, TokenStandard as BgTokenStandard, TokenProgramVersion } from '@macalinao/clients-mpl-bubblegum';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { LiteSVM } from 'litesvm';
import { findWalletPda, getPhygitalTokenEncoder, PHYGITAL_TOKEN_PROGRAM_ADDRESS } from 'phygital-token-sdk';
import { programmableRecordRent } from '../src/lib/shared/nft-transfers';
import { buildSendInstructions, type SendAsset } from '../src/lib/shared/wallet-instructions';

const fixtureDir = process.env.NFT_PROGRAM_FIXTURES;
assert(fixtureDir, 'Set NFT_PROGRAM_FIXTURES to a directory with pinned Metaplex binaries and manifest.json.');
const manifest = JSON.parse(readFileSync(resolve(fixtureDir, 'manifest.json'), 'utf8')) as { programs: { id: string; file: string; sha256: string; group: string }[] };
const svm = new LiteSVM().withPrecompiles();
for (const p of manifest.programs.filter(p => p.group === 'metaplex')) {
	const file = resolve(fixtureDir, p.file);
	assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), p.sha256);
	svm.addProgramFromFile(address(p.id), file);
}
svm.addProgramFromFile(PHYGITAL_TOKEN_PROGRAM_ADDRESS, resolve('../target/deploy/phygital_token.so'));
const owner = await generateKeyPairSigner(), receiver = await generateKeyPairSigner(), token = await generateKeyPairSigner();
const [wallet, bump] = await findWalletPda({ phygitalToken: token.address });
svm.airdrop(owner.address, lamports(10_000_000_000n)); svm.airdrop(wallet, lamports(1_000_000_000n));
const data = new Uint8Array(getPhygitalTokenEncoder().encode({ owner: owner.address, mint: address('11111111111111111111111111111111'), lastSignCount: 0, tokenType: 2, walletBump: bump, publicKey: [new Uint8Array(33)], identifier: [new Uint8Array(33)] }));
svm.setAccount({ address: token.address, programAddress: PHYGITAL_TOKEN_PROGRAM_ADDRESS, data, executable: false, lamports: svm.minimumBalanceForRentExemption(BigInt(data.length)), space: BigInt(data.length) });
const rpc = {
	getAccountInfo: (key: Address) => ({ send: async () => { const a = svm.getAccount(key); return { value: a.exists ? { owner: a.programAddress, data: [getBase64Decoder().decode(a.data), 'base64'], executable: a.executable } : null }; } }),
	getMinimumBalanceForRentExemption: (bytes: bigint) => ({ send: async () => svm.minimumBalanceForRentExemption(bytes) })
};
async function execute(instructions: Instruction[], payer: KeyPairSigner = owner) {
	const signed = await signTransactionMessageWithSigners(pipe(createTransactionMessage({ version: 1 }), m => setTransactionMessageFeePayerSigner(payer, m), m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: svm.latestBlockhash() as Blockhash, lastValidBlockHeight: 999999n }, m), m => setTransactionMessageConfig({ computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 64 * 1024 * 1024 }, m), m => appendTransactionMessageInstructions(instructions, m)));
	const result = svm.sendTransaction(signed);
	if ('err' in result) throw new Error(result.meta().logs().join('\n'));
	svm.expireBlockhash();
}
async function send(asset: SendAsset, extra: { dasUrl?: string; openAccount?: boolean } = {}) {
	await execute(await buildSendInstructions({ owner, pda: token.address, recipient: receiver.address, asset, amount: 1n, rpc: rpc as never, ...extra }));
}
const AUTH_RULES = address('auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg');
async function createRules(name: string, operation: string) {
	const str = (value: string) => { const bytes = [...new TextEncoder().encode(value)]; return [0xa0 | bytes.length, ...bytes]; };
	const ownerBytes = [...getAddressEncoder().encode(owner.address)];
	const rules = [0x94, 1, 0xdc, 0, 32, ...ownerBytes.flatMap(b => b < 128 ? [b] : [0xcc, b]), ...str(name), 0x81, ...str(operation), ...str('Pass')];
	const [ruleSet] = await getProgramDerivedAddress({ programAddress: AUTH_RULES, seeds: ['rule_set', getAddressEncoder().encode(owner.address), name] });
	await execute([{ programAddress: AUTH_RULES, accounts: [{ address: owner.address, role: AccountRole.WRITABLE_SIGNER, signer: owner }, { address: ruleSet, role: AccountRole.WRITABLE }, { address: address('11111111111111111111111111111111'), role: AccountRole.READONLY }, { address: AUTH_RULES, role: AccountRole.READONLY }], data: Uint8Array.from([0, 0, rules.length & 255, rules.length >> 8, 0, 0, ...rules]) }]);
	return ruleSet;
}

const mint = await generateKeyPairSigner();
const allowRules = await createRules('allow-transfer', 'Transfer:Owner');
await execute([await createPnft({ mint, authority: owner, payer: owner, updateAuthority: owner.address, splTokenProgram: TOKEN_PROGRAM_ADDRESS, name: 'Local pNFT', uri: 'https://example.test/nft.json', sellerFeeBasisPoints: 0, tokenStandard: TokenStandard.ProgrammableNonFungible, ruleSet: allowRules }), await mintPnft({ mint: mint.address, tokenOwner: wallet, authority: owner, payer: owner, splTokenProgram: TOKEN_PROGRAM_ADDRESS, amount: 1n, tokenStandard: TokenStandard.ProgrammableNonFungible, authorizationRules: allowRules, authorizationRulesProgram: AUTH_RULES })]);
const [source] = await findAssociatedTokenPda({ mint: mint.address, owner: wallet, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const sourceHolding = { tokenAccount: source, mint: mint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS, amount: 1n, decimals: 0, frozen: true, name: 'Local pNFT', symbol: null, icon: null, tokenStandard: 'ProgrammableNonFungible' };
assert.equal(await programmableRecordRent(rpc as never, sourceHolding, receiver.address), svm.minimumBalanceForRentExemption(BigInt(getTokenRecordSize())));
await send({ kind: 'token', token: { tokenAccount: source, mint: mint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS, amount: 1n, decimals: 0, frozen: true, name: 'Local pNFT', symbol: null, icon: null, tokenStandard: 'ProgrammableNonFungible' } }, { openAccount: true });
const [dest] = await findAssociatedTokenPda({ mint: mint.address, owner: receiver.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
assert.equal(new DataView(svm.getAccount(dest).data.buffer).getBigUint64(64, true), 1n);
assert.equal(await programmableRecordRent(rpc as never, sourceHolding, receiver.address), 0n);
assert(svm.getAccount((await findTokenRecordPda({ mint: mint.address, token: dest }))[0]).exists);
console.log('PASS pNFT: frozen source transfers through owner CPI; recipient token record created');

const deniedRules = await createRules('deny-transfer', 'Delegate:Transfer');
const deniedMint = await generateKeyPairSigner();
await execute([await createPnft({ mint: deniedMint, authority: owner, payer: owner, updateAuthority: owner.address, splTokenProgram: TOKEN_PROGRAM_ADDRESS, name: 'Restricted pNFT', uri: 'https://example.test/restricted.json', sellerFeeBasisPoints: 0, tokenStandard: TokenStandard.ProgrammableNonFungible, ruleSet: deniedRules }), await mintPnft({ mint: deniedMint.address, tokenOwner: wallet, authority: owner, payer: owner, splTokenProgram: TOKEN_PROGRAM_ADDRESS, amount: 1n, tokenStandard: TokenStandard.ProgrammableNonFungible, authorizationRules: deniedRules, authorizationRulesProgram: AUTH_RULES })]);
const [deniedSource] = await findAssociatedTokenPda({ mint: deniedMint.address, owner: wallet, tokenProgram: TOKEN_PROGRAM_ADDRESS });
await assert.rejects(send({ kind: 'token', token: { tokenAccount: deniedSource, mint: deniedMint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS, amount: 1n, decimals: 0, frozen: true, name: 'Restricted pNFT', symbol: null, icon: null, tokenStandard: 'ProgrammableNonFungible' } }, { openAccount: true }), /auth9Sig.*failed/);
assert.equal(new DataView(svm.getAccount(deniedSource).data.buffer).getBigUint64(64, true), 1n);
console.log('PASS pNFT restrictions: rejected rule-set transfer leaves source NFT unchanged');

const collection = await generateKeyPairSigner(), core = await generateKeyPairSigner();
await execute([getCreateCollectionV1Instruction({ collection, updateAuthority: owner.address, payer: owner, createCollectionV1Args: { name: 'Local collection', uri: 'https://example.test/c.json', plugins: null } }), createCore({ asset: core, collection: collection.address, authority: owner, payer: owner, owner: wallet, createV1Args: { dataState: DataState.AccountState, name: 'Local Core', uri: 'https://example.test/core.json', plugins: null } })]);
await send({ kind: 'nft', nft: { id: core.address, kind: 'core', name: 'Local Core', icon: null, frozen: false } });
assert.equal(getAssetV1Decoder().decode(svm.getAccount(core.address).data).owner, receiver.address);
await assert.rejects(send({ kind: 'nft', nft: { id: core.address, kind: 'core', name: null, icon: null, frozen: false } }), /no longer owned/);
console.log('PASS Core: collection read from chain; recipient becomes owner');

const tree = await generateKeyPairSigner(), compressionProgram = address('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK');
const depth = 3, buffer = 8, change = 32 * (depth + 1) + 8, treeBytes = 56 + 24 + (buffer + 1) * change;
await execute([getCreateAccountInstruction({ payer: owner, newAccount: tree, lamports: svm.minimumBalanceForRentExemption(BigInt(treeBytes)), space: treeBytes, programAddress: compressionProgram }), await getCreateTreeInstructionAsync({ merkleTree: tree.address, payer: owner, treeCreator: owner, maxDepth: depth, maxBufferSize: buffer, public: false })]);
const metadata = { name: 'Local cNFT', symbol: 'NFT', uri: 'https://example.test/cnft.json', sellerFeeBasisPoints: 0, primarySaleHappened: false, isMutable: true, editionNonce: null, tokenStandard: BgTokenStandard.NonFungible, collection: null, uses: null, tokenProgramVersion: TokenProgramVersion.Original, creators: [] };
await execute([await mintCnft({ merkleTree: tree.address, leafOwner: wallet, leafDelegate: wallet, payer: owner, treeDelegate: owner, message: metadata })]);
const b58 = getAddressDecoder(), enc = getAddressEncoder();
const cat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap(p => [...p]));
const dataHash = keccak_256(cat(keccak_256(new Uint8Array(getMetadataArgsEncoder().encode(metadata))), new Uint8Array(2))), creatorHash = keccak_256(new Uint8Array());
const [id] = await findAssetIdPda({ merkleTree: tree.address, nonce: 0n });
const zeros = [new Uint8Array(32)]; for (let i = 1; i < depth; i++) zeros.push(keccak_256(cat(zeros[i-1], zeros[i-1])));
function root() { const a = svm.getAccount(tree.address).data; const active = Number(new DataView(a.buffer, a.byteOffset).getBigUint64(64, true)); return a.slice(80 + active * change, 112 + active * change); }
const before = root();
const originalFetch = globalThis.fetch;
let invalidProof = true;
globalThis.fetch = async (_url, init) => { const req = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ result: req.method === 'getAsset' ? { id, ownership: { owner: wallet }, compression: { compressed: true, tree: tree.address, leaf_id: 0, data_hash: b58.decode(dataHash), creator_hash: b58.decode(creatorHash) } } : { tree_id: tree.address, root: b58.decode(root()), proof: zeros.map((z, i) => invalidProof && i === 0 ? receiver.address : b58.decode(z)) } })); };
try {
	await assert.rejects(send({ kind: 'nft', nft: { id, kind: 'compressed', name: 'Local cNFT', icon: null, frozen: false } }, { dasUrl: 'https://local.test/das' }), /failed/);
	assert.deepEqual(root(), before);
	invalidProof = false;
	await send({ kind: 'nft', nft: { id, kind: 'compressed', name: 'Local cNFT', icon: null, frozen: false } }, { dasUrl: 'https://local.test/das' }); } finally { globalThis.fetch = originalFetch; }
const expectedLeaf = keccak_256(cat(Uint8Array.of(1), new Uint8Array(enc.encode(id)), new Uint8Array(enc.encode(receiver.address)), new Uint8Array(enc.encode(receiver.address)), new Uint8Array(8), dataHash, creatorHash));
const expectedRoot = zeros.reduce((node, sibling) => keccak_256(cat(node, sibling)), expectedLeaf);
assert.notDeepEqual(root(), before); assert.deepEqual(root(), expectedRoot);
console.log('PASS invalid compressed proof: rejected without changing the Merkle root');
console.log('PASS compressed NFT: fresh DAS proof transfers through owner CPI; Merkle root matches recipient leaf');
