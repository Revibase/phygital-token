<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { decodePermissionRequest, fetchPermissionRequest } from 'phygital-token-sdk';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import Panel from '$lib/components/app/Panel.svelte';
	import Section from '$lib/components/app/Section.svelte';
	import Field from '$lib/components/app/Field.svelte';
	import Disclosure from '$lib/components/app/Disclosure.svelte';
	import Loading from '$lib/components/app/Loading.svelte';
	import WalletConnect from '$lib/components/app/WalletConnect.svelte';
	import OwnerApproval from '$lib/components/app/OwnerApproval.svelte';
	import PolicySheet from '$lib/components/app/PolicySheet.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Select } from '$lib/components/ui/select';
	import { Spinner } from '$lib/components/ui/spinner';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { accessoryPolicyQuery, accessoryWalletQuery, walletAccessoriesQuery } from '$lib/client/queries';
	import { assetInfos, withHoldings } from '$lib/client/asset-info';
	import { programUpgradeability } from '$lib/client/program-upgradeability';
	import { savePolicy } from '$lib/client/accessory-wallet/policy';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { shortAddress } from '$lib/shared/encoding';
	import { draftFromPolicy, policyDiff, validateDraft, SOL } from '$lib/shared/policy-draft';
	import { mergeRequest } from '$lib/shared/policy-merge';
	import { assetInfoOr, explainChange } from '$lib/shared/policy-explain';
	import { ALWAYS_ENFORCED, changeRisks, requestRisks, hasDanger } from '$lib/shared/policy-risk';

	let { data } = $props();
	let failure = $state<FriendlyError | null>(null);
	let selected = $state('');
	let understood = $state(false);
	let busy = $state(false);
	let editing = $state(false);
	let saved = $state(false);

	onMount(() => walletStore.init(data.cluster));

	/** The request comes from the URL: a `#r=` payload, or JSON fetched from `?src=`. */
	const requestQuery = createQuery(() => ({
		queryKey: ['permission-request', page.url.href],
		enabled: browser,
		retry: false,
		staleTime: Infinity,
		queryFn: async () => {
			const url = new URL(page.url.href);
			const src = url.searchParams.get('src');
			if (src && url.hash) throw new Error('Use either a request payload or a source link.');
			if (src) return fetchPermissionRequest(src);
			if (url.hash) return { set: await decodePermissionRequest(url.href), site: null };
			throw new Error('This link has no permission request.');
		}
	}));
	const request = $derived(requestQuery.data?.set ?? null);
	const site = $derived(requestQuery.data?.site ?? null);

	const accessories = createQuery(() => ({ ...walletAccessoriesQuery(walletStore.address ?? ''), enabled: !!walletStore.address }));
	const owned = $derived((accessories.data ?? []).filter((a) => a.owner === walletStore.address));
	$effect(() => {
		if (!owned.some((a) => a.pda === selected)) selected = owned.length === 1 ? owned[0]!.pda : '';
	});
	const accessory = $derived(owned.find((a) => a.pda === selected));
	const policies = createQuery(() => ({ ...accessoryPolicyQuery(selected), enabled: !!accessory }));
	const balances = createQuery(() => ({ ...accessoryWalletQuery(selected), enabled: !!accessory }));
	const policy = $derived(policies.data ?? null);
	const merged = $derived(request ? mergeRequest(draftFromPolicy(policy), request) : null);
	const assets = $derived(request?.limits.map((l) => l.asset) ?? []);
	// Mint details for the request's assets come from chain on their own; held tokens are named from the
	// wallet's holdings once those load. Keying this query on the holdings left it stuck fetching.
	const infos = createQuery(() => ({ queryKey: ['request-asset-infos', assets.join(',')], queryFn: () => assetInfos(assets), enabled: !!request }));
	const assetInfo = $derived(infos.data ? withHoldings(infos.data, balances.data) : undefined);
	const upgrades = createQuery(() => ({ queryKey: ['program-upgradeability', request?.programs.map((p) => p.id).join(',')], queryFn: () => programUpgradeability(request!.programs.map((p) => p.id)), enabled: !!request }));
	const holding = (asset: string) => (asset === SOL ? balances.data?.lamports : balances.data?.tokens.filter((t) => t.mint === asset).reduce((sum, t) => sum + t.amount, 0n));
	const risks = $derived(merged ? [...requestRisks({ site }), ...merged.changes.flatMap((c) => changeRisks(c, { holding, upgradeable: (id) => upgrades.data?.get(id) }))] : []);
	const danger = $derived(hasDanger(risks));
	const problem = $derived(merged ? validateDraft(merged.draft) : null);
	const detailsFailed = $derived(policies.isError || balances.isError || infos.isError || upgrades.isError);
	const ready = $derived(!!accessory && policies.isSuccess && balances.isSuccess && infos.isSuccess && upgrades.isSuccess);
	// Acknowledgement belongs to this exact review, including late-arriving balances and warnings.
	$effect(() => {
		void selected; void walletStore.address; void policies.dataUpdatedAt; void balances.dataUpdatedAt; void upgrades.dataUpdatedAt;
		understood = false;
		saved = false;
	});

	function retryDetails() {
		void policies.refetch();
		void balances.refetch();
		void infos.refetch();
		void upgrades.refetch();
	}
	async function refresh() {
		await Promise.all([policies.refetch(), balances.refetch()]);
		saved = true;
	}
	async function approve() {
		if (!ready || !accessory || !merged || problem || busy || (danger && !understood)) return;
		const changes = policyDiff(draftFromPolicy(policy), merged.draft);
		if (!changes.length) return;
		busy = true;
		failure = null;
		try {
			await savePolicy(walletStore.signingContext(), accessory.pda, changes);
			await refresh();
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Tap permission request · Revibase</title></svelte:head>
<PageShell size="medium">
	<section class="flex flex-1 flex-col gap-5 pt-4 pb-10">
		<PageHeader title="Allow tap transactions?" body="Choose an accessory and review the access this project is requesting." />
		<p class="-mt-2 px-1 text-[13px] leading-snug text-muted-foreground">Authenticating with your accessory doesn’t need this. It only lets the accessory approve transactions from its accessory wallet, within these limits.</p>
		{#if requestQuery.isPending}
			<Loading text="Reading request…" />
		{:else if requestQuery.isError}
			<Notice title="Couldn’t read this request" body={requestQuery.error.message} />
		{:else if request}
			{#if request.name || request.reason || site}
				<Section label="Requested by">
					<Panel element="blockquote" class="space-y-1">
						{#if request.name}<p class="text-[15px] font-medium">{request.name}</p>{/if}
						{#if request.reason}<p class="text-[14px] leading-snug">“{request.reason}”</p>{/if}
						{#if site}<p class="text-[13px] text-muted-foreground">Loaded from {site}. This identifies its source, not whether it is safe.</p>{/if}
					</Panel>
				</Section>
			{/if}
			<Notice error={failure} />
			{#if !walletStore.address}
				<WalletConnect />
			{:else}
				{#if accessories.isPending}
					<Loading text="Loading your accessories…" />
				{:else if accessories.isError}
					<Notice title="Couldn’t load your accessories" onretry={() => void accessories.refetch()} retrying={accessories.isFetching} />
				{:else if !owned.length}
					<Notice tone="info" title="No accessories linked to this wallet" body="Connect the wallet that owns your accessory." />
				{:else}
					<Field label="Accessory">
						<Select label="Accessory" bind:value={selected} disabled={busy} options={owned.map((a) => ({ value: a.pda, label: `${a.tag} · ${shortAddress(a.pda)}` }))} />
					</Field>
				{/if}
				{#if accessory && merged}
					<OwnerApproval {accessory} cluster={data.cluster} {busy} showWallet>
						{#if detailsFailed}
							<Notice title="Couldn’t load permission details" onretry={retryDetails} />
						{:else if !ready}
							<Loading text="Loading current permissions and balances…" />
						{:else if problem}
							<Notice title="These permissions can’t be saved" body={problem} />
						{:else}
							{#if saved}
								<Notice tone="info" title="Tap permissions saved">
									{#snippet actions()}<Button href={`/wallet/${encodeURIComponent(accessory.pda)}`} variant="secondary" class="w-full">Open accessory wallet</Button>{/snippet}
								</Notice>
							{/if}
							{#if balances.data && !balances.data.lamports && !balances.data.tokens.length && !balances.data.nfts?.length}
								<Notice tone="info" title="This accessory wallet is empty" body="Taps can only spend what the wallet holds. Send it funds before using this project." />
							{/if}
							<Section label="Changes">
								{#each merged.changes as change, i (i)}
									{@const line = explainChange(change, (asset) => assetInfoOr(assetInfo, asset))}
									<Panel class="space-y-1">
										<p class="text-[15px] font-medium">{line.title}</p>
										{#if line.reason}<p class="text-[14px] leading-snug">Project’s own words: “{line.reason}”</p>{/if}
										{#if line.details.length}
											<Disclosure label="Details">
												{#each line.details as detail (detail)}<p class="text-[13px] break-all text-muted-foreground">{detail}</p>{/each}
											</Disclosure>
										{/if}
									</Panel>
								{:else}
									<Panel><p class="text-[15px]">You already allow everything this asks for.</p></Panel>
								{/each}
							</Section>
							{#each risks as risk (risk.message)}<Notice tone={risk.level === 'danger' ? 'error' : 'info'} title={risk.level === 'danger' ? 'Review carefully' : 'Before you allow this'} body={risk.message} />{/each}
							<Disclosure label="Protections that always apply">
								{#each ALWAYS_ENFORCED as line (line)}<p class="mt-2 text-[13px] text-muted-foreground">{line}</p>{/each}
							</Disclosure>
							{#if danger && merged.changes.length}
								<label class="flex min-h-11 items-center gap-3 text-[15px]"><Checkbox bind:checked={understood} disabled={busy} />I understand the risk</label>
							{/if}
							<Button size="xl" disabled={busy || !merged.changes.length || (danger && !understood)} onclick={approve}>
								{#if busy}<Spinner /> {walletStore.approvePrompt}{:else}Allow these permissions{/if}
							</Button>
							<Button variant="secondary" size="xl" disabled={busy || (danger && !understood)} onclick={() => (editing = true)}>Edit before allowing</Button>
						{/if}
					</OwnerApproval>
				{:else if !accessory}
					<Button variant="quiet" class="w-full" onclick={() => walletStore.disconnect()}>Use a different wallet</Button>
				{/if}
			{/if}
		{/if}
	</section>
</PageShell>
{#if accessory && merged && ready}<PolicySheet bind:open={editing} {accessory} cluster={data.cluster} {policy} holdings={balances.data} seed={merged.draft} onsaved={() => void refresh()} />{/if}
