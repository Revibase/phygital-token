<script lang="ts" module>
	export type Step = { label: string; detail?: string; status: 'done' | 'active' | 'pending' };
</script>

<script lang="ts">
	import { cn } from '$lib/utils';
	import CheckIcon from '@lucide/svelte/icons/check';
	let { steps }: { steps: Step[] } = $props();
</script>

<ol class="space-y-1" aria-label="Progress">
	{#each steps as step, i (step.label)}
		<li class="flex items-start gap-3 py-1.5" aria-current={step.status === 'active' ? 'step' : undefined}>
			<span
				class={cn(
					'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors',
					step.status === 'done' && 'border-transparent bg-success text-background',
					step.status === 'active' && 'border-primary text-primary',
					step.status === 'pending' && 'text-muted-foreground'
				)}
			>
				{#if step.status === 'done'}<CheckIcon class="size-3.5" strokeWidth={3} />{:else}{i + 1}{/if}
			</span>
			<div class={cn('min-w-0', step.status === 'pending' && 'opacity-55')}>
				<p class="text-sm font-medium">{step.label}</p>
				{#if step.detail && step.status === 'active'}<p class="text-sm text-muted-foreground">{step.detail}</p>{/if}
			</div>
		</li>
	{/each}
</ol>
