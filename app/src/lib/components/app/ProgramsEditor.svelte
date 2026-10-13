<script lang="ts">
	import { address, type Address } from '@solana/kit';
	import { knownProgram, toHex } from 'secure-signer/shared';
	import { selectorsOverlap, type RuleJson } from 'phygital-token-sdk';
	import { onMount, tick, untrack, type Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import GuidedRuleEditor from './GuidedRuleEditor.svelte';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import Panel from './Panel.svelte';
	import Field from './Field.svelte';
	import Disclosure from './Disclosure.svelte';
	import Notice from './Notice.svelte';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import { savedIdls, rememberIdl } from '$lib/client/memory';
	import {
		actionDescription,
		argumentUnit,
		COMPARISON_LABELS,
		displayRestrictionAmount,
		programDescription,
		RESTRICTABLE_WIDTHS,
		type TokenInfo
	} from '$lib/shared/action-presentation';
	import { sameProgram, type ProgramDraft } from '$lib/shared/policy-draft';
	import { programName, ruleDetails, ruleLabel } from '$lib/shared/policy-explain';
	import { nativeProgramIdls } from '$lib/shared/program-idls';
	import { parseProgramIdl, type ProgramIdl } from '$lib/shared/program-idl';

	/**
	 * The custom-actions panes: programs → a program's allowed actions → choose an action
	 * → its restrictions → review. Owns its own navigation; the sheet reads `currentPane()`
	 * for its header and renders `programSaveControls` to save one reviewed program.
	 */
	let {
		programs,
		activePrograms,
		programSaveControls,
		customPolicySummary,
		tokenInfos,
		selected = $bindable<string | null>(null),
		onfinish,
		version,
		disabled = false,
		onchange
	}: {
		programs: Map<Address, ProgramDraft>;
		activePrograms: Map<Address, ProgramDraft>;
		programSaveControls: Snippet;
		customPolicySummary: Snippet;
		tokenInfos?: Map<string, TokenInfo>;
		selected?: string | null;
		onfinish?: () => void;
		version: number;
		disabled?: boolean;
		onchange: (programs: Map<Address, ProgramDraft>, problem: string | null) => void;
	} = $props();

	type Step = 'list' | 'program' | 'choose' | 'configure' | 'upload' | 'options' | 'changes';
	const DEFAULT_DESCRIPTION = 'Choose what taps are allowed to do. Spending limits still apply.';
	const stickyAction = 'sticky bottom-0 z-10 shadow-[0_0_0_8px_var(--background)]';

	let root: HTMLDivElement;
	let step = $state<Step>('list');
	let idls = $state<Record<string, ProgramIdl>>({});
	let loadProblem = $state<string | null>(null);
	let pendingPrograms = $state.raw(new Map<Address, ProgramDraft>());
	const displayedPrograms = $derived(new Map([...pendingPrograms, ...programs]));

	let programAddress = $state('');
	let uploadProblem = $state<string | null>(null);
	let uploading = $state(false);
	let needsAddress = $state(false);
	let uploadedText = '';

	let editIndex = $state<number | null>(null);
	let staged = $state.raw<RuleJson>({ selector: '00' });
	let stageProblem = $state<string | null>(null);
	let stageVersion = $state(0);
	let confirmAll = $state(false);
	let savedMessage = $state(false);

	let discardOpen = $state(false);
	let discardOnlyStaged = false;
	let afterDiscard: (() => void) | null = null;

	const currentProgram = $derived(selected ? displayedPrograms.get(address(selected)) : undefined);
	const schema = $derived(selected ? idls[selected] : undefined);
	const instructions = $derived(schema?.instructions ?? []);
	const currentRules = $derived(currentProgram?.kind === 'only' ? currentProgram.rules : []);
	const availableInstructions = $derived.by(() => {
		return instructions.filter(
			(ix) => !currentRules.some((rule) => selectorsOverlap(rule.selector, ix.selector))
		);
	});
	const stagedInstruction = $derived(instructions.find((ix) => ix.selector === staged.selector));
	const programChanged = $derived(
		!!selected &&
			!sameProgram(
				address(selected),
				activePrograms.get(address(selected)),
				programs.get(address(selected))
			)
	);
	// The program as it was when opened: leaving only asks about edits made here, not about an unsaved preset or import.
	let openedWith = $state.raw<ProgramDraft | undefined>(undefined);
	const editedHere = $derived(
		!!selected && !sameProgram(address(selected), openedWith, programs.get(address(selected)))
	);
	const stagedChanged = $derived(
		step === 'configure' &&
			(!!stageProblem ||
				editIndex === null ||
				JSON.stringify(staged) !== JSON.stringify(currentRules[editIndex]))
	);

	const presentName = (name: string) =>
		name
			.replace(/\bSol\b/g, 'SOL')
			.replace(/\bNft\b/g, 'NFT')
			.replace('Token2022', 'Token-2022');
	// Known programs keep the name used across the app; an uploaded IDL names the rest.
	const titleOf = (id: string) =>
		presentName(knownProgram(id)?.name ?? idls[id]?.name ?? programName(id));
	const actionName = (rule: RuleJson) =>
		presentName(
			instructions.find((ix) => ix.selector === rule.selector)?.name ?? ruleLabel(selected!, rule)
		);
	const instructionRisk = (program: string, selector: string) =>
		knownProgram(program)?.instructions.find((k) => toHex(k.selector) === selector)?.risky ?? null;

	const pane = $derived.by((): { title: string; description: string } => {
		switch (step) {
			case 'changes':
				return {
					title: 'Review changes',
					description: `Only changes to ${titleOf(selected!)} will be saved.`
				};
			case 'choose':
				return { title: 'Choose an action', description: 'Choose one action to allow.' };
			case 'configure':
				return {
					title: presentName(stagedInstruction?.name ?? 'Set restrictions'),
					description: 'Set restrictions for this action. Spending limits still apply.'
				};
			case 'upload':
				return { title: 'Add a program', description: 'Upload an IDL to choose actions by name.' };
			case 'options':
				return { title: 'Program options', description: DEFAULT_DESCRIPTION };
			default:
				return {
					title: selected ? titleOf(selected) : 'Custom actions',
					description: DEFAULT_DESCRIPTION
				};
		}
	});
	/** The current pane's title and description, for the sheet header. */
	export function currentPane() {
		return pane;
	}

	onMount(() => {
		nativeProgramIdls()
			.then((native) => (idls = { ...native, ...savedIdls(), ...idls }))
			.catch(() => (loadProblem = 'Couldn’t load program descriptions. Try reopening this sheet.'));
	});

	// A replaced draft starts over at the program list (or the selected program).
	$effect(() => {
		void version;
		untrack(() => {
			pendingPrograms = new Map();
			stageProblem = null;
			confirmAll = false;
			step = selected ? 'program' : 'list';
		});
	});
	$effect(() => {
		const id = selected;
		void version;
		untrack(() => {
			openedWith = id ? structuredClone(programs.get(address(id))) : undefined;
			if (!id && step === 'program') step = 'list';
			else if (id && step === 'list') step = 'program';
		});
	});
	// Each pane starts at its top.
	$effect(() => {
		void step;
		void selected;
		void tick().then(() => root?.scrollIntoView({ block: 'start' }));
	});

	function readableDetails(id: Address, rule: RuleJson) {
		const ix = idls[id]?.instructions.find((i) => i.selector === rule.selector);
		const mintIndex = ix?.accounts.indexOf('Mint') ?? -1;
		const mint =
			mintIndex >= 0 ? rule.accounts?.find((c) => c.index === mintIndex)?.key : undefined;
		return ruleDetails(rule).map((line) => {
			for (const [index, name] of (ix?.accounts ?? []).entries())
				line = line.replace(`Account ${index} is`, `${name} is`);
			for (const arg of ix?.args ?? []) {
				if (arg.offset === undefined) continue;
				const check = rule.args?.find(
					(c) => c.offset === arg.offset && c.unsigned?.width === arg.type
				)?.unsigned;
				if (!check) continue;
				const unit = argumentUnit(
					id,
					arg.name,
					arg.type,
					mint && mint !== 'wallet' ? tokenInfos?.get(mint) : undefined
				);
				const value = unit
					? `${displayRestrictionAmount(check.value, unit.decimals)} ${unit.symbol}`
					: check.value;
				line = line.replace(
					`Number at ${arg.offset} (${arg.type}) ${check.is} ${check.value}`,
					`${unit ? 'Amount' : arg.name}: ${COMPARISON_LABELS[check.is]} ${value}`
				);
			}
			return line;
		});
	}

	const changeLines = $derived.by(() => {
		if (!selected) return [];
		const id = address(selected);
		const before = activePrograms.get(id);
		const after = programs.get(id);
		if (!after) return ['Remove this program and all its allowed actions.'];
		if (after.kind === 'all')
			return [
				'Allow every action in this program, including actions not covered by spending limits.'
			];
		const oldRules = before?.kind === 'only' ? before.rules : [];
		const lines: string[] = [];
		if (before?.kind === 'all')
			lines.push('Replace access to all actions with only the actions listed below.');
		for (const rule of after.rules) {
			const old = oldRules.find((r) => r.selector === rule.selector);
			if (!old) lines.push(`Added ${actionName(rule)}`, ...readableDetails(id, rule));
			else if (JSON.stringify(old) !== JSON.stringify(rule)) {
				lines.push(`Changed ${actionName(rule)}`);
				lines.push(
					`Previously: ${readableDetails(id, old).join('; ') || 'Within your spending limits'}`
				);
				lines.push(`Now: ${readableDetails(id, rule).join('; ') || 'Within your spending limits'}`);
			}
		}
		for (const rule of oldRules)
			if (!after.rules.some((r) => r.selector === rule.selector))
				lines.push(`Removed ${actionName(rule)}`);
		return lines;
	});
	const hasUnrestrictableFields = $derived(
		currentRules.some((rule) =>
			instructions
				.find((ix) => ix.selector === rule.selector)
				?.args.some((arg) => arg.offset === undefined || !RESTRICTABLE_WIDTHS.includes(arg.type))
		)
	);

	async function upload(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || disabled || uploading) return;
		uploading = true;
		uploadProblem = null;
		try {
			if (file.size > 1_000_000) throw new Error('Choose an IDL smaller than 1 MB.');
			uploadedText = await file.text();
			useProgramDescription(await parseProgramIdl(uploadedText, programAddress));
		} catch (err) {
			uploadProblem = err instanceof Error ? err.message : 'Couldn’t read this IDL.';
			needsAddress = uploadProblem.includes('Enter the program address');
		} finally {
			uploading = false;
			input.value = '';
		}
	}
	async function continueImport() {
		if (disabled || uploading) return;
		uploading = true;
		uploadProblem = null;
		try {
			useProgramDescription(await parseProgramIdl(uploadedText, programAddress));
		} catch (err) {
			uploadProblem = err instanceof Error ? err.message : 'Couldn’t read this IDL.';
		} finally {
			uploading = false;
		}
	}
	function useProgramDescription(parsed: ProgramIdl) {
		if (disabled) return;
		const id = address(parsed.address);
		const exists = displayedPrograms.has(id);
		idls = { ...idls, [parsed.address]: parsed };
		rememberIdl(parsed);
		if (!exists) pendingPrograms = new Map(pendingPrograms).set(id, { kind: 'only', rules: [] });
		needsAddress = false;
		programAddress = '';
		uploadedText = '';
		selected = parsed.address;
		step = exists ? 'program' : 'choose';
		toast.success(
			exists ? 'Program description updated' : 'Program ready. Choose an action to allow.'
		);
	}

	function set(id: Address, program: ProgramDraft | null) {
		const pending = new Map(pendingPrograms);
		pending.delete(id);
		pendingPrograms = pending;
		const next = new Map(programs);
		if (program && (program.kind === 'all' || program.rules.length)) next.set(id, program);
		else next.delete(id);
		onchange(next, null);
	}
	function startEdit(index: number | null) {
		editIndex = index;
		stageProblem = null;
		if (index === null) {
			step = 'choose';
			return;
		}
		staged = structuredClone(currentRules[index]!);
		stageVersion++;
		step = 'configure';
	}
	function configure(selector: string) {
		if (!availableInstructions.some((ix) => ix.selector === selector)) return;
		staged = { selector };
		stageProblem = null;
		stageVersion++;
		step = 'configure';
	}
	function apply() {
		if (!selected || stageProblem) return;
		if (
			currentRules.some(
				(rule, index) => index !== editIndex && selectorsOverlap(rule.selector, staged.selector)
			)
		) {
			stageProblem = 'This action already exists. Edit it instead.';
			return;
		}
		const rules = [...currentRules];
		if (editIndex === null) rules.push(staged);
		else rules[editIndex] = staged;
		set(address(selected), { kind: 'only', rules });
		step = 'changes';
		savedMessage = false;
	}
	function removeAction() {
		set(address(selected!), {
			kind: 'only',
			rules: currentRules.filter((_, i) => i !== editIndex)
		});
		step = 'program';
		toast.success('Action removed from draft');
	}
	function allowEverything() {
		set(address(selected!), { kind: 'all' });
		confirmAll = false;
		step = 'program';
	}

	function leaveProgram() {
		selected = null;
		step = 'list';
	}
	function deleteProgram() {
		if (!selected || disabled) return;
		const id = address(selected);
		const pending = new Map(pendingPrograms);
		pending.delete(id);
		pendingPrograms = pending;
		const next = new Map(programs);
		next.delete(id);
		onchange(next, null);
		if (activePrograms.has(id)) step = 'changes';
		else leaveProgram();
	}
	function askToDiscard(onlyStaged: boolean, then: (() => void) | null) {
		discardOnlyStaged = onlyStaged;
		afterDiscard = then;
		discardOpen = true;
	}
	function discard() {
		if (!discardOnlyStaged && selected) {
			const id = address(selected);
			const next = new Map(programs);
			if (openedWith) next.set(id, structuredClone(openedWith));
			else next.delete(id);
			onchange(next, null);
		}
		discardOpen = false;
		const then = afterDiscard;
		afterDiscard = null;
		if (then) then();
		else leaveProgram();
	}
	function back() {
		if (step === 'configure' && stagedChanged)
			return askToDiscard(true, () => (step = editIndex === null ? 'choose' : 'program'));
		if (step === 'program' && editedHere) return askToDiscard(false, null);
		stageProblem = null;
		if (step === 'changes' || step === 'options' || step === 'choose') step = 'program';
		else if (step === 'configure') step = editIndex === null ? 'choose' : 'program';
		else if (step === 'upload') step = selected ? 'program' : 'list';
		else if (selected) leaveProgram();
		else onfinish?.();
	}

	/** Closing the sheet with unsaved work asks first. */
	export function requestClose(close: () => void) {
		if (editedHere || stagedChanged) askToDiscard(false, close);
		else close();
	}
	/** After the sheet saved the selected program. */
	export function saved() {
		savedMessage = true;
		openedWith = structuredClone(currentProgram);
		if (currentProgram) step = 'program';
		else leaveProgram();
	}
