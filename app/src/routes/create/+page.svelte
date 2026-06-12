<script lang="ts">
	import { onMount } from 'svelte';
	import { address, type Address } from '@solana/kit';
	import { generateKeyPairSigner } from '@solana/signers';
	import WalletConnect from '$lib/components/WalletConnect.svelte';
	import {
		getCollectionById,
		loadCollections,
		saveCollection,
		type SavedCollection
	} from '$lib/collections';
	import {
		getDesignById,
		getDesignsForCollection,
		loadDesigns,
		saveDesign,
		type SavedDesign
	} from '$lib/designs';
	import { txExplorerUrl } from '$lib/explorer';
	import { shortenAddress } from '$lib/format';
	import {
		submitCreateDesign,
		submitMintToken,
		submitBatchMintTokens,
		type CreateDesignInput,
		type MintTokenInput
	} from '$lib/mint';
	import { pageTitle } from '$lib/page-context';
	import { uploadCardInstanceMetadata, uploadTokenMetadata } from '$lib/upload/metadata';
	import { walletStore } from '$lib/wallet';
	import {
		findDesignMintPda,
		MAX_METADATA_NAME_LEN,
		MAX_METADATA_SYMBOL_LEN,
		validateMetadataFields
	} from 'phygital-nfts-client';

	type FormStatus = 'idle' | 'uploading' | 'submitting' | 'success' | 'error';

	let collectionName = $state('Test Collection');
	let collectionSymbol = $state('TCOL');
	let collectionGroupMintInput = $state('');
	let collectionStatus = $state<FormStatus>('idle');
	let collectionError = $state<string | null>(null);

	let savedCollections = $state<SavedCollection[]>([]);
	let selectedCollectionId = $state('');
	let savedDesigns = $state<SavedDesign[]>([]);
	let selectedDesignId = $state('');

	let designName = $state('Test Design');
	let designSymbol = $state('TDES');
	let designDescription = $state('');
	let designImageFile = $state<File | null>(null);
	let designUniqueIdSigner = $state<Awaited<ReturnType<typeof generateKeyPairSigner>> | null>(
		null
	);
	let designMintPreview = $state<string | null>(null);
	let designStatus = $state<FormStatus>('idle');
	let designError = $state<string | null>(null);
	let designSignature = $state<string | null>(null);
	let designMintAddress = $state<string | null>(null);
	let designMetadataUrl = $state<string | null>(null);

	let mintPubkeyBase58 = $state('bTdjzaWCb6UY9AZqTMMbPSc3VzHeVR9By6ueiqrY2uVZ');
	let mintCredentialId = $state('');
	let mintExpiry = $state('');
	let batchPubkeys = $state('');
	let mintStatus = $state<FormStatus>('idle');
	let mintError = $state<string | null>(null);
	let mintSignature = $state<string | null>(null);
	let mintAddress = $state<string | null>(null);
	let mintResults = $state<Array<{ signature: string; cardInstance: string }>>([]);

	const selectedCollection = $derived(
		selectedCollectionId ? getCollectionById(selectedCollectionId) : null
	);
	const designsForCollection = $derived(
		selectedCollectionId ? getDesignsForCollection(selectedCollectionId) : []
	);
	const selectedDesign = $derived(selectedDesignId ? getDesignById(selectedDesignId) : null);

	onMount(() => {
		pageTitle.set('Create');
		savedCollections = loadCollections();
		savedDesigns = loadDesigns();
		if (savedCollections[0]) {
			selectedCollectionId = savedCollections[0].id;
		}

		void (async () => {
			designUniqueIdSigner = await generateKeyPairSigner();
			await refreshDesignMintPreview();
		})();

		return () => {
			pageTitle.set(null);
		};
	});

	function mapMintError(error: unknown): string {
		if (error instanceof Error) {
			return error.message;
		}
		return 'Something went wrong. Please try again.';
	}

	function handleDesignImageChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		designImageFile = input.files?.[0] ?? null;
	}

	$effect(() => {
		selectedCollectionId;
		const designs = designsForCollection;
		selectedDesignId = designs[0]?.id ?? '';
	});

	async function refreshDesignMintPreview() {
		if (!selectedCollection || !designUniqueIdSigner) {
			designMintPreview = null;
			return;
		}

		try {
			const designMint = await findDesignMintPda(
				address(selectedCollection.groupMint) as Address,
				designUniqueIdSigner.address
			);
			designMintPreview = String(designMint);
		} catch {
			designMintPreview = null;
		}
	}

	$effect(() => {
		selectedCollection?.groupMint;
		designUniqueIdSigner?.address;
		void refreshDesignMintPreview();
	});

	function collectionSubmitLabel(): string {
		return 'Add collection';
	}

	function designSubmitLabel(): string {
		if (designStatus === 'uploading') {
			return 'Uploading to Arweave…';
		}
		if (designStatus === 'submitting') {
			return 'Confirming on Solana…';
		}
		return 'Create design';
	}

	function mintSubmitLabel(): string {
		if (mintStatus === 'uploading') {
			return 'Uploading card metadata…';
		}
		if (mintStatus === 'submitting') {
			return 'Confirming on Solana…';
		}
		return batchPubkeys.trim() ? 'Batch mint cards' : 'Mint card';
	}

	function handleAddCollection(event: SubmitEvent) {
		event.preventDefault();
		collectionError = null;

		try {
			const name = collectionName.trim();
			const symbol = collectionSymbol.trim();
			const groupMint = collectionGroupMintInput.trim();

			if (!groupMint) {
				throw new Error('Enter the Token-2022 collection mint address.');
			}

			validateMetadataFields({
				name,
				symbol,
				uri: 'https://example.com/collection.json'
			});

			const collectionId = crypto.randomUUID();
			savedCollections = saveCollection({
				id: collectionId,
				name,
				symbol,
				groupMint,
				createdAt: Date.now()
			});
			selectedCollectionId = collectionId;
			collectionStatus = 'success';
		} catch (submitError) {
			collectionStatus = 'error';
			collectionError = mapMintError(submitError);
		}
	}

	async function handleCreateDesign(event: SubmitEvent) {
		event.preventDefault();
		designError = null;
		designSignature = null;
		designMintAddress = null;
		designMetadataUrl = null;

		if (!$walletStore.signer) {
			designError = 'Connect your wallet to create a design.';
			return;
		}

		if (!selectedCollection) {
			designError = 'Select a collection first.';
			return;
		}

		if (!designImageFile) {
			designError = 'Choose a design image to upload.';
			return;
		}

		designStatus = 'uploading';

		try {
			if (!designUniqueIdSigner) {
				throw new Error('Design unique ID is not ready yet.');
			}

			const name = designName.trim();
			const symbol = designSymbol.trim();
			const description = designDescription.trim();

			validateMetadataFields({
				name,
				symbol,
				uri: 'https://arweave.net/placeholder'
			});

			const uploaded = await uploadTokenMetadata({
				name,
				symbol,
				imageFile: designImageFile,
				description: description || undefined
			});

			const input: CreateDesignInput = {
				name,
				symbol,
				uri: uploaded.uri,
				groupMint: address(selectedCollection.groupMint) as Address,
				designId: designUniqueIdSigner.address
			};
			validateMetadataFields(input);

			designStatus = 'submitting';
			const result = await submitCreateDesign($walletStore.signer, input);
			designSignature = result.signature;
			designMintAddress = String(result.designMint);
			designMetadataUrl = uploaded.metadataUrl;

			const designId = crypto.randomUUID();
			savedDesigns = saveDesign({
				id: designId,
				collectionId: selectedCollection.id,
				name,
				symbol,
				groupMint: selectedCollection.groupMint,
				designId: String(designUniqueIdSigner.address),
				designMint: designMintAddress,
				metadataUri: uploaded.metadataUrl,
				signature: result.signature,
				createdAt: Date.now()
			});
			selectedDesignId = designId;
			designUniqueIdSigner = await generateKeyPairSigner();

			designStatus = 'success';
		} catch (submitError) {
			designStatus = 'error';
			designError = mapMintError(submitError);
		}
	}

	async function handleMintCard(event: SubmitEvent) {
		event.preventDefault();
		mintError = null;
		mintSignature = null;
		mintAddress = null;
		mintResults = [];

		if (!$walletStore.signer) {
			mintError = 'Connect your wallet to mint a card.';
			return;
		}

		if (!selectedDesign) {
			mintError = 'Select a design to mint into.';
			return;
		}

		mintStatus = 'uploading';

		try {
			const batchLines = batchPubkeys
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean);
			const pubkeys = batchLines.length > 0 ? batchLines : [mintPubkeyBase58.trim()];

			if (pubkeys.some((value) => !value)) {
				throw new Error('Enter at least one secp256r1 pubkey.');
			}

			const credentialId = mintCredentialId.trim() || undefined;
			const expiryRaw = mintExpiry.trim();
			const expiry =
				expiryRaw && Number.isFinite(Number(expiryRaw)) && Number(expiryRaw) > 0
					? Number(expiryRaw)
					: undefined;

			const designMint = address(selectedDesign.designMint) as Address;
			const mintInputs: MintTokenInput[] = [];

			for (const secp256r1PubkeyBase58 of pubkeys) {
				const uploaded = await uploadCardInstanceMetadata({
					secp256r1PubkeyBase58,
					credentialId,
					expiry
				});
				validateMetadataFields({
					name: 'card',
					symbol: 'CARD',
					uri: uploaded.uri
				});
				mintInputs.push({
					designMint,
					secp256r1PubkeyBase58,
					uri: uploaded.uri
				});
			}

			mintStatus = 'submitting';

			if (mintInputs.length === 1) {
				const result = await submitMintToken($walletStore.signer, mintInputs[0]!);
				mintSignature = result.signature;
				mintAddress = String(result.cardInstance);
				mintResults = [{ signature: result.signature, cardInstance: mintAddress }];
			} else {
				const results = await submitBatchMintTokens($walletStore.signer, designMint, mintInputs);
				mintResults = results.map((result) => ({
					signature: result.signature,
					cardInstance: String(result.cardInstance)
				}));
				mintSignature = results[results.length - 1]?.signature ?? null;
				mintAddress = results[results.length - 1]
					? String(results[results.length - 1]!.cardInstance)
					: null;
			}

			mintStatus = 'success';
		} catch (submitError) {
			mintStatus = 'error';
			mintError = mapMintError(submitError);
		}
	}

	async function copyText(value: string) {
		await navigator.clipboard.writeText(value);
	}
