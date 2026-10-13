/**
 * Programs an accessory policy commonly allows, with their instructions by
 * name, so owners pick "Transfer" rather than a selector, and the passkey
 * wallet names what it is approving. Shared by the app's permissions editor
 * and the signer's clear-sign. A rule matches an instruction whose data starts
 * with its selector.
 */

export type KnownInstruction = {
  name: string;
  selector: readonly number[];
  /** Why it's risky, when it is: it hands over control or can't be metered by spending limits. */
  risky?: string;
};

export type KnownProgram = {
  address: string;
  name: string;
  instructions: readonly KnownInstruction[];
  /** No selector to match on: the program can only be allowed for everything. */
  everythingOnly?: boolean;
  /**
   * Everything it can move out of the wallet is metered by spending limits,
   * so allowing all of it is bounded by those limits.
   */
  metered?: boolean;
};

const HANDS_OVER = "Can hand over control of your tokens";
const DESTROYS = "Destroys tokens, which spending limits don't count";

const tokenInstructions: readonly KnownInstruction[] = [
  { name: "Transfer", selector: [3] },
  { name: "Transfer checked", selector: [12] },
  { name: "Sync native", selector: [17] },
  { name: "Burn", selector: [8], risky: DESTROYS },
  { name: "Burn checked", selector: [15], risky: DESTROYS },
  { name: "Approve", selector: [4], risky: HANDS_OVER },
  { name: "Approve checked", selector: [13], risky: HANDS_OVER },
  { name: "Set authority", selector: [6], risky: HANDS_OVER },
  {
    name: "Close account",
    selector: [9],
    risky: "Closes a token account and sends its rent elsewhere",
  },
];

export const KNOWN_PROGRAMS: readonly KnownProgram[] = [
  {
    address: "11111111111111111111111111111111",
    name: "System Program",
    metered: true,
    instructions: [
      { name: "Transfer SOL", selector: [2, 0, 0, 0] },
      { name: "Create account", selector: [0, 0, 0, 0] },
    ],
  },
  {
    address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    name: "Token Program",
    metered: true,
    instructions: tokenInstructions,
  },
  {
    address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    name: "Token-2022 Program",
    metered: true,
    instructions: tokenInstructions,
  },
  {
    address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    name: "Associated Token Account Program",
    metered: true,
    instructions: [
      { name: "Create token account", selector: [0] },
      { name: "Create token account (if missing)", selector: [1] },
    ],
  },
  {
    address: "Stake11111111111111111111111111111111111111",
    name: "Stake Program",
    instructions: [
      { name: "Delegate stake", selector: [2, 0, 0, 0] },
      { name: "Deactivate stake", selector: [5, 0, 0, 0] },
      { name: "Withdraw stake", selector: [4, 0, 0, 0] },
      {
        name: "Change stake authority",
        selector: [1, 0, 0, 0],
        risky: "Can hand over control of your stake",
      },
    ],
  },
  {
    address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    name: "Memo Program",
    everythingOnly: true,
    metered: true,
    instructions: [],
  },
  {
    address: "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
    name: "Metaplex Core",
    instructions: [{ name: "Transfer NFT", selector: [14] }],
  },
  {
    address: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    name: "Metaplex Token Metadata",
    instructions: [{ name: "Transfer NFT", selector: [49] }],
  },
  {
    address: "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
    name: "Metaplex Bubblegum",
    instructions: [
      { name: "Transfer compressed NFT", selector: [163, 52, 200, 231, 140, 3, 69, 186] },
    ],
  },
];

export function knownProgram(address: string): KnownProgram | null {
  return KNOWN_PROGRAMS.find((p) => p.address === address) ?? null;
}

/** The parts of an instruction rule the registry can name. */
export type RuleShape = {
  selector: ArrayLike<number>;
  dataLength: unknown;
  accountCount: unknown;
  accounts: ArrayLike<unknown>;
  arguments: ArrayLike<unknown>;
};

const isNone = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === "object" && (v as { __option?: string }).__option === "None");

/**
 * The known instruction a rule allows, when it is exactly "this instruction,
 * any accounts and data". Rules with extra checks are custom: `null`.
 */
export function nameRule(program: string, rule: RuleShape): KnownInstruction | null {
  if (
    !isNone(rule.dataLength) ||
    !isNone(rule.accountCount) ||
    rule.accounts.length ||
    rule.arguments.length
  )
    return null;
  const selector = Array.from(rule.selector);
  return (
    knownProgram(program)?.instructions.find(
      (i) => i.selector.length === selector.length && i.selector.every((b, n) => b === selector[n]),
    ) ?? null
  );
}

export const toHex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** A restricted rule can still permit a risky instruction, including a longer selector. */
export function ruleRisk(program: string, selector: ArrayLike<number>): string | null {
  const bytes = Array.from(selector);
  const risky = knownProgram(program)?.instructions.filter(
    (ix) =>
      ix.risky &&
      ix.selector
        .slice(0, Math.min(bytes.length, ix.selector.length))
        .every((b, i) => bytes[i] === b),
  );
  return risky?.length ? risky.map((ix) => `${ix.name}: ${ix.risky}`).join("; ") : null;
}
