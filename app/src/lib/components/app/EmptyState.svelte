<script lang="ts">
	import Panel from './Panel.svelte';

	let { title, body }: { title: string; body?: string } = $props();
</script>

<Panel class="py-5 text-center">
	<p class="text-[15px] font-medium">{title}</p>
	{#if body}<p class="mt-0.5 text-[14px] text-muted-foreground">{body}</p>{/if}
</Panel>