</script>

<div bind:this={root} class="space-y-5">
	<Notice title={loadProblem ?? undefined} />
	{#if step === 'list'}
		{@render customPolicySummary()}
		{#if displayedPrograms.size}
			<List>
				{#each [...displayedPrograms] as [id, program] (id)}
					{@const status = sameProgram(id, activePrograms.get(id), programs.get(id))
						? null
						: activePrograms.has(id)
							? 'Unsaved changes'
							: 'Not active yet'}
					<ListRow
						label={titleOf(id)}
						detail={programDescription(id)}
						subdetail={program.kind === 'all'
							? 'All actions allowed'
							: `${program.rules.length} allowed action${program.rules.length === 1 ? '' : 's'}`}
						{disabled}
						onclick={() => (selected = id)}
						chevron
					>
						{#snippet labelBadge()}{#if status}<span class="text-[12px] font-medium text-primary"
									>{status}</span
								>{/if}{/snippet}
					</ListRow>
				{/each}
			</List>
		{/if}
		<Button
			size="xl"
			class={stickyAction}
			{disabled}
			onclick={() => {
				needsAddress = false;
				programAddress = '';
				step = 'upload';
			}}>Add a program</Button
		>
	{:else if step === 'program' && selected}
		{#if programChanged}<p class="text-[13px] font-medium text-muted-foreground">
				Unsaved changes
			</p>{:else if savedMessage}<p role="status" class="text-[13px] text-primary">
				Changes saved
			</p>{/if}
		{#if currentProgram?.kind === 'all'}
			<Panel><p class="text-[15px]">All actions are allowed for this program.</p></Panel>
		{:else}
			{#if currentRules.length}
				<List label="Allowed actions">
					{#each currentRules as rule, index (rule.selector)}
						<ListRow
							label={actionName(rule)}
							subdetail={readableDetails(address(selected), rule).join(' · ') ||
								'Within your spending limits'}
							{disabled}
							onclick={() => startEdit(index)}
							chevron
						/>
					{/each}
				</List>
			{/if}
			<Button
				variant="add"
				disabled={disabled || !schema || !availableInstructions.length}
				onclick={() => startEdit(null)}><PlusIcon />Add an action</Button
			>
			{#if schema && !availableInstructions.length}<p class="text-[13px] text-muted-foreground">
					All actions have been added. Select an existing action to edit it.
				</p>{/if}
		{/if}
		{#if !schema}
			<p class="text-[13px] text-muted-foreground">
				Upload this program’s IDL to add readable actions.
			</p>
			<Button
				size="xl"
				class={stickyAction}
				{disabled}
				onclick={() => {
					needsAddress = false;
					programAddress = '';
					step = 'upload';
				}}>Upload IDL</Button
			>
		{/if}
		<Disclosure label="Advanced access" {disabled}>
			<div class="space-y-2 pt-1">
				<p class="text-[13px] text-muted-foreground">
					Allowing all actions grants access beyond the actions listed above.
				</p>
				<Button
					variant="secondary"
					class="w-full"
					{disabled}
					onclick={() => {
						confirmAll = false;
						step = 'options';
					}}>Allow all actions</Button
				>
			</div>
		</Disclosure>
		{#if programChanged}<Button size="xl" {disabled} onclick={() => (step = 'changes')}
				>Review changes</Button
			>{/if}
	{:else if step === 'changes'}
		<div class="space-y-3">
			{#each changeLines as line, i (i)}<p class="text-[14px] leading-relaxed">{line}</p>{/each}
		</div>
		<p class="text-[13px] text-muted-foreground">
			Your current permissions remain active until the transaction confirms.
		</p>
		{#if hasUnrestrictableFields}<p class="text-[13px] text-muted-foreground">
				Some program fields can’t be restricted by this editor. No new restrictions will be applied
				to those fields.
			</p>{/if}
		{@render programSaveControls()}
	{:else if step === 'options' && selected}
		<p class="text-[12px] break-all text-muted-foreground">
			<span class="font-medium">Program address</span><br />{selected}
		</p>
		<Panel class="space-y-3">
			<p class="text-[15px] font-medium">Allow every action?</p>
			<p class="text-[13px] text-muted-foreground">
				This includes actions that spending limits may not cover.
			</p>
			<label class="flex min-h-11 items-center gap-3 text-[14px]"
				><Checkbox bind:checked={confirmAll} {disabled} />I want to allow every action</label
			>
		</Panel>
		<Button size="xl" disabled={disabled || !confirmAll} onclick={allowEverything}
			>Allow all actions</Button
		>
	{:else if step === 'choose' && selected}
		<List label={titleOf(selected)}>
			{#each availableInstructions as ix (ix.selector)}
				{@const risk = instructionRisk(selected, ix.selector)}
				<ListRow
					label={presentName(ix.name)}
					subdetail={actionDescription(selected, ix.selector) ?? undefined}
					{disabled}
					onclick={() => configure(ix.selector)}
					chevron
				>
					{#snippet labelBadge()}{#if risk}<span class="text-[12px] text-destructive">{risk}</span
							>{/if}{/snippet}
				</ListRow>
			{/each}
		</List>
	{:else if step === 'configure'}
		{#key stageVersion}
			<GuidedRuleEditor
				{tokenInfos}
				programId={selected ?? undefined}
				rule={staged}
				instruction={stagedInstruction}
				{disabled}
				onchange={(rule, problem) => {
					stageProblem = problem;
					if (rule) staged = rule;
				}}
			/>
		{/key}
		<Button
			size="xl"
			class={stickyAction}
			disabled={disabled || !!stageProblem || (!stagedChanged && !programChanged)}
			onclick={apply}>Review changes</Button
		>
		{#if editIndex !== null}<Button
				variant="destructive-quiet"
				class="w-full"
				{disabled}
				onclick={removeAction}>Delete action</Button
			>{/if}
	{:else if step === 'upload'}
		<Field
			label="IDL file"
			id="program-idl-file"
			hint="Importing a description doesn’t grant access. You’ll choose actions before saving."
			error={needsAddress ? null : uploadProblem}
		>
			<Input
				id="program-idl-file"
				type="file"
				accept=".json,application/json"
				disabled={disabled || uploading}
				onchange={upload}
			/>
		</Field>
		{#if needsAddress}
			<Field label="Program address" id="program-idl-address" error={uploadProblem}>
				<Input
					id="program-idl-address"
					bind:value={programAddress}
					disabled={disabled || uploading}
					placeholder="Solana program address"
				/>
			</Field>
			<Button
				size="xl"
				disabled={disabled || uploading || !programAddress.trim()}
				onclick={continueImport}>Continue</Button
			>
		{/if}
	{/if}

	{#if step === 'program' && selected}<Button
			variant="destructive-quiet"
			class="w-full"
			{disabled}
			onclick={deleteProgram}>Delete program</Button
		>{/if}
	<Button variant="quiet" class="w-full" {disabled} onclick={back}
		>{step === 'changes' ? 'Keep editing' : 'Back'}</Button
	>
</div>

<ResponsiveSheet
	bind:open={discardOpen}
	title="Discard unsaved changes?"
	description="Your changes to this program haven’t been applied."
>
	<div class="grid gap-2">
		<Button
			size="xl"
			onclick={() => {
				discardOpen = false;
				afterDiscard = null;
			}}>Keep editing</Button
		>
		<Button variant="destructive" size="xl" onclick={discard}>Discard changes</Button>
	</div>
</ResponsiveSheet>
