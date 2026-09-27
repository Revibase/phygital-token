<script lang="ts">
	import * as Alert from '$lib/components/ui/alert';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import type { Snippet } from 'svelte';

	let { title, body, detail, actions }: { title: string; body: string; detail?: string; actions?: Snippet } = $props();
</script>

<div class="space-y-4" role="alert">
	<Alert.Root class="rounded-2xl">
		<TriangleAlertIcon />
		<Alert.Title>{title}</Alert.Title>
		<Alert.Description>{body}</Alert.Description>
	</Alert.Root>
	{#if actions}<div class="grid gap-2">{@render actions()}</div>{/if}
	{#if detail}
		<Collapsible.Root>
			<Collapsible.Trigger class="flex min-h-11 w-full items-center justify-center gap-1 text-xs text-muted-foreground">
				Technical details <ChevronDownIcon class="size-3" />
			</Collapsible.Trigger>
			<Collapsible.Content>
				<pre class="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{detail}</pre>
			</Collapsible.Content>
		</Collapsible.Root>
	{/if}
</div>
