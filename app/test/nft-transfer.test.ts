import { address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { externalNftHolding, fetchOwnerAssets } from '$lib/shared/nft-assets';
import { proofWithoutCanopy } from '$lib/shared/nft-transfers';
const OWNER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const ID = address('So11111111111111111111111111111111111111112');
function tree(depth: number, buffer: number, canopy: number) {
	const data = new Uint8Array(56 + 24 + (buffer + 1) * (32 * (depth + 1) + 8) + (2 ** (canopy + 1) - 2) * 32);
	data[0] = 1;
	const view = new DataView(data.buffer);
	view.setUint32(2, buffer, true); view.setUint32(6, depth, true);
	return data;
}
describe('NFT discovery and proofs', () => {
	it('only discovers live external NFT assets owned by the accessory', () => {
		const asset = { id: ID, interface: 'MplCoreAsset', ownership: { owner: OWNER } };
		expect(externalNftHolding(asset, OWNER)?.kind).toBe('core');
		expect(externalNftHolding({ ...asset, ownership: { owner: ID } }, OWNER)).toBeNull();
		expect(externalNftHolding({ ...asset, burnt: true }, OWNER)).toBeNull();
		expect(externalNftHolding({ ...asset, interface: 'FungibleToken' }, OWNER)).toBeNull();
		expect(externalNftHolding({ ...asset, compression: { compressed: true, flags: 8 } }, OWNER)).toMatchObject({ kind: 'compressed', frozen: true });
	});
	it('deduplicates paginated NFTs', async () => {
		const asset = { id: ID, interface: 'MplCoreAsset', ownership: { owner: OWNER } };
		const mocked = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ result: { items: Array.from({ length: 200 }, () => asset), total: 201 } }))).mockResolvedValueOnce(new Response(JSON.stringify({ result: { items: [asset], total: 201 } })));
		try { const inventory = await fetchOwnerAssets('https://example.test/rpc', OWNER); expect(inventory).toMatchObject({ assets: [{ id: ID }], status: 'complete' }); expect(externalNftHolding(inventory.assets[0]!, OWNER)).toMatchObject({ id: ID }); expect(mocked).toHaveBeenCalledTimes(2); } finally { mocked.mockRestore(); }
	});
	it('trims full proofs to the on-chain canopy without over-trimming already shortened proofs', () => {
		expect(proofWithoutCanopy(tree(3, 8, 0), ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
		expect(proofWithoutCanopy(tree(3, 8, 2), ['a', 'b', 'c'])).toEqual(['a']);
		expect(proofWithoutCanopy(tree(3, 8, 2), ['a'])).toEqual(['a']);
		expect(proofWithoutCanopy(tree(3, 8, 2).slice(0, 56), ['a', 'b', 'c'], tree(3, 8, 2).length)).toEqual(['a']);
		expect(proofWithoutCanopy(tree(3, 8, 3), ['a', 'b', 'c'])).toEqual([]);
		expect(() => proofWithoutCanopy(tree(3, 8, 0), ['a'])).toThrow(/Incomplete/);
		expect(() => proofWithoutCanopy(new Uint8Array(10), [])).toThrow(/header/);
	});
});

describe('compressed transfer validation', () => {
	it('uses Bubblegum V2 for MPL compression, preserving flags, hashes and collection', async () => {
		const { findAssetIdPda, getTransferV2InstructionDataDecoder } = await import('@macalinao/clients-mpl-bubblegum');
		const { getBase64Decoder, AccountRole } = await import('@solana/kit');
		const { buildCompressedTransfer } = await import('$lib/shared/nft-transfers');
		const [id] = await findAssetIdPda({ merkleTree: ID, nonce: 0n });
		const data = tree(3, 8, 2);
		const rpc = { getAccountInfo: () => ({ send: async () => ({ value: { owner: 'mcmt6YrQEMKw8Mw43FmpRLmf7BqRnFMKmAcbxE3xkAW', executable: false, data: [getBase64Decoder().decode(data), 'base64'] } }) }) };
		const asset = { id, ownership: { owner: String(OWNER) }, compression: { compressed: true, tree: ID, leaf_id: 0, data_hash: ID, creator_hash: OWNER, asset_data_hash: ID, flags: 0 }, grouping: [{ group_key: 'collection', group_value: OWNER }] };
		const mocked = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => new Response(JSON.stringify({ result: JSON.parse(String(init?.body)).method === 'getAsset' ? asset : { tree_id: ID, root: ID, node_index: 9, proof: [ID, OWNER, ID] } })));
		try {
			const [ix] = await buildCompressedTransfer(rpc as never, 'https://example.test/rpc', OWNER, { id, kind: 'compressed', name: null, icon: null, frozen: false }, ID);
			const decoded = getTransferV2InstructionDataDecoder().decode(ix.data!);
			expect(decoded.index).toBe(1); // leaf position is separate from the asset nonce
			expect(decoded.nonce).toBe(0n);
			expect(decoded.flags).toEqual({ __option: 'Some', value: 0 });
			expect(decoded.assetDataHash.__option).toBe('Some');
			expect(ix.accounts?.[2]).toMatchObject({ address: OWNER, role: AccountRole.READONLY_SIGNER });
			expect(ix.accounts?.[7].address).toBe(OWNER);
			expect(ix.accounts).toHaveLength(12); // 11 fixed accounts + 1 proof node after canopy truncation
			asset.ownership.owner = ID;
			await expect(buildCompressedTransfer(rpc as never, 'https://example.test/rpc', OWNER, { id, kind: 'compressed', name: null, icon: null, frozen: false }, ID)).rejects.toThrow(/no longer owned/);
		} finally { mocked.mockRestore(); }
	});
});
