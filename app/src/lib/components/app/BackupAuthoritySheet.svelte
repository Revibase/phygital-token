<script lang="ts">
	import Field from './Field.svelte';
	import FieldError from './FieldError.svelte';
	import Notice from './Notice.svelte';
	import Panel from './Panel.svelte';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import { address as toAddress } from '@solana/kit';
	import { createQuery } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Spinner } from '#lib/components/ui/spinner/index.ts';
	import { walletSetupQuery } from '#lib/client/queries.ts';
	import { walletStore } from '#lib/client/wallet/wallet.svelte.ts';
	import { setBackupAuthority } from '#lib/client/wallet/backup.ts';
	import { describeError, type FriendlyError } from '#lib/client/link/messages.ts';
	import { explorerUrl } from '#lib/shared/explorer.ts';
	import { formatCompactTokenAmount, SOL_DECIMALS } from '#lib/shared/amount.ts';
	import { backupAuthorityProblem, backupFeeLamports } from '#lib/shared/wallet-backup.ts';

	let {
		open = $bindable(false),
		mode,
		current,
		vault,
		lamports,
		cluster
	}: {
		open?: boolean;
		mode: 'set' | 'remove';
		current: string | null;
		vault: string;
		lamports: bigint | undefined;
		cluster: string;
	} = $props();

	const uid = $props.id();
	const sol = (value: bigint) => `${formatCompactTokenAmount(value, SOL_DECIMALS)} SOL`;

	const setupQuery = createQuery(() => ({ ...walletSetupQuery(vault), enabled: open }));
	const setup = $derived(setupQuery.data ?? 0n);
	const fee = backupFeeLamports();

	let input = $state('');
	let busy = $state(false);
	let failure = $state<FriendlyError | null>(null);

	$effect(() => {
		if (open) {
			input = '';
			failure = null;
		}
	});

	const typed = $derived(input.trim());
	const formProblem = $derived(
		backupAuthorityProblem(typed, vault) ??
			(typed && typed === current ? 'This is already the backup.' : null)
	);
	const shortfall = $derived(
		lamports !== undefined && lamports < fee + setup
			? `Add ${sol(fee + setup - lamports)} to this wallet to pay for this.`
			: null
	);
	const ready = $derived(mode === 'remove' || (!!typed && !formProblem));

	async function submit() {
		if (!ready || shortfall) return;
		busy = true;
		failure = null;
		try {
			const signature = await setBackupAuthority(
				walletStore.signingContext(),
				mode === 'remove' ? null : toAddress(typed)
			);
			toast.success(mode === 'remove' ? 'Backup removed' : 'Backup set', {
				action: {
					label: 'View',
					onClick: () => window.open(explorerUrl('tx', signature, cluster), '_blank', 'noopener')
				}
			});
			open = false;
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
		}
	}
</script>

<ResponsiveSheet
	bind:open
	title={mode === 'remove' ? 'Remove backup' : current ? 'Change backup' : 'Add a backup'}
	description={mode === 'remove'
		? 'Only your passkey will be able to use this wallet.'
		: 'Another wallet that can use this one without your passkey.'}
>
	<Notice error={failure} />
	<form
		class="space-y-4"
		onsubmit={(e) => {
			e.preventDefault();
			void submit();
		}}
	>
		{#if mode === 'set'}
			<Field label="Backup address" id={`${uid}-backup`}>
				<Input
					id={`${uid}-backup`}
					bind:value={input}
					disabled={busy}
					placeholder="Solana address"
					autocomplete="off"
					autocapitalize="off"
					spellcheck={false}
					aria-invalid={!!formProblem || undefined}
				/>
			</Field>
			<FieldError message={formProblem} />
			<Notice
				tone="info"
				title="It can move everything"
				body="The backup can send all of this wallet’s SOL and tokens, now and later, until you remove it. Use a wallet only you control, such as a hardware wallet."
			/>
		{:else if current}
			<Panel class="space-y-1 py-4">
				<p class="text-[13px] text-muted-foreground">Current backup</p>
				<p class="font-mono text-[13px] break-all">{current}</p>
			</Panel>
		{/if}

		<p class="text-[13px] text-muted-foreground">
			Network fee about {sol(fee)}{setup
				? `, plus ${sol(setup)} to set up this wallet (once)`
				: ''}, paid from this wallet.
		</p>
		<FieldError message={shortfall} />

		<Button
			type="submit"
			size="xl"
			variant={mode === 'remove' ? 'destructive' : 'default'}
			disabled={!ready || busy || !!shortfall}
		>
			{#if busy}<Spinner /> {walletStore.approvePrompt}
			{:else if mode === 'remove'}Remove backup
			{:else}Continue{/if}
		</Button>
	</form>
</ResponsiveSheet>
