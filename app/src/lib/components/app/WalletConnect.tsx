'use client';

import { useEffect, useRef, useState } from 'react';

import { describeError, type FriendlyError } from '#lib/client/link/messages.ts';
import { SignInCancelled, useWallet } from '#lib/client/wallet/wallet-context';
import { Button } from '#lib/components/ui/button';

/**
 * The one way to connect a wallet. Privy shows the login dialog.
 * `requireAddress` refuses any other wallet; `onError` reports that on the caller’s own screen.
 */
export function WalletConnect({
	open = false,
	onOpenChange,
	showButton = true,
	requireAddress = null,
	onConnected,
	onDismissed,
	onError
}: {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	showButton?: boolean;
	requireAddress?: string | null;
	onConnected?: () => void;
	onDismissed?: () => void;
	onError?: (error: FriendlyError) => void;
}) {
	const wallet = useWallet();
	const [connecting, setConnecting] = useState(false);
	const started = useRef(false);

	useEffect(() => {
		if (!open || showButton || started.current) return;
		started.current = true;
		void connect().finally(() => {
			started.current = false;
		});
		// connect is recreated when the wallet changes; only the open transition should start Privy.
	}, [open, showButton]);

	function finish(connected: boolean) {
		onOpenChange?.(false);
		if (connected) onConnected?.();
		else onDismissed?.();
	}

	async function connect() {
		setConnecting(true);
		try {
			if (wallet.address) await wallet.disconnect();
			await wallet.connect({ requireAddress });
			finish(true);
		} catch (err) {
			finish(false);
			if (err instanceof SignInCancelled) return;
			const titled = err as { title?: string; body?: string };
			onError?.(
				titled.title && titled.body
					? { title: titled.title, body: titled.body }
					: describeError(err)
			);
		} finally {
			setConnecting(false);
		}
	}

	if (!showButton) return null;

	return (
		<Button size="xl" disabled={connecting} onClick={() => void connect()}>
			Connect wallet
		</Button>
	);
}
