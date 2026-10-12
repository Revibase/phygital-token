<script lang="ts">
	import { untrack } from 'svelte';
	import TokenIcon from './TokenIcon.svelte';
	import Disclosure from './Disclosure.svelte';
	import Panel from './Panel.svelte';
	import FieldError from './FieldError.svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import { Select } from '$lib/components/ui/select';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import { formatTokenAmount, sanitizeDecimalInput, uiAmountToRaw } from '$lib/shared/amount';
	import { PERIODS, SOL, type CapDraft } from '$lib/shared/policy-draft';
	import { assetInfoOr, type AssetInfo } from '$lib/shared/policy-explain';

	/**
	 * One row per asset: amount (empty = can't be spent), period and an
	 * optional max per tap. `version` bumps when the parent replaces the draft.
	 */
	let {
		assets,
		availableAssets = [],
		infos,
		limits,
		version,
		disabled = false,
		onchange,
		onadd,
		onremove
	}: {
		assets: string[];
		availableAssets?: { id: string; label: string }[];
		infos: Map<string, AssetInfo>;
		limits: Map<string, CapDraft>;
		version: number;
		disabled?: boolean;
		onchange: (limits: Map<string, CapDraft>, problem: string | null) => void;
		onadd: (mint: string) => void;
		onremove: (asset: string) => void;
	} = $props();

	type Row = { amount: string; period: string; perTap: string };
	let manualDecimals = $state<Record<string, string>>({});
	let rows = $state<Record<string, Row>>({});
	let tokenPickerOpen = $state(false);
	let perTapOpen = $state<Record<string, boolean>>({});
	const available = $derived(availableAssets.filter((a) => !assets.includes(a.id)));
	let problems = $state<Record<string, string>>({});
	const uid = $props.id();

	const baseInfo = (asset: string): AssetInfo => {
		return assetInfoOr(infos, asset);
	};
	const info = (asset: string) => ({ ...baseInfo(asset), decimals: manualDecimals[asset] === undefined ? baseInfo(asset).decimals : Number(manualDecimals[asset]) });
	const fromCap = (asset: string, cap: CapDraft | undefined): Row =>
		cap
			? {
					amount: formatTokenAmount(cap.cap, info(asset).decimals),
					period: String(cap.windowSeconds),
					perTap: cap.maxPerTx > 0n ? formatTokenAmount(cap.maxPerTx, info(asset).decimals) : ''
				}
			: { amount: '', period: String(PERIODS[0]!.seconds), perTap: '' };

	// Re-seed the text from the draft when the parent replaces it (or decimals arrive).
	$effect(() => {
		void version;
		void infos;
		untrack(() => {
			rows = Object.fromEntries(assets.map((a) => [a, fromCap(a, limits.get(a))]));
		});
	});
	$effect(() => {
		for (const a of assets) if (!untrack(() => rows[a])) rows[a] = fromCap(a, limits.get(a));
	});

	function emit() {
		const next = new Map<string, CapDraft>();
		const errs: Record<string, string> = {};
		for (const asset of assets) {
			const row = rows[asset];
			if (!row?.amount) continue;
			const { decimals } = info(asset);
			if ((!infos.has(asset) || baseInfo(asset).symbol.endsWith('(raw units)')) && asset !== SOL && manualDecimals[asset] === undefined) { errs[asset] = 'Wait for token details, or enter its decimals below.'; continue; }
			if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) { errs[asset] = 'Decimals must be between 0 and 255.'; continue; }
			try {
				const cap = uiAmountToRaw(row.amount, decimals);
				const maxPerTx = row.perTap ? uiAmountToRaw(row.perTap, decimals) : 0n;
				if (cap <= 0n) errs[asset] = 'Enter more than 0, or leave it empty to block it.';
				else if (maxPerTx > cap) errs[asset] = 'The most per tap can’t be more than the limit.';
				next.set(asset, { cap, windowSeconds: BigInt(row.period === 'custom' ? '86400' : row.period), maxPerTx });
			} catch (err) {
				errs[asset] = (err as Error).message;
			}
		}
		problems = errs;
		const first = Object.entries(errs)[0];
		onchange(next, first ? `${info(first[0]).symbol}: ${first[1]}` : null);
	}

</script>

