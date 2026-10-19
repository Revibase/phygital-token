<script lang="ts">
	let { message }: { message: string | null | undefined } = $props();
</script>

{#if message}<p role="alert" class="text-[13px] text-destructive">{message}</p>{/if}
