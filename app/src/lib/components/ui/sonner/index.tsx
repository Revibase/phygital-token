'use client';

import { CircleCheck, Info, Loader2, OctagonX, TriangleAlert } from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

export function Toaster(props: ToasterProps) {
	return (
		<Sonner
			theme="light"
			className="toaster group"
			position="top-center"
			style={
				{
					'--normal-bg': 'var(--color-popover)',
					'--normal-text': 'var(--color-popover-foreground)',
					'--normal-border': 'var(--color-border)'
				} as React.CSSProperties
			}
			icons={{
				loading: <Loader2 className="size-4 animate-spin" />,
				success: <CircleCheck className="size-4" />,
				error: <OctagonX className="size-4" />,
				info: <Info className="size-4" />,
				warning: <TriangleAlert className="size-4" />
			}}
			{...props}
		/>
	);
}
