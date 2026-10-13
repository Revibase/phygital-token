<script lang="ts">
	import { untrack } from 'svelte';
	import { parseRule, type RuleJson } from 'phygital-token-sdk';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Select } from '$lib/components/ui/select';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import FieldError from './FieldError.svelte';
	import type { IdlInstruction } from '$lib/shared/program-idl';
	import {
		accountDescription,
		argumentUnit,
		COMPARISON_LABELS,
		displayRestrictionAmount,
		restrictionAmount,
		RESTRICTABLE_WIDTHS,
		type TokenInfo
	} from '$lib/shared/action-presentation';

	/** One action's restrictions, by account and argument name from its IDL. Checks it can't show are kept as they are. */
	let {
		rule,
		instruction,
		programId,
		tokenInfos,
		disabled = false,
		onchange
	}: {
		rule: RuleJson;
		instruction?: IdlInstruction;
		programId?: string;
		tokenInfos?: Map<string, TokenInfo>;
		disabled?: boolean;
		onchange: (rule: RuleJson | null, problem: string | null) => void;
	} = $props();

	type Width = 'u8' | 'u16' | 'u32' | 'u64';
	const ACCOUNT_CHOICES = [
		{ value: 'any', label: 'Any address' },
		{ value: 'wallet', label: 'Accessory wallet' },
		{ value: 'address', label: 'Specific address' }
	];
	const ARGUMENT_CHOICES = [
		{ value: 'any', label: 'Any value' },
		...Object.entries(COMPARISON_LABELS).map(([value, label]) => ({ value, label }))
	];

	const initial = untrack(() => rule);
	const schema = untrack(() => instruction);

	let accountRows = $state(
		(schema?.accounts ?? []).map((name, index) => {
			const key = initial.accounts?.find((a) => a.index === index)?.key;
			return {
				visible: !!key,
				name,
				index,
				choice: key === 'wallet' ? 'wallet' : key ? 'address' : 'any',
				address: key && key !== 'wallet' ? key : ''
			};
		})
	);
	const mintAddress = () =>
		accountRows.find((r) => r.name === 'Mint' && r.choice === 'address')?.address.trim();
	let argumentRows = $state(
		(schema?.args ?? [])
			.filter((a) => a.offset !== undefined && RESTRICTABLE_WIDTHS.includes(a.type))
			.map((arg) => {
				const existing = initial.args?.find(
					(a) => a.offset === arg.offset && a.unsigned?.width === arg.type
				)?.unsigned;
				const mint = mintAddress();
				const unit = argumentUnit(
					programId,
					arg.name,
					arg.type,
					mint ? tokenInfos?.get(mint) : undefined
				);
				const value = existing?.value
					? unit
						? displayRestrictionAmount(existing.value, unit.decimals)
						: existing.value
					: '';
				return { visible: !!existing, ...arg, unit, choice: existing?.is ?? 'any', value };
			})
	);
	let problem = $state<string | null>(null);
	let showProblem = $state(false);

	// Checks the guided rows can't represent; they're preserved as they are.
	const duplicateAccounts = (initial.accounts ?? []).some(
		(a, i, list) => list.findIndex((c) => c.index === a.index) !== i
	);
	const duplicateArgs = (initial.args ?? []).some(
		(a, i, list) =>
			list.findIndex((c) => c.offset === a.offset && c.unsigned?.width === a.unsigned?.width) !== i
	);
	const lengthChecks = !!initial.dataLength || initial.accountCount !== undefined;
	const accountChecks = !!initial.accounts?.some(
		(a) =>
			a.owner ||
			a.data?.length ||
			a.signer !== undefined ||
			a.writable !== undefined ||
			!schema?.accounts[a.index]
	);
	const unknownArgs = !!initial.args?.some(
		(a) => !argumentRows.some((r) => r.offset === a.offset && a.unsigned?.width === r.type)
	);
	const additional =
		duplicateAccounts || duplicateArgs || lengthChecks || accountChecks || unknownArgs;

	function emit() {
		try {
			const accounts = (initial.accounts ?? []).filter(
				(a) => !accountRows.some((r) => initial.accounts?.find((c) => c.index === r.index) === a)
			);
			for (const row of accountRows) {
				const previous = initial.accounts?.find((a) => a.index === row.index);
				const { key: _key, ...rest } = previous ?? { index: row.index };
				const key =
					row.choice === 'wallet'
						? { key: 'wallet' }
						: row.choice === 'address'
							? { key: row.address.trim() }
							: {};
				if (row.choice !== 'any' || Object.keys(rest).length > 1)
					accounts.push({ ...rest, ...key });
			}
			const args = (initial.args ?? []).filter(
				(a) =>
					!argumentRows.some(
						(r) =>
							initial.args?.find((c) => c.offset === r.offset && c.unsigned?.width === r.type) === a
					)
			);
			for (const row of argumentRows) {
				if (row.choice === 'any') continue;
				const value = row.unit ? restrictionAmount(row.value, row.unit.decimals) : row.value.trim();
				args.push({
					offset: row.offset!,
					unsigned: { width: row.type as Width, is: row.choice as 'le', value }
				});
			}
			problem = null;
			onchange(parseRule({ ...initial, accounts, args }), null);
		} catch {
			problem = 'Check the address or amount you entered.';
			onchange(null, problem);
		}
	}
	function edited() {
		showProblem = false;
		queueMicrotask(emit);
	}
	function hide(row: { visible: boolean; choice: string }) {
		row.visible = false;
		row.choice = 'any';
		showProblem = false;
		emit();
	}
	function show(row: { visible: boolean; choice: string }, choice: string) {
		row.visible = true;
		row.choice = choice;
		showProblem = false;
		emit();
	}

	// When the mint changes, show amounts in its units, keeping the underlying value.
	$effect(() => {
		const mint = mintAddress();
		const info = mint ? tokenInfos?.get(mint) : undefined;
		untrack(() => {
			let changed = false;
			for (const row of argumentRows) {
				const unit = argumentUnit(programId, row.name, row.type, info);
				if (unit?.symbol === row.unit?.symbol && unit?.decimals === row.unit?.decimals) continue;
				if (row.value.trim()) {
					try {
						row.value = displayRestrictionAmount(
							restrictionAmount(row.value, row.unit?.decimals ?? 0),
							unit?.decimals ?? 0
						);
					} catch {
						row.value = '';
					}
				}
				row.unit = unit;
				changed = true;
			}
			if (changed) emit();
		});
	});

	const argumentTitle = (row: (typeof argumentRows)[number]) =>
		row.unit ? `Amount per transaction (${row.unit.symbol})` : row.name;
	const visibleAccounts = $derived(accountRows.filter((r) => r.visible));
	const visibleArguments = $derived(argumentRows.filter((r) => r.visible));
	const hiddenAccounts = $derived(accountRows.filter((r) => !r.visible));
	const hiddenArguments = $derived(argumentRows.filter((r) => !r.visible));
