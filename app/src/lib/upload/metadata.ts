import { uploadFileToArweave, uploadJsonToArweave } from './turbo';

export type MetadataUploadInput = {
	name: string;
	symbol: string;
	imageFile: File;
	description?: string;
};

export type MetadataUploadResult = {
	uri: string;
	imageUrl: string;
	metadataUrl: string;
};

function buildCollectionMetadata(input: {
	name: string;
	symbol: string;
	imageUrl: string;
	description?: string;
}) {
	return {
		name: input.name,
		symbol: input.symbol,
		image: input.imageUrl,
		...(input.description ? { description: input.description } : {})
	};
}

function buildTokenMetadata(input: {
	name: string;
	symbol: string;
	imageUrl: string;
	description?: string;
}) {
	return {
		name: input.name,
		symbol: input.symbol,
		image: input.imageUrl,
		...(input.description ? { description: input.description } : {})
	};
}

async function uploadMetadataBundle(
	input: MetadataUploadInput,
	buildJson: (imageUrl: string) => Record<string, unknown>
): Promise<MetadataUploadResult> {
	const image = await uploadFileToArweave(input.imageFile);
	const metadata = await uploadJsonToArweave(buildJson(image.url));

	return {
		uri: metadata.url,
		imageUrl: image.url,
		metadataUrl: metadata.url
	};
}

export async function uploadCollectionMetadata(
	input: MetadataUploadInput
): Promise<MetadataUploadResult> {
	return uploadMetadataBundle(input, (imageUrl) =>
		buildCollectionMetadata({
			name: input.name,
			symbol: input.symbol,
			imageUrl,
			description: input.description
		})
	);
}

export async function uploadTokenMetadata(
	input: MetadataUploadInput
): Promise<MetadataUploadResult> {
	return uploadMetadataBundle(input, (imageUrl) =>
		buildTokenMetadata({
			name: input.name,
			symbol: input.symbol,
			imageUrl,
			description: input.description
		})
	);
}

export type CardInstanceMetadataInput = {
	secp256r1PubkeyBase58: string;
	credentialId?: string;
	expiry?: number;
};

export async function uploadCardInstanceMetadata(
	input: CardInstanceMetadataInput
): Promise<MetadataUploadResult> {
	const payload: Record<string, unknown> = {
		secp256r1Pubkey: input.secp256r1PubkeyBase58.trim()
	};

	const credentialId = input.credentialId?.trim();
	if (credentialId) {
		payload.credentialId = credentialId;
	}

	if (input.expiry !== undefined && Number.isFinite(input.expiry) && input.expiry > 0) {
		payload.expiry = input.expiry;
	}

	const metadata = await uploadJsonToArweave(payload);

	return {
		uri: metadata.url,
		imageUrl: metadata.url,
		metadataUrl: metadata.url
	};
}
