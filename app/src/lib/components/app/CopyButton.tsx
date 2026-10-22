'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

import { copyText } from '#lib/client/clipboard.ts';
import { Button } from '#lib/components/ui/button';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);

	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={copied ? 'Copied' : label}
			className="-mr-2"
			onClick={(event) => {
				event.stopPropagation();
				void copyText(value).then((ok) => {
					if (ok) setCopied(true);
				});
			}}
		>
			{copied ? <Check className="animate-rise size-4 text-success" /> : <Copy className="size-4" />}
		</Button>
	);
}
