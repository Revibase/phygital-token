<script lang="ts">
	let { code, caption = 'Check this matches your other screen' }: { code: string; caption?: string } = $props();
</script>

<div class="space-y-2 text-center">
	<p class="text-sm text-muted-foreground">{caption}</p>
	<p class="font-mono text-3xl font-semibold tracking-[0.4em] text-primary" aria-label={`Code ${code.split('').join(' ')}`}>
		{code}
	</p>
</div>
