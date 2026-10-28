'use client';

import type { ProjectApp } from '#lib/shared/project-apps.ts';

/** Opens a project app the way its `open` says: `embed` in the in-app browser, `tab` in a new tab. */
export function AppLink({
	app,
	onEmbed,
	className,
	title,
	children
}: {
	app: ProjectApp;
	onEmbed: (app: ProjectApp) => void;
	className?: string;
	title?: string;
	children: React.ReactNode;
}) {
	return app.open === 'embed' ? (
		<button type="button" className={className} title={title} onClick={() => onEmbed(app)}>
			{children}
		</button>
	) : (
		<a
			href={app.href}
			target="_blank"
			rel="noopener noreferrer"
			className={className}
			title={title}
		>
			{children}
		</a>
	);
}
