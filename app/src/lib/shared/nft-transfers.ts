import { AccountRole, address, createNoopSigner, getAddressEncoder, getBase64Encoder, isSome, type Address, type Instruction, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token';
import { findMasterEditionPda, findMetadataPda, findTokenRecordPda, getMetadataDecoder, getTokenRecordSize, getTransferV1Instruction, Key as MetadataKey, MPL_TOKEN_METADATA_PROGRAM_ADDRESS, TokenStandard } from '@metaplex-foundation/mpl-token-metadata-kit';
import { getAssetV1Decoder, getTransferV1Instruction as coreTransfer, Key as CoreKey, MPL_CORE_PROGRAM_PROGRAM_ADDRESS } from '@macalinao/clients-mpl-core';
import { findAssetIdPda, getTransferInstructionAsync, getTransferV2InstructionAsync } from '@macalinao/clients-mpl-bubblegum';
import { dasRequest, type AssetProof, type DasNftAsset, type NftHolding } from './nft-assets';
import type { TokenHolding } from './wallet-holdings';

const AUTH_RULES = address('auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg');
const SPL_COMPRESSION = address('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK');
const MPL_COMPRESSION = address('mcmt6YrQEMKw8Mw43FmpRLmf7BqRnFMKmAcbxE3xkAW');
type RpcClient = Rpc<SolanaRpcApi>;

async function accountData(rpc: RpcClient, key: Address, program: Address): Promise<Uint8Array> {
	const { value } = await rpc.getAccountInfo(key, { encoding: 'base64', commitment: 'confirmed' }).send();
	if (!value || value.owner !== program || value.executable) throw new Error('NFT account is missing or belongs to an unexpected program.');
	return new Uint8Array(getBase64Encoder().encode(value.data[0]));
}

export async function buildProgrammableTransfer(rpc: RpcClient, wallet: Address, token: TokenHolding, recipient: Address, openAccount: boolean): Promise<Instruction[]> {
	const [[metadata], [edition], [destination]] = await Promise.all([findMetadataPda({ mint: token.mint }), findMasterEditionPda({ mint: token.mint }), findAssociatedTokenPda({ owner: recipient, mint: token.mint, tokenProgram: token.tokenProgram })]);
	const decoded = getMetadataDecoder().decode(await accountData(rpc, metadata, MPL_TOKEN_METADATA_PROGRAM_ADDRESS));
	if (decoded.key !== MetadataKey.MetadataV1 || decoded.mint !== token.mint || !isSome(decoded.tokenStandard) || ![TokenStandard.ProgrammableNonFungible, TokenStandard.ProgrammableNonFungibleEdition].includes(decoded.tokenStandard.value)) throw new Error('This mint is not a programmable NFT.');
	const [[sourceRecord], [destinationRecord]] = await Promise.all([findTokenRecordPda({ mint: token.mint, token: token.tokenAccount }), findTokenRecordPda({ mint: token.mint, token: destination })]);
	const config = decoded.programmableConfig;
	const rules = isSome(config) && config.value.__kind === 'V1' && isSome(config.value.ruleSet) ? config.value.ruleSet.value : undefined;
	const payer = createNoopSigner(wallet);
	const instructions: Instruction[] = openAccount ? [getCreateAssociatedTokenIdempotentInstruction({ payer, ata: destination, owner: recipient, mint: token.mint, tokenProgram: token.tokenProgram })] : [];
	instructions.push(getTransferV1Instruction({ mint: token.mint, tokenOwner: wallet, destinationOwner: recipient, token: token.tokenAccount, destinationToken: destination, metadata, edition, tokenRecord: sourceRecord, destinationTokenRecord: destinationRecord, authority: payer, payer, splTokenProgram: token.tokenProgram, tokenStandard: decoded.tokenStandard.value, amount: 1n, authorizationRulesProgram: rules ? AUTH_RULES : undefined, authorizationRules: rules }));
	return instructions;
}

export async function programmableRecordRent(rpc: RpcClient, token: TokenHolding, recipient: Address): Promise<bigint> {
	const [destination] = await findAssociatedTokenPda({ owner: recipient, mint: token.mint, tokenProgram: token.tokenProgram });
	const [record] = await findTokenRecordPda({ mint: token.mint, token: destination });
	const { value } = await rpc.getAccountInfo(record, { encoding: 'base64', commitment: 'confirmed' }).send();
	return value ? 0n : BigInt(await rpc.getMinimumBalanceForRentExemption(BigInt(getTokenRecordSize())).send());
}

/** Core collection membership comes from the chain, not a potentially stale index. */
export async function buildCoreTransfer(rpc: RpcClient, wallet: Address, nft: NftHolding, recipient: Address): Promise<Instruction[]> {
	const asset = getAssetV1Decoder().decode(await accountData(rpc, nft.id, MPL_CORE_PROGRAM_PROGRAM_ADDRESS));
	if (asset.key !== CoreKey.AssetV1 || asset.owner !== wallet) throw new Error('This NFT is no longer owned by the accessory wallet.');
	return [coreTransfer({ asset: nft.id, collection: asset.updateAuthority.__kind === 'Collection' ? asset.updateAuthority.fields[0] : undefined, authority: createNoopSigner(wallet), payer: createNoopSigner(wallet), newOwner: recipient, transferV1Args: { compressionProof: null } })];
}

/** SPL and MPL compression use the same V1 concurrent tree header. */
export function proofWithoutCanopy(data: Uint8Array, proof: readonly string[], accountSpace = data.length): string[] {
	if (data.length < 56 || data[0] !== 1 || data[1] !== 0) throw new Error('Unsupported compressed NFT tree header.');
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const buffer = view.getUint32(2, true), depth = view.getUint32(6, true);
	if (depth < 1 || depth > 32 || buffer < 1 || buffer > 2048) throw new Error('Invalid compressed NFT tree dimensions.');
	const canopyBytes = accountSpace - (56 + 24 + (buffer + 1) * (32 * (depth + 1) + 8));
	const canopyDepth = Math.log2(canopyBytes / 32 + 2) - 1;
	if (canopyBytes < 0 || canopyBytes % 32 || !Number.isInteger(canopyDepth) || canopyDepth > depth) throw new Error('Invalid compressed NFT canopy.');
	const required = depth - canopyDepth;
	if (proof.length !== depth && proof.length !== required) throw new Error('Incomplete compressed NFT proof.');
	return proof.slice(0, required);
}

/** Refresh the leaf and proof for every build; the on-chain simulation verifies proof and asset rules. */
export async function buildCompressedTransfer(rpc: RpcClient, dasUrl: string, wallet: Address, nft: NftHolding, recipient: Address): Promise<Instruction[]> {
	const [asset, proof] = await Promise.all([dasRequest<DasNftAsset>(dasUrl, 'getAsset', { id: nft.id, displayOptions: { showUnverifiedCollections: true } }), dasRequest<AssetProof>(dasUrl, 'getAssetProof', { id: nft.id })]);
	const compression = asset.compression;
	if (asset.id !== nft.id || asset.ownership?.owner !== wallet || asset.burnt || !compression?.compressed) throw new Error('This compressed NFT is no longer owned by the accessory wallet.');
	if (asset.ownership.frozen || ((compression.flags ?? 0) & 11)) throw new Error('This compressed NFT is frozen or non-transferable.');
	const index = compression.leaf_id;
	if (!Number.isSafeInteger(index) || index! < 0 || index! > 0xffffffff || !proof.tree_id || proof.tree_id !== compression.tree || !Array.isArray(proof.proof)) throw new Error('Invalid compressed NFT proof data.');
	const tree = address(proof.tree_id);
	if ((await findAssetIdPda({ merkleTree: tree, nonce: index! }))[0] !== nft.id) throw new Error('Compressed NFT proof does not match this asset.');
	let { value } = await rpc.getAccountInfo(tree, { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 56 } }).send();
	if (value && value.space === undefined) ({ value } = await rpc.getAccountInfo(tree, { encoding: 'base64', commitment: 'confirmed' }).send());
	if (!value || value.executable || (value.owner !== SPL_COMPRESSION && value.owner !== MPL_COMPRESSION)) throw new Error('Invalid compressed NFT tree program.');
	const treeData = new Uint8Array(getBase64Encoder().encode(value.data[0]));
	const space = Number(value.space ?? treeData.length);
	if (!Number.isSafeInteger(space)) throw new Error('Invalid compressed NFT tree size.');
	const path = proofWithoutCanopy(treeData, proof.proof, space);
	const depth = new DataView(treeData.buffer, treeData.byteOffset).getUint32(6, true);
	const leafIndex = proof.node_index === undefined ? index! : proof.node_index - 2 ** depth;
	if (!Number.isSafeInteger(leafIndex) || leafIndex < 0 || leafIndex >= 2 ** depth) throw new Error('Invalid compressed NFT leaf position.');
	if (compression.flags !== undefined && (!Number.isInteger(compression.flags) || compression.flags < 0 || compression.flags > 255)) throw new Error('Invalid compressed NFT flags.');
	const hash = (value: string | undefined) => { if (!value) throw new Error('Compressed NFT hash is missing.'); return Array.from(getAddressEncoder().encode(address(value))); };
	const common = { leafOwner: wallet, leafDelegate: address(asset.ownership.delegate ?? wallet), newLeafOwner: recipient, merkleTree: tree, root: hash(proof.root), dataHash: hash(compression.data_hash), creatorHash: hash(compression.creator_hash), nonce: BigInt(index!), index: leafIndex };
	const signer = createNoopSigner(wallet);
	const v2 = value.owner === MPL_COMPRESSION;
	const base = v2 ? await getTransferV2InstructionAsync({ ...common, authority: signer, payer: signer, coreCollection: asset.grouping?.find(g => g.group_key === 'collection')?.group_value ? address(asset.grouping.find(g => g.group_key === 'collection')!.group_value!) : undefined, assetDataHash: compression.asset_data_hash ? hash(compression.asset_data_hash) : null, flags: compression.flags ?? null }) : await getTransferInstructionAsync(common);
	return [{ ...base, accounts: [...base.accounts.map((meta, i) => !v2 && i === 1 ? { ...meta, role: AccountRole.READONLY_SIGNER, signer } : meta), ...path.map(node => ({ address: address(node), role: AccountRole.READONLY }))] }];
}
