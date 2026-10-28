'use client';

import { Button, buttonVariants } from '#lib/components/ui/button';
import { appDestination, type ProjectApp } from '#lib/shared/project-apps.ts';
import type { MainButton, ProjectAccent } from '#lib/shared/project-page.ts';
import { AppLink } from './AppLink';

/**
 * The page's one main button. Claim is Revibase's, in Revibase's colors. A project button takes the project's
 * accent, with its host under it so you know where it goes.
 */
export function PinnedAction({
	main,
	accent,
	onEmbed
}: {
	main: MainButton;
	accent: ProjectAccent | null;
	onEmbed: (app: ProjectApp) => void;
}) {
	if (main.kind === 'claim') {
		return (
			<Button href="/accessory/link" size="xl">
				Claim accessory
			</Button>
		);
	}
	const host = appDestination(main.app);
	const style = accent
		? ({
				'--primary': accent.color,
				'--primary-foreground': accent.foreground
			} as React.CSSProperties)
		: undefined;
	return (
		<div className="grid gap-1.5" style={style}>
			<AppLink
				app={main.app}
				onEmbed={onEmbed}
				className={buttonVariants({ size: 'xl' })}
				title={`${main.app.label} · ${host}`}
			>
				{main.app.label}
			</AppLink>
			<p className="text-center text-xs text-muted-foreground">{host}</p>
		</div>
	);
}
