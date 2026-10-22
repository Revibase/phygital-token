import { AccessoryMark } from './AccessoryMark';
import { WalletAvatar } from './WalletAvatar';

export function BondVisual({
	wallet = null,
	pda = null,
	hasMint
}: {
	wallet?: string | null;
	pda?: string | null;
	hasMint?: boolean;
}) {
	return (
		<div className="flex items-center justify-center gap-3" aria-hidden="true">
			<AccessoryMark size="md" pda={pda} hasMint={hasMint} />
			<div className="relative h-[3px] w-14 overflow-hidden rounded-full bg-border">
				<span className="animate-bond absolute inset-0 rounded-full bg-primary" />
			</div>
			<div className="grid size-20 place-items-center rounded-[26%] bg-card shadow-[0_0_0_1px_rgb(14_26_26/0.06),0_8px_24px_-14px_rgb(14_26_26/0.3)]">
				{wallet ? <WalletAvatar /> : null}
			</div>
		</div>
	);
}