<div class="space-y-3">
	{#each assets as asset (asset)}
		{@const row = rows[asset]}
		{#if row}
			<Panel class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<label for={`${uid}-${asset}`} class="flex min-w-0 items-center gap-2 text-[15px] font-medium"><TokenIcon src={info(asset).icon} label={info(asset).symbol} /><span class="truncate">{info(asset).symbol}</span></label>
					{#if asset !== SOL}
						<Button variant="ghost" size="icon" aria-label={`Remove ${info(asset).symbol}`} {disabled} onclick={() => { onremove(asset); delete rows[asset]; emit(); }}>
							<XIcon class="size-4" />
						</Button>
					{/if}
				</div>
				<div class="flex gap-2">
					<Input
						id={`${uid}-${asset}`}
						value={row.amount}
						oninput={(e) => { row.amount = sanitizeDecimalInput(e.currentTarget.value); emit(); }}
						{disabled}
						inputmode="decimal"
						placeholder={`Amount in ${info(asset).symbol}`}
						aria-invalid={!!problems[asset] || undefined}
						class="flex-1"
					/>
					<div class="min-w-0 flex-1"><Select label={`${info(asset).symbol} period`} value={row.period} onValueChange={(value) => { row.period = value; emit(); }} {disabled} options={[
      {value:'custom',label:'Custom period…'},
      ...PERIODS.map(p=>({value:String(p.seconds),label:p.label})),
      ...(!PERIODS.some(p=>String(p.seconds)===row.period) && row.period !== 'custom' ? [{value:row.period,label:`every ${row.period}s`}] : [])
     ]} /></div>
				</div>
				{#if row.period === 'custom' || !PERIODS.some((p) => String(p.seconds) === row.period)}
					<label class="block text-[13px]">Reset period in seconds (0 = lifetime)<Input inputmode="numeric" value={row.period === 'custom' ? '86400' : row.period} oninput={(e) => { row.period = e.currentTarget.value; emit(); }} {disabled} /></label>
				{/if}
				{#if baseInfo(asset).symbol.endsWith('(raw units)')}
					<label class="block text-[13px]">Token decimals (couldn’t read this mint)<Input inputmode="numeric" value={manualDecimals[asset] ?? '0'} oninput={(e) => { manualDecimals[asset] = e.currentTarget.value; emit(); }} {disabled} /></label>
				{/if}
				{#if row.amount}
					<Disclosure label={`Limit each tap${row.perTap ? ` · ${row.perTap} ${info(asset).symbol}` : ' (optional)'}`} bind:open={() => perTapOpen[asset] ?? !!row.perTap, (value) => (perTapOpen[asset] = value)} {disabled}>
					<label class="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
						<span class="shrink-0">Max per tap</span>
						<Input
							value={row.perTap}
							oninput={(e) => { row.perTap = sanitizeDecimalInput(e.currentTarget.value); emit(); }}
							{disabled}
							inputmode="decimal"
							placeholder={`Amount in ${info(asset).symbol}`}
							class="flex-1"
						/>
					</label>
					<p class="mt-2 text-[12px] leading-snug text-muted-foreground">Limits each tap. Your total spending limit above still applies.</p>
					</Disclosure>
				{/if}
				<FieldError message={problems[asset]} />
			</Panel>
		{/if}
	{/each}

	{#if available.length}
		<DropdownMenu.Root bind:open={tokenPickerOpen}>
   <DropdownMenu.Trigger {disabled} class={buttonVariants({ variant: 'add' })}><PlusIcon />Add a token</DropdownMenu.Trigger>
   <DropdownMenu.Content class="max-h-64 w-[var(--bits-dropdown-menu-anchor-width)] overflow-y-auto">
    {#each available as asset (asset.id)}
     {@const token = info(asset.id)}
     <DropdownMenu.Item {disabled} class="min-h-14 gap-3" onSelect={() => onadd(asset.id)}>
      <TokenIcon src={token.icon} label={token.symbol} />
      <span class="min-w-0 flex-1"><span class="block truncate text-[14px] font-medium">{token.name ?? asset.label}</span><span class="block text-[12px] text-muted-foreground">{token.symbol}</span></span>
     </DropdownMenu.Item>
    {/each}
   </DropdownMenu.Content>
  </DropdownMenu.Root>
	{/if}
</div>
