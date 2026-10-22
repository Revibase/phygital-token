'use client';

import { X } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';

import { Button } from '#lib/components/ui/button';
import * as Dialog from '#lib/components/ui/dialog';
import * as Drawer from '#lib/components/ui/drawer';
import { cn } from '#lib/utils.ts';

const NestedContext = createContext(false);

export function ResponsiveSheet({
	open,
	onOpenChange,
	title,
	description,
	hideTitle = false,
	wide = false,
	children
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: string;
	hideTitle?: boolean;
	wide?: boolean;
	children: React.ReactNode;
}) {
	const nested = useContext(NestedContext);
	const [desktop, setDesktop] = useState(false);
	const [node, setNode] = useState<HTMLElement | null>(null);

	useEffect(() => {
		const query = window.matchMedia('(min-width: 768px)');
		const onChange = () => setDesktop(query.matches);
		onChange();
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	}, []);

	function focusDialog(event: Event) {
		event.preventDefault();
		node?.focus();
	}

	const header = (Title: typeof Dialog.Title, Description: typeof Dialog.Description) => (
		<div className={cn('flex items-start justify-between gap-3', hideTitle && 'justify-end')}>
			<div className={cn('min-w-0 flex-1 space-y-1 text-left', hideTitle && 'sr-only')}>
				<Title className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">{title}</Title>
				{description ? (
					<Description className="text-[14px] leading-snug text-muted-foreground">
						{description}
					</Description>
				) : null}
			</div>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Close"
				onClick={() => onOpenChange(false)}
				className="-mt-2 -mr-2 bg-muted/70 hover:bg-muted"
			>
				<X className="size-5" />
			</Button>
		</div>
	);

	const DrawerRoot = nested ? Drawer.NestedRoot : Drawer.Root;

	return (
		<NestedContext.Provider value={true}>
			{desktop ? (
				<Dialog.Root open={open} onOpenChange={onOpenChange}>
					<Dialog.Content
						ref={setNode}
						tabIndex={-1}
						onOpenAutoFocus={focusDialog}
						className={cn(
							'bg-background max-h-[min(720px,calc(100dvh-4rem))] gap-0 overflow-y-auto rounded-[20px] p-6 shadow-[0_24px_64px_-24px_rgb(14_26_26/0.35)] ring-black/5 outline-none [scrollbar-width:none] data-closed:duration-150 data-open:duration-200 sm:max-w-[420px] [&::-webkit-scrollbar]:hidden',
							wide && 'sm:max-w-[900px]'
						)}
					>
						<div className="space-y-5">
							{header(Dialog.Title, Dialog.Description)}
							{children}
						</div>
					</Dialog.Content>
				</Dialog.Root>
			) : (
				<DrawerRoot open={open} onOpenChange={onOpenChange}>
					<Drawer.Content
						ref={setNode}
						tabIndex={-1}
						onOpenAutoFocus={focusDialog}
						className="bg-background outline-none"
					>
						<div className="mx-auto flex min-h-0 w-full max-w-md flex-col px-5 pt-5">
							{header(Drawer.Title, Drawer.Description)}
							<div
								data-vaul-no-drag
								className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
							>
								{children}
							</div>
						</div>
					</Drawer.Content>
				</DrawerRoot>
			)}
		</NestedContext.Provider>
	);
}
