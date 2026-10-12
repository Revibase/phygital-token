<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Panel from './Panel.svelte';
	import FieldError from './FieldError.svelte';
	import { toOrigin } from '$lib/shared/policy-draft';

	/** The sites taps may come from. Empty = any site. */
	let {
		origins,
		disabled = false,
		onchange
	}: {
		origins: string[];
		disabled?: boolean;
		onchange: (origins: string[]) => void;
	} = $props();

	const uid = $props.id();
	let text = $state('');
	let problem = $state<string | null>(null);

	function add() {
		const origin = toOrigin(text);
		if (!origin) {
			problem = 'Enter a site like app.example.com.';
			return;
		}
		problem = null;
		text = '';
		if (!origins.includes(origin)) onchange([...origins, origin]);
	}
</script>

<div class="space-y-3">
	{#if origins.length}
		<ul class="space-y-2">
			{#each origins as origin (origin)}
				<Panel element="li" class="flex min-h-12 items-center justify-between gap-2 py-0 pr-1">
					<span class="min-w-0 truncate text-[15px]">{origin}</span>
					<Button variant="ghost" size="icon" aria-label={`Remove ${origin}`} {disabled} onclick={() => onchange(origins.filter((o) => o !== origin))}>
						<XIcon class="size-4" />
					</Button>
				</Panel>
			{/each}
		</ul>
	{:else}
		<Panel><p class="text-[15px]">Any site</p></Panel>
	{/if}

	<div class="flex gap-2">
		<Input
			id={`${uid}-site`}
			bind:value={text}
			oninput={() => (problem = null)}
			onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
			{disabled}
			inputmode="url"
			autocapitalize="off"
			autocomplete="off"
			spellcheck={false}
			placeholder="app.example.com"
			aria-label="Add a site"
			aria-invalid={!!problem || undefined}
			class="flex-1"
		/>
		<Button type="button" variant="secondary" disabled={disabled || !text.trim()} onclick={add}>Add</Button>
	</div>
	<FieldError message={problem} />
	<p class="text-[12px] leading-snug text-muted-foreground">
		{origins.length ? 'Other websites can’t use your accessory to sign.' : 'Add a site to stop other websites using your accessory to sign.'}
		Apps that read the accessory directly aren’t covered, so spending limits still matter.
	</p>
</div>
