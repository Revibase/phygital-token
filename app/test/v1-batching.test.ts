import { AccountRole, address, getAddressDecoder, type Instruction } from '@solana/kit';
import { expect, it } from 'vitest';
import { packByV1Size, v1TransactionFits } from '$lib/shared/transaction-v1-size';

const owner = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const payer = address('So11111111111111111111111111111111111111112');
const instruction = (bytes: number): Instruction => ({
	programAddress: address('11111111111111111111111111111111'),
	accounts: [{ address: owner, role: AccountRole.READONLY_SIGNER }],
	data: new Uint8Array(bytes)
});

it('packs more than four items when the full v1 transaction fits', async () => {
	const items = Array.from({ length: 10 }, () => instruction(550));
	const batches = await packByV1Size(items, async (batch) => v1TransactionFits(payer, batch));
	expect(batches[0].length).toBeGreaterThan(4);
	expect(batches.flat()).toEqual(items);
	for (const batch of batches) expect(v1TransactionFits(payer, batch)).toBe(true);
	expect(v1TransactionFits(payer, [...batches[0], batches[1][0]])).toBe(false);
});

it('reserves signatures and refill instructions instead of checking asset data alone', async () => {
	const transfer = instruction(3800);
	expect(v1TransactionFits(payer, [transfer])).toBe(true);
	expect(v1TransactionFits(payer, [transfer, instruction(200)])).toBe(false);
});

it('packs mixed instruction sizes and rejects an individually oversized transfer', async () => {
	const items = [instruction(200), instruction(2700), instruction(900), instruction(400)];
	const batches = await packByV1Size(items, async (batch) => v1TransactionFits(payer, batch));
	expect(batches).toHaveLength(2);
	expect(batches.flat()).toEqual(items);
	await expect(
		packByV1Size([instruction(4096)], async (batch) => v1TransactionFits(payer, batch))
	).rejects.toThrow('exceeds');
});

it('also respects the v1 account limit', () => {
	const accounts = Array.from({ length: 64 }, (_, i) => ({
		address: getAddressDecoder().decode(new Uint8Array(32).fill(i + 1)),
		role: AccountRole.READONLY
	}));
	expect(v1TransactionFits(payer, [{ ...instruction(0), accounts }])).toBe(false);
});
