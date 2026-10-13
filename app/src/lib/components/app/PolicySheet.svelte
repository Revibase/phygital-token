<script lang="ts">
	import { address, type Address } from '@solana/kit';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		parsePermissionSet,
		type AccessoryPolicy,
		type PolicyActionArgs
	} from 'phygital-token-sdk';
	import { untrack, tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import Notice from './Notice.svelte';
	import OwnerApproval from './OwnerApproval.svelte';
	import SpendLimitsEditor from './SpendLimitsEditor.svelte';
	import AllowedSitesEditor from './AllowedSitesEditor.svelte';
	import ProgramsEditor from './ProgramsEditor.svelte';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import Panel from './Panel.svelte';
	import Section from './Section.svelte';
	import FieldError from './FieldError.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Textarea } from '$lib/components/ui/textarea';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import { Spinner } from '$lib/components/ui/spinner';
	import { walletStore, type Cluster } from '$lib/client/wallet/wallet.svelte';
	import { savePolicy } from '$lib/client/accessory-wallet/policy';
	import { assetInfos } from '$lib/client/asset-info';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import {
		cloneDraft,
		isTapPaymentsDraft,
		draftFromPolicy,
		draftFromSet,
		draftToSet,
		policyDiff,
		programSaveDraft,
		SOL,
		tapPaymentsPreset,
		validateDraft,
		type CapDraft,
		type PolicyDraft,
		type ProgramDraft
	} from '$lib/shared/policy-draft';
	import { assetInfoOr, describeReplacement, SOL_INFO } from '$lib/shared/policy-explain';
	import type { TokenInfo } from '$lib/shared/action-presentation';
	import { isCollectible, type WalletHoldings } from '$lib/shared/wallet-holdings';
	import type { AccessoryView } from '$lib/shared/types';

	let {
		open = $bindable(false),
		accessory,
		cluster,
		policy,
		holdings,
		onsaved
	}: {
		open?: boolean;
		accessory: AccessoryView;
		cluster: Cluster;
		policy: AccessoryPolicy | null;
		holdings: WalletHoldings | undefined;
		onsaved?: () => void;
	} = $props();

	let enabled = $state(false);
	let draft = $state.raw<PolicyDraft>(tapPaymentsPreset());
	let activeDraft = $state.raw<PolicyDraft>(tapPaymentsPreset());
	let version = $state(0);
	let extraAssets = $state<string[]>([]);
	let limitsProblem = $state<string | null>(null);
	let programsProblem = $state<string | null>(null);
	let busy = $state(false);
	let failure = $state<FriendlyError | null>(null);
	let pasting = $state(false);
	let pastedText = $state('');
	let customOpen = $state(false);
	/** The custom-actions editor mounts on first use, so its program descriptions load only then. */
	let customVisited = $state(false);
	let selectedProgram = $state<string | null>(null);
	let programEditor = $state<ProgramsEditor>();
	let customView = $state<HTMLDivElement>();
	let limitsView = $state<HTMLDivElement>();
	const pane = $derived(customOpen ? programEditor?.currentPane() : undefined);
	const payments = $derived(isTapPaymentsDraft(draft));
	const current = $derived(draftFromPolicy(policy));

	async function navigateCustom(value: boolean) {
		customOpen = value;
		if (value) customVisited = true;
		await tick();
		(value ? customView : limitsView)?.scrollIntoView({ block: 'start' });
	}

	function load(next: PolicyDraft) {
		draft = cloneDraft(next);
		limitsProblem = null;
		programsProblem = null;
		customOpen = false;
		selectedProgram = null;
		version++;
	}
	// When the sheet opens: the current permissions, or the tap-payments baseline when there are none.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			enabled = !!policy;
			activeDraft = cloneDraft(current);
			load(policy ? current : tapPaymentsPreset());
			failure = null;
			pasting = false;
			extraAssets = [];
		});
	});

	const spendableTokens = $derived(
		holdings?.tokens.filter((t) => !t.frozen && !isCollectible(t)) ?? []
	);
	const heldMints = $derived(new Set<string>(spendableTokens.map((t) => t.mint)));
	const assets = $derived([...new Set([SOL, ...draft.limits.keys(), ...extraAssets])]);
	const infos = createQuery(() => ({
		queryKey: ['asset-infos', assets.join(','), holdings?.tokens.map((t) => t.mint).join(',')],
		queryFn: () =>
			assetInfos(
				[...new Set([...assets, ...(holdings?.tokens.map((t) => t.mint) ?? [])])],
				holdings
			),
		placeholderData: (prev: Map<string, TokenInfo> | undefined) => prev,
		staleTime: 300_000
	}));
	const infoMap = $derived(infos.data ?? new Map([[SOL, SOL_INFO]]));
	const assetInfo = (asset: string) => assetInfoOr(infoMap, asset);

	const unheldLimit = $derived(
		[...draft.limits.keys()].find(
			(mint) => mint !== SOL && !heldMints.has(mint) && !current.limits.has(mint)
		)
	);
	const problem = $derived(
		enabled
			? (limitsProblem ??
					programsProblem ??
					(unheldLimit ? 'Choose a token already in this wallet for spending limits.' : null) ??
					validateDraft(draft))
			: null
	);
	const changes = $derived(enabled ? policyDiff(activeDraft, draft) : []);
	const unchanged = $derived(
		enabled ? (!!policy || activeDraft.programs.size > 0) && changes.length === 0 : !policy
	);
	const actionsSummary = $derived(
		payments
			? 'Payments only'
			: `${draft.programs.size} program${draft.programs.size === 1 ? '' : 's'}`
	);

	function setLimits(limits: Map<string, CapDraft>, p: string | null) {
		draft = { ...draft, limits };
		limitsProblem = p;
	}
	function setPrograms(programs: Map<Address, ProgramDraft>, p: string | null) {
		draft = { ...draft, programs };
		programsProblem = p;
	}
	function resetActions() {
		draft = cloneDraft({ ...tapPaymentsPreset(), limits: draft.limits, origins: draft.origins });
		programsProblem = null;
		version++;
	}

	function exportPermissions() {
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(draftToSet(draft), null, 2)], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'accessory-permissions.json';
		link.click();
		URL.revokeObjectURL(url);
		toast.success('Permissions exported');
	}

	const pasted = $derived.by(() => {
		if (!pastedText.trim()) return null;
		try {
			const next = draftFromSet(parsePermissionSet(JSON.parse(pastedText)));
			return { next, lines: describeReplacement(draft, next, assetInfo), problem: null };
		} catch (err) {
			return {
				next: null,
				lines: [],
				problem: err instanceof Error ? err.message : 'That isn’t valid permissions JSON.'
			};
		}
	});
	function usePasted() {
		if (!pasted?.next) return;
		load(pasted.next);
		enabled = true;
		pasting = false;
		toast.success('Permissions added to draft');
	}

	async function commitPolicy(actions: PolicyActionArgs[] | 'close', confirmed: () => void) {
		if (busy) return;
		busy = true;
		failure = null;
		try {
			await savePolicy(walletStore.signingContext(), accessory.pda, actions);
			confirmed();
			onsaved?.();
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
		}
	}
	async function saveProgram() {
		if (!selectedProgram || busy) return;
		const next = programSaveDraft(activeDraft, draft, address(selectedProgram));
		if (validateDraft(next)) return;
		const actions = policyDiff(activeDraft, next);
		if (!actions.length) return;
		await commitPolicy(actions, () => {
			activeDraft = cloneDraft(next);
			toast.success('Changes saved');
			programEditor?.saved();
		});
	}
	async function save() {
		if (customOpen || pasting || problem || unchanged || busy) return;
		await commitPolicy(enabled ? changes : 'close', () => {
			toast.success(enabled ? 'Tap permissions saved' : 'Tap signing turned off');
			open = false;
		});
	}
