import { address, getAddressDecoder, getBase64Encoder } from '@solana/kit';
import { browserRpc } from './rpc';

const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
/** Unknown is retained when a lookup fails; only loader-owned ProgramData is trusted. */
export async function programUpgradeability(
	ids: string[]
): Promise<Map<string, boolean | undefined>> {
	const result = new Map<string, boolean | undefined>(ids.map((id) => [id, undefined]));
	try {
		// Only the loader's 36-byte program header is needed; older loaders keep the whole ELF in the account.
		const { value } = await browserRpc()
			.getMultipleAccounts(
				ids.map((id) => address(id)),
				{ encoding: 'base64', dataSlice: { offset: 0, length: 36 } }
			)
			.send();
		const pending: { id: string; data: string }[] = [];
		value.forEach((account, i) => {
			if (!account || !account.executable) return;
			if (account.owner !== LOADER) return;
			const bytes = new Uint8Array(getBase64Encoder().encode(account.data[0]));
			if (bytes.length !== 36 || new DataView(bytes.buffer).getUint32(0, true) !== 2) return;
			pending.push({ id: ids[i]!, data: getAddressDecoder().decode(bytes.slice(4, 36)) });
		});
		if (pending.length) {
			const accounts = await browserRpc()
				.getMultipleAccounts(
					pending.map((p) => address(p.data)),
					{ encoding: 'base64', dataSlice: { offset: 0, length: 45 } }
				)
				.send();
			accounts.value.forEach((account, i) => {
				if (!account || account.owner !== LOADER) return;
				const bytes = new Uint8Array(getBase64Encoder().encode(account.data[0]));
				if (bytes.length < 13 || new DataView(bytes.buffer).getUint32(0, true) !== 3) return;
				if (bytes[12] === 0) result.set(pending[i]!.id, false);
				else if (bytes[12] === 1 && bytes.length >= 45) result.set(pending[i]!.id, true);
			});
		}
	} catch {
		/* Unknown is displayed as a caution by the review. */
	}
	return result;
}
