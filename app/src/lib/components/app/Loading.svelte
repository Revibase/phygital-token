<script lang="ts">
	import { Spinner } from '$lib/components/ui/spinner';

	let { text }: { text: string } = $props();
</script>

<p class="flex items-center gap-2 text-[14px] text-muted-foreground" role="status">
	<Spinner class="size-4" />{text}
</p>
