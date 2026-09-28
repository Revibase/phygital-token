<script lang="ts">
	/** Four characters both screens show, so the user can match them at a glance. */
	let { code, caption = 'Code' }: { code: string; caption?: string } = $props();
</script>

<div class="space-y-1 text-center">
	<p class="text-[13px] font-medium text-muted-foreground">{caption}</p>
	<p class="font-mono text-[34px] leading-none font-semibold tracking-[0.28em] tabular-nums" aria-label={`${caption}: ${code.split('').join(' ')}`}>
		{code}
	</p>
</div>
