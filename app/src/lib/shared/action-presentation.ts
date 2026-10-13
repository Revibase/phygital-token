import { formatTokenAmount, uiAmountToRaw } from './amount';
import {
	ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
	PAYMENT_PROGRAMS,
	SYSTEM_PROGRAM_ADDRESS,
	TOKEN_2022_PROGRAM_ADDRESS,
	TOKEN_PROGRAM_ADDRESS,
	TOKEN_PROGRAMS
} from './programs';

export type TokenInfo = { symbol: string; decimals: number };
/** How each restriction comparison reads in the editor. */
export const COMPARISON_LABELS: Record<string, string> = {
	le: 'At most',
	ge: 'At least',
	eq: 'Exactly',
	ne: 'Anything except',
	lt: 'Less than',
	gt: 'More than'
};
/** Integer widths a guided restriction can compare. */
export const RESTRICTABLE_WIDTHS: readonly string[] = ['u8', 'u16', 'u32', 'u64'];

const PROGRAM_DESCRIPTIONS: Record<string, string> = {
	[SYSTEM_PROGRAM_ADDRESS]: 'SOL transfers and account management',
	[TOKEN_PROGRAM_ADDRESS]: 'Token transfers and account management',
	[TOKEN_2022_PROGRAM_ADDRESS]: 'Transfers and features for newer tokens',
	[ASSOCIATED_TOKEN_PROGRAM_ADDRESS]: 'Create accounts to receive tokens'
};
export function programDescription(id: string): string {
	return PROGRAM_DESCRIPTIONS[id] ?? 'Actions described by your uploaded IDL';
}
export function actionDescription(id: string, selector: string): string | null {
	if (id === SYSTEM_PROGRAM_ADDRESS && selector === '02000000') return 'Send SOL to a recipient.';
	if (TOKEN_PROGRAMS.has(id) && selector === '03') return 'Send tokens to another token account.';
	if (TOKEN_PROGRAMS.has(id) && selector === '0c')
		return 'Send tokens and check the token’s decimals.';
	if (id === ASSOCIATED_TOKEN_PROGRAM_ADDRESS && selector === '01')
		return 'Create a token account only if it is missing.';
	if (id === ASSOCIATED_TOKEN_PROGRAM_ADDRESS && selector === '00')
		return 'Create an account to receive a token.';
	return null;
}
/** Only normalize amounts whose units are known from the actual built-in schema. */
export function argumentUnit(
	id: string | undefined,
	name: string,
	type: string,
	tokenInfo?: TokenInfo
): TokenInfo | null {
	const field = name.toLowerCase();
	if (
		id &&
		TOKEN_PROGRAMS.has(id) &&
		field === 'amount' &&
		type === 'u64' &&
		tokenInfo &&
		Number.isInteger(tokenInfo.decimals) &&
		tokenInfo.decimals >= 0 &&
		tokenInfo.decimals <= 18
	)
		return tokenInfo;
	return id === SYSTEM_PROGRAM_ADDRESS &&
		['lamports', 'amount', 'withdraw amount'].includes(field) &&
		type === 'u64'
		? { symbol: 'SOL', decimals: 9 }
		: null;
}
export function restrictionAmount(value: string, decimals: number): string {
	// Unlike transfer amounts, policy comparisons may intentionally use zero.
	if (/^0(?:\.0*)?$/.test(value.trim())) return '0';
	return uiAmountToRaw(value, decimals).toString();
}
export function displayRestrictionAmount(value: string, decimals: number): string {
	return formatTokenAmount(BigInt(value), decimals);
}
const ACCOUNT_DESCRIPTIONS: Record<string, string> = {
	Source: 'The account funds leave from.',
	Destination: 'The account funds are sent to.',
	Mint: 'The token this action uses.',
	Authority: 'The account that approves the action.',
	Owner: 'The account that controls the tokens.',
	Wallet: 'The account that will own the token account.',
	Funder: 'The account that pays to create the token account.',
	'Associated Token': 'The account created to receive this token.',
	'System Program': 'The program used to create accounts.',
	'Token Program': 'The program that manages this token.'
};
export function accountDescription(id: string | undefined, name: string): string | null {
	return id && PAYMENT_PROGRAMS.has(id) ? (ACCOUNT_DESCRIPTIONS[name] ?? null) : null;
}
