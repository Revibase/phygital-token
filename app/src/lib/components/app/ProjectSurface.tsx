import type { ProjectBackground } from '#lib/shared/project-page.ts';
import { cn } from '#lib/utils.ts';

/**
 * The project's background behind the tap page. A color fills it as is, and Revibase's own text switches to the
 * palette that reads on it. An image is blurred and darkened, so it reads as color and the page stays legible;
 * it can't carry a sharp fake control behind Revibase's. Sheets and the in-app browser sit outside, unthemed.
 */
export function ProjectSurface({
	background,
	children
}: {
	background: ProjectBackground | null;
	children: React.ReactNode;
}) {
	if (!background) return <>{children}</>;
	const dark = background.kind === 'image' || background.scheme === 'dark';
	return (
		<div
			className={cn('text-foreground', dark && 'dark')}
			// The page's own fills (the pinned button's fade, the mark's ring) match what's behind them: the color, or
			// a neutral dark under an image rather than Revibase's teal-tinted one.
			style={
				{
					'--background': background.kind === 'color' ? background.color : '#0d0c12'
				} as React.CSSProperties
			}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
			>
				{background.kind === 'image' ? (
					<>
						<img
							src={background.image}
							alt=""
							decoding="async"
							className="size-full scale-110 object-cover blur-2xl"
						/>
						<div className="absolute inset-0 bg-black/55" />
					</>
				) : null}
			</div>
			{children}
		</div>
	);
}