</script>

{#snippet customPolicySummary()}
	{#if !payments}
		<Panel tone="tint" class="space-y-2 py-4">
			<p class="text-[14px] text-muted-foreground">
				Customize which actions your accessory can use.
			</p>
			<Button variant="secondary" size="sm" disabled={busy} onclick={resetActions}
				>Reset to default actions</Button
			>
			<p class="text-[12px] text-muted-foreground">
				Restores payment actions and removes action customizations. Spending limits stay unchanged.
				Save changes on the permissions page to apply.
			</p>
		</Panel>
	{/if}
{/snippet}

{#snippet programSaveControls()}
	<OwnerApproval
		showFee={false}
		action="save these program settings"
		{accessory}
		{cluster}
		active={open}
		{busy}
	>
		<Button size="xl" disabled={busy} onclick={saveProgram}
			>{#if busy}<Spinner /> {walletStore.approvePrompt}{:else}Save changes{/if}</Button
		>
	</OwnerApproval>
{/snippet}

<ResponsiveSheet
	tall={customOpen}
	bind:open={
		() => open,
		(value) => {
			if (!value && customOpen) programEditor?.requestClose(() => (open = false));
			else open = value;
		}
	}
	title={pasting ? 'Import permissions' : (pane?.title ?? 'Tap to sign transactions')}
	description={pasting ? 'Review the permissions before replacing your draft.' : pane?.description}
>
	{#snippet headerActions()}
		{#if !customOpen && !pasting}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					aria-label="Permissions options"
					disabled={busy}
					class={buttonVariants({ variant: 'ghost', size: 'icon', class: '-mt-2' })}
					><Ellipsis /></DropdownMenu.Trigger
				>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Item
						onSelect={() => {
							pasting = true;
							pastedText = '';
						}}>Import permissions</DropdownMenu.Item
					>
					<DropdownMenu.Item onSelect={exportPermissions}>Export permissions</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
	{/snippet}
	<Notice error={failure} />
	<form
		class="space-y-6"
		onsubmit={(e) => {
			e.preventDefault();
			void save();
		}}
	>
		<div bind:this={limitsView} class="space-y-6" class:hidden={customOpen || pasting}>
			<Panel element="label" class="flex min-h-12 items-center justify-between gap-3 py-0">
				<span class="text-[15px] font-medium">Allow transactions</span>
				<Switch
					checked={enabled}
					onCheckedChange={(value) => {
						enabled = value;
						if (enabled) load(tapPaymentsPreset());
					}}
					disabled={busy}
					aria-label="Allow transactions"
				/>
			</Panel>

			{#if enabled}
				<Section label="Spending limits">
					<SpendLimitsEditor
						{assets}
						availableAssets={spendableTokens.map((t) => ({
							id: t.mint,
							label: t.symbol ?? t.name ?? t.mint
						}))}
						infos={infoMap}
						limits={draft.limits}
						{version}
						disabled={busy}
						onchange={setLimits}
						onadd={(mint) => {
							if (heldMints.has(mint)) extraAssets = [...extraAssets, mint];
						}}
						onremove={(asset) => {
							const limits = new Map(draft.limits);
							limits.delete(asset);
							draft = { ...draft, limits };
							extraAssets = extraAssets.filter((a) => a !== asset);
						}}
					/>
				</Section>
				<Section label="Sites that can ask for a tap">
					<AllowedSitesEditor
						origins={draft.origins}
						disabled={busy}
						onchange={(origins) => {
							draft = { ...draft, origins };
						}}
					/>
				</Section>
				<List>
					<ListRow
						label="Custom actions"
						detail={actionsSummary}
						disabled={busy}
						onclick={() => navigateCustom(true)}
						chevron
					/>
				</List>
			{/if}
		</div>
		{#if customVisited}
			<div bind:this={customView} class:hidden={!customOpen}>
				<ProgramsEditor
					bind:this={programEditor}
					bind:selected={selectedProgram}
					{customPolicySummary}
					{programSaveControls}
					activePrograms={activeDraft.programs}
					programs={draft.programs}
					tokenInfos={infoMap}
					{version}
					disabled={busy}
					onchange={setPrograms}
					onfinish={() => {
						selectedProgram = null;
						void navigateCustom(false);
					}}
				/>
			</div>
		{/if}

		{#if pasting}
			<div class="space-y-4">
				<Textarea
					bind:value={pastedText}
					rows={6}
					aria-label="Permissions JSON"
					placeholder="Paste permissions JSON"
					class="font-mono text-[12px]"
				/>
				<FieldError message={pasted?.problem} />
				{#if pasted?.next}
					<p class="text-[13px] font-medium">This replaces your current permissions:</p>
					<ul class="list-disc space-y-0.5 pl-5 text-[13px] text-muted-foreground">
						{#each pasted.lines as line (line)}<li>{line}</li>{:else}<li>
								Nothing changes.
							</li>{/each}
					</ul>
				{/if}
				<Button size="xl" disabled={busy || !pasted?.next} onclick={usePasted}
					>Use these permissions</Button
				>
				<Button variant="secondary" size="xl" disabled={busy} onclick={() => (pasting = false)}
					>Back</Button
				>
			</div>
		{/if}
		{#if !customOpen}<FieldError message={problem} />{/if}
		{#if !customOpen && !pasting && !unchanged}
			<OwnerApproval action="save these settings" {accessory} {cluster} active={open} {busy}>
				<Button type="submit" size="xl" disabled={busy || !!problem}>
					{#if busy}<Spinner /> {walletStore.approvePrompt}{:else}Save changes{/if}
				</Button>
			</OwnerApproval>
		{/if}
	</form>
</ResponsiveSheet>