</script>

<section class="create-page">
	<header class="page-header">
		<h1>Create</h1>
		<p>Register an external Token-2022 collection, create a design, then mint physical card instances.</p>
	</header>

	<article class="panel">
		<div class="panel-head">
			<h2>Add collection</h2>
			<p>Use an existing Token-2022 group mint as the parent collection for designs.</p>
		</div>

		<form class="form" onsubmit={handleAddCollection}>
			<label>
				<span>Name (max {MAX_METADATA_NAME_LEN})</span>
				<input bind:value={collectionName} maxlength={MAX_METADATA_NAME_LEN} required />
			</label>

			<label>
				<span>Symbol (max {MAX_METADATA_SYMBOL_LEN})</span>
				<input bind:value={collectionSymbol} maxlength={MAX_METADATA_SYMBOL_LEN} required />
			</label>

			<label>
				<span>Collection mint (Token-2022 group mint)</span>
				<input bind:value={collectionGroupMintInput} placeholder="Group mint address" required />
			</label>

			<button type="submit" class="primary">
				{collectionSubmitLabel()}
			</button>

			{#if collectionError}
				<p class="error">{collectionError}</p>
			{/if}

			{#if collectionStatus === 'success'}
				<div class="success">
					<p>Collection saved locally.</p>
				</div>
			{/if}
		</form>
	</article>

	<article class="panel">
		<div class="panel-head">
			<h2>Create design</h2>
			<p>Uploads design metadata once, then creates the shared design mint (SFT).</p>
		</div>

		<form class="form" onsubmit={handleCreateDesign}>
			{#if savedCollections.length === 0}
				<p class="empty">Create a collection first.</p>
			{:else}
				<label>
					<span>Collection</span>
					<select bind:value={selectedCollectionId} required>
						{#each savedCollections as collection (collection.id)}
							<option value={collection.id}>
								{collection.name} ({collection.symbol})
							</option>
						{/each}
					</select>
				</label>
			{/if}

			<label>
				<span>Name (max {MAX_METADATA_NAME_LEN})</span>
				<input bind:value={designName} maxlength={MAX_METADATA_NAME_LEN} required />
			</label>

			<label>
				<span>Symbol (max {MAX_METADATA_SYMBOL_LEN})</span>
				<input bind:value={designSymbol} maxlength={MAX_METADATA_SYMBOL_LEN} required />
			</label>

			<label>
				<span>Description (optional)</span>
				<textarea bind:value={designDescription} rows="3"></textarea>
			</label>

			<label>
				<span>Design image</span>
				<input type="file" accept="image/*" onchange={handleDesignImageChange} required />
			</label>

			{#if designMintPreview}
				<p class="preview">
					Design mint PDA:
					<code>{shortenAddress(designMintPreview, 6)}</code>
				</p>
			{/if}

			<div class="wallet-row">
				<WalletConnect />
			</div>

			<button
				type="submit"
				class="primary"
				disabled={designStatus === 'uploading' ||
					designStatus === 'submitting' ||
					!$walletStore.connected ||
					savedCollections.length === 0}
			>
				{designSubmitLabel()}
			</button>

			{#if designError}
				<p class="error">{designError}</p>
			{/if}

			{#if designStatus === 'success' && designSignature && designMintAddress}
				<div class="success">
					<p>Design created.</p>
					<p>
						Design mint:
						<code>{shortenAddress(designMintAddress, 6)}</code>
					</p>
					{#if designMetadataUrl}
						<p>
							Metadata:
							<a href={designMetadataUrl} target="_blank" rel="noreferrer">View on Arweave</a>
						</p>
					{/if}
				</div>
			{/if}
		</form>
	</article>

	<article class="panel">
		<div class="panel-head">
			<h2>Mint card instance</h2>
			<p>Binds a passkey to the design and mints one token to your wallet.</p>
		</div>

		<form class="form" onsubmit={handleMintCard}>
			{#if designsForCollection.length === 0}
				<p class="empty">Create a design first. Saved designs appear here for minting.</p>
			{:else}
				<label>
					<span>Design</span>
					<select bind:value={selectedDesignId} required>
						{#each designsForCollection as design (design.id)}
							<option value={design.id}>
								{design.name} ({design.symbol}) · {shortenAddress(design.designMint, 4)}
							</option>
						{/each}
					</select>
				</label>
			{/if}

			<label>
				<span>secp256r1 pubkey (base58)</span>
				<input
					bind:value={mintPubkeyBase58}
					placeholder="Base58-encoded 33-byte compressed pubkey"
					required={!batchPubkeys.trim()}
				/>
			</label>

			<label>
				<span>WebAuthn credential ID (optional)</span>
				<input
					bind:value={mintCredentialId}
					placeholder="Stored in card instance metadata for transfers"
				/>
			</label>

			<label>
				<span>Expiry (optional, UTC ms since epoch)</span>
				<input bind:value={mintExpiry} placeholder="e.g. 1735689600000" inputmode="numeric" />
			</label>

			<label>
				<span>Batch pubkeys (optional, one per line)</span>
				<textarea
					bind:value={batchPubkeys}
					rows="4"
					placeholder="Leave empty to mint a single card from the field above"
				></textarea>
			</label>

			<div class="wallet-row">
				<WalletConnect />
			</div>

			<button
				type="submit"
				class="primary"
				disabled={(mintStatus === 'submitting' || mintStatus === 'uploading') ||
					!$walletStore.connected ||
					designsForCollection.length === 0}
			>
				{mintSubmitLabel()}
			</button>

			{#if mintError}
				<p class="error">{mintError}</p>
			{/if}

			{#if mintStatus === 'success' && mintResults.length > 0}
				<div class="success">
					<p>{mintResults.length === 1 ? 'Card minted.' : `${mintResults.length} cards minted.`}</p>
					{#each mintResults as result (result.cardInstance)}
						<p>
							Instance:
							<code>{shortenAddress(result.cardInstance, 6)}</code>
							<a href={`/card/${encodeURIComponent(result.cardInstance)}`}>View</a>
						</p>
					{/each}
					{#if mintSignature}
						<p>
							<a href={txExplorerUrl(mintSignature)} target="_blank" rel="noreferrer">
								View last transaction
							</a>
						</p>
					{/if}
				</div>
			{/if}
		</form>
	</article>
</section>

<style>
	.create-page {
		width: min(100%, 560px);
		display: grid;
		gap: 1.25rem;
	}

	.page-header h1 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
	}

	.page-header p {
		margin: 0;
		color: var(--muted-foreground);
		line-height: 1.5;
	}

	.panel {
		padding: 1.5rem;
		border-radius: calc(var(--radius) + 4px);
		background: var(--card);
		border: 1px solid var(--border);
		box-shadow: 0 1px 2px var(--shadow-color);
	}

	.panel-head h2 {
		margin: 0 0 0.35rem;
		font-size: 1.1rem;
	}

	.panel-head p {
		margin: 0 0 1rem;
		color: var(--muted-foreground);
		font-size: 0.92rem;
		line-height: 1.45;
	}

	.form {
		display: grid;
		gap: 0.9rem;
	}

	label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.9rem;
	}

	label span {
		color: var(--muted-foreground);
	}

	input,
	select,
	textarea {
		width: 100%;
		padding: 0.65rem 0.75rem;
		border-radius: var(--radius);
		border: 1px solid var(--input);
		background: var(--background);
		color: var(--foreground);
		font: inherit;
	}

	textarea {
		resize: vertical;
		min-height: 4.5rem;
	}

	small {
		color: var(--muted-foreground);
		font-size: 0.8rem;
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.preview,
	.empty {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted-foreground);
	}

	.wallet-row {
		display: flex;
		justify-content: flex-start;
	}

	.primary {
		padding: 0.75rem 1rem;
		border: none;
		border-radius: var(--radius);
		background: var(--primary);
		color: var(--primary-foreground);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.primary:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.error {
		margin: 0;
		color: var(--destructive);
		font-size: 0.9rem;
	}

	.success {
		padding: 0.85rem;
		border-radius: var(--radius);
		background: color-mix(in oklch, var(--success) 12%, transparent);
		border: 1px solid color-mix(in oklch, var(--success) 35%, transparent);
	}

	.success p {
		margin: 0.35rem 0 0;
		font-size: 0.9rem;
	}

	.success p:first-child {
		margin-top: 0;
		font-weight: 600;
		color: var(--success);
	}

	.success a {
		color: inherit;
		margin-right: 0.75rem;
	}

	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.85rem;
	}

	.linkish {
		margin-left: 0.5rem;
		padding: 0;
		border: none;
		background: none;
		color: var(--info);
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
	}

	@media (max-width: 520px) {
		.row {
			grid-template-columns: 1fr;
		}
	}
</style>
