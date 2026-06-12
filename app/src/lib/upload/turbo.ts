import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { getRpcUrl } from '$lib/rpc';
import { getNetworkFromRpc, getTurboWalletAdapter } from '$lib/wallet';
import { MAX_METADATA_URI_LEN } from 'phygital-nfts-client';
import type { TurboAuthenticatedClient } from '@ardrive/turbo-sdk/web';

export type ArweaveUploadResult = {
	id: string;
	url: string;
};

function getArweaveGateway(): string {
	return (env.PUBLIC_ARWEAVE_GATEWAY ?? 'https://arweave.net').replace(/\/$/, '');
}

function toArweaveUrl(id: string): string {
	return `${getArweaveGateway()}/${id}`;
}

function assertUriLength(url: string): void {
	if (url.length > MAX_METADATA_URI_LEN) {
		throw new Error(
			`Metadata URI is ${url.length} characters (max ${MAX_METADATA_URI_LEN}). Try a shorter Arweave gateway.`
		);
	}
}

async function createTurboClient(): Promise<TurboAuthenticatedClient> {
	if (!browser) {
		throw new Error('Arweave uploads are only available in the browser.');
	}

	const { TurboFactory } = await import('@ardrive/turbo-sdk/web');
	const network = getNetworkFromRpc();
	const walletAdapter = getTurboWalletAdapter();

	if (network === 'mainnet') {
		return TurboFactory.authenticated({
			token: 'solana',
			walletAdapter,
			gatewayUrl: getRpcUrl()
		});
	}

	return TurboFactory.authenticated({
		token: 'solana',
		walletAdapter,
		gatewayUrl: getRpcUrl(),
		paymentServiceConfig: {
			url: 'https://payment.ardrive.dev'
		},
		uploadServiceConfig: {
			url: 'https://upload.ardrive.dev'
		}
	});
}

export async function uploadFileToArweave(file: File): Promise<ArweaveUploadResult> {
	const turbo = await createTurboClient();
	const result = await turbo.uploadFile({
		file,
		dataItemOpts: {
			tags: [{ name: 'Content-Type', value: file.type || 'application/octet-stream' }]
		}
	});

	const url = toArweaveUrl(result.id);
	assertUriLength(url);
	return { id: result.id, url };
}

export async function uploadJsonToArweave(data: unknown): Promise<ArweaveUploadResult> {
	const turbo = await createTurboClient();
	const result = await turbo.upload({
		data: new Blob([JSON.stringify(data)], { type: 'application/json' }),
		dataItemOpts: {
			tags: [{ name: 'Content-Type', value: 'application/json' }]
		}
	});

	const url = toArweaveUrl(result.id);
	assertUriLength(url);
	return { id: result.id, url };
}