</script>

{#snippet restrictionHeader(
	title: string,
	description: string | null | undefined,
	remove: () => void
)}
	<div>
		<div class="flex min-h-11 items-center justify-between gap-3">
			<span class="min-w-0 text-[14px] font-medium">{title}</span>
			<Button
				variant="quiet"
				size="sm"
				class="shrink-0 px-0 hover:bg-transparent"
				aria-label={`Remove ${title} restriction`}
				{disabled}
				onclick={remove}>Remove</Button
			>
		</div>
		{#if description}<p class="-mt-1.5 text-[12px] text-muted-foreground">{description}</p>{/if}
	</div>
{/snippet}

<div class="space-y-5">
	{#if !schema}
		<p class="text-[14px] text-muted-foreground">
			Upload this program’s IDL to set restrictions by name. Existing restrictions are kept.
		</p>
	{:else}
		{#if !visibleAccounts.length && !visibleArguments.length}
			<div class="space-y-1">
				<p class="text-[15px] font-medium">No extra restrictions</p>
				<p class="text-[13px] text-muted-foreground">
					This action follows your spending limits. Add a restriction to narrow what it can do.
				</p>
			</div>
		{/if}
		{#each visibleAccounts as row (row.index)}
			<div class="space-y-2">
				{@render restrictionHeader(row.name, accountDescription(programId, row.name), () =>
					hide(row)
				)}
				<Select
					label={`${row.name} restriction`}
					bind:value={row.choice}
					{disabled}
					options={ACCOUNT_CHOICES}
					onValueChange={edited}
				/>
				{#if row.choice === 'address'}
					<Input
						value={row.address}
						oninput={(e) => {
							showProblem = false;
							row.address = e.currentTarget.value;
							emit();
						}}
						onblur={() => {
							emit();
							showProblem = true;
						}}
						{disabled}
						placeholder="Solana address"
						aria-label={`${row.name} address`}
					/>
				{/if}
			</div>
		{/each}
		{#each visibleArguments as row (row.name)}
			<div class="space-y-2">
				{@render restrictionHeader(argumentTitle(row), undefined, () => hide(row))}
				<Select
					label={`${row.name} comparison`}
					bind:value={row.choice}
					{disabled}
					options={ARGUMENT_CHOICES}
					onValueChange={edited}
				/>
				{#if row.choice !== 'any'}
					<Input
						value={row.value}
						oninput={(e) => {
							showProblem = false;
							row.value = e.currentTarget.value;
							emit();
						}}
						onblur={() => {
							emit();
							showProblem = true;
						}}
						inputmode={row.unit ? 'decimal' : 'numeric'}
						{disabled}
						placeholder={row.unit ? `Amount in ${row.unit.symbol}` : 'Whole number'}
						aria-label={`${row.name} value`}
					/>
				{/if}
			</div>
		{/each}
		{#if hiddenAccounts.length || hiddenArguments.length}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger class={buttonVariants({ variant: 'add' })} {disabled}
					><PlusIcon />Add a restriction</DropdownMenu.Trigger
				>
				<DropdownMenu.Content align="start" class="max-h-72 overflow-y-auto">
					{#each hiddenArguments as row (row.name)}<DropdownMenu.Item
							onSelect={() => show(row, 'le')}
							>{row.unit
								? `Maximum amount per transaction (${row.unit.symbol})`
								: row.name}</DropdownMenu.Item
						>{/each}
					{#each hiddenAccounts as row (row.index)}
						{@const description = accountDescription(programId, row.name)}
						<DropdownMenu.Item onSelect={() => show(row, 'address')}
							>{row.name}{#if description}
								— {description}{/if}</DropdownMenu.Item
						>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
		{#if schema.args.some((a) => !argumentRows.some((r) => r.name === a.name))}
			<p class="text-[12px] text-muted-foreground">
				Some fields can’t be restricted with this policy format. They remain unrestricted unless an
				existing rule already limits them.
			</p>
		{/if}
	{/if}
	{#if additional}<p class="text-[12px] text-muted-foreground">
			Additional restrictions from the existing policy are preserved. Use Export permissions to
			review them.
		</p>{/if}
	<FieldError message={showProblem ? problem : null} />
</div>
