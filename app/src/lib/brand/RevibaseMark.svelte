<script lang="ts">
	/** The Revibase mark (traced from the brand icon). Inherits `currentColor`. */
	let { class: className = '', title = null }: { class?: string; title?: string | null } = $props();
</script>

<svg
	viewBox="149 173 214 166"
	fill="currentColor"
	class={className}
	role={title ? 'img' : undefined}
	aria-hidden={title ? undefined : 'true'}
	aria-label={title ?? undefined}
>
	<polygon points="149,173 267.5,173 286,205.5 245,274 285,339 247,339 226.5,305 207,339 170,339 249,205 205,205 185.5,235.5" />
	<polygon points="306,173 344.5,173 363,205.5 285,339 247,339 325.5,205.5" />
</svg>
