/**
 * Describes one inner instruction of an execute: SOL and token transfers, token
 * account control, NFT transfers, memos, and a flagged generic row for anything
 * it cannot decode.
 */
import {
  ATA,
  BUBBLEGUM,
  CORE,
  type ClearedInner,
  type DetailRow,
  MEMO,
  MEMO_V1,
  METADATA,
  SYSTEM,
  TOKEN,
  TOKEN_2022,
  formatTokenAmount,
  formatUnits,
  full,
  getBase58Address,
  hasPrefix,
  readU32LE,
  readU64LE,
} from "./format.js";

const METADATA_TRANSFER_V1 = 49;

const BUBBLEGUM_TRANSFER = [163, 52, 200, 231, 140, 3, 69, 186] as const;

const BUBBLEGUM_TRANSFER_V2 = [119, 40, 6, 235, 234, 221, 248, 49] as const;

const CORE_TRANSFER_V1 = 14;

/** SPL Token / Token-2022 instructions that hand over control of an account. */
const TOKEN_CONTROL_IXS: ReadonlyMap<number, string> = new Map([
  [4, "Approve delegate"],
  [13, "Approve delegate"],
  [6, "Change token authority"],
  [9, "Close token account"],
]);

function generic(
  title: string,
  programAddress: string,
  accounts: readonly string[],
  data: Uint8Array,
): ClearedInner {
  return {
    title,
    details: [
      { label: "Program", value: programAddress },
      { label: "Accounts", value: String(accounts.length) },
      { label: "Data bytes", value: String(data.length) },
    ],
    opaque: true,
    dangerous: false,
  };
}

/**
 * Decode one compact CPI inside `execute_with_owner`. `self` is the signing
 * owner: closing a token account with the rent sent back to it is safe.
 */
export function describeInnerInstruction(
  programAddress: string,
  accounts: readonly string[],
  data: Uint8Array,
  self?: string,
): ClearedInner {
  if (programAddress === SYSTEM) {
    const disc = readU32LE(data, 0);
    if (disc === 2 && data.length === 12) {
      const lamports = readU64LE(data, 4);
      if (lamports !== null) {
        const amount = `${formatUnits(lamports, 9)} SOL`;
        return {
          title: `Send ${amount}`,
          details: [
            { label: "Amount", value: amount },
            { label: "From", value: full(accounts[0]) },
            { label: "To", value: full(accounts[1]) },
          ],
          opaque: false,
          dangerous: false,
        };
      }
    }
    return generic("Unreadable System Program call", programAddress, accounts, data);
  }

  if (programAddress === MEMO || programAddress === MEMO_V1) {
    let text = "";
    try {
      text = new TextDecoder().decode(data);
    } catch {
      text = `(${data.length} bytes)`;
    }
    if (text.length > 80) text = `${text.slice(0, 77)}…`;
    return {
      title: "Memo",
      details: [{ label: "Text", value: text || "(empty)" }],
      opaque: false,
      dangerous: false,
    };
  }

  if (programAddress === TOKEN || programAddress === TOKEN_2022) {
    const kind = programAddress === TOKEN_2022 ? "Token-2022" : "Token";
    const disc = data[0];
    if (disc === 12 && data.length >= 10) {
      const amount = readU64LE(data, 1);
      const decimals = data[9]!;
      const mint = accounts[1] ? String(accounts[1]) : "";
      if (amount !== null) {
        const amountLabel = mint
          ? formatTokenAmount(amount, mint, decimals)
          : formatUnits(amount, decimals);
        // The destination is a token account; its owner is named when the
        // transaction creates it (see the parser), else it's labelled as one.
        return {
          title: `Send ${amountLabel}`,
          details: [
            { label: "Amount", value: amountLabel },
            { label: "Mint", value: full(mint || undefined) },
            { label: "From token account", value: full(accounts[0]) },
            { label: "To token account", value: full(accounts[2]) },
          ],
          opaque: false,
          dangerous: false,
        };
      }
    }
    if (disc === 3 && data.length >= 9) {
      const amount = readU64LE(data, 1);
      if (amount !== null) {
        // Transfer (unchecked) carries no mint or decimals: say so instead of guessing a balance.
        return {
          title: "Send tokens",
          details: [
            {
              label: "Amount",
              value: `${amount.toString()} raw units (token not named in the transaction)`,
            },
            { label: "From token account", value: full(accounts[0]) },
            { label: "To token account", value: full(accounts[1]) },
          ],
          opaque: false,
          dangerous: false,
        };
      }
    }
    if (disc === 9 && data.length === 1 && self && accounts[1] === self) {
      return {
        title: "Close token account",
        details: [
          { label: "Token account", value: full(accounts[0]) },
          { label: "Rent back to", value: full(accounts[1]) },
        ],
        opaque: false,
        dangerous: false,
      };
    }
    const control = disc === undefined ? undefined : TOKEN_CONTROL_IXS.get(disc);
    if (control) {
      // Token layouts: approve(d) = account, [mint,] delegate; set_authority = account (new authority in data);
      // close = account, destination.
      const delegateIndex = disc === 13 ? 2 : 1;
      const named: DetailRow[] =
        disc === 4 || disc === 13
          ? [
              { label: "Token account", value: full(accounts[0]) },
              { label: "Delegate", value: full(accounts[delegateIndex]) },
              { label: "Amount", value: `${readU64LE(data, 1)?.toString() ?? "?"} raw units` },
            ]
          : disc === 6
            ? [
                { label: "Account", value: full(accounts[0]) },
                {
                  label: "New authority",
                  value:
                    data[2] === 1 && data.length >= 35
                      ? getBase58Address(data.slice(3, 35))
                      : "None (removes it)",
                },
              ]
            : [
                { label: "Token account", value: full(accounts[0]) },
                { label: "Rent goes to", value: full(accounts[1]) },
              ];
      return { title: control, details: named, opaque: false, dangerous: true };
    }
    return generic(`Unreadable ${kind} call`, programAddress, accounts, data);
  }

  if (programAddress === ATA) {
    const isCreate = data.length === 0 || data[0] === 0 || data[0] === 1;
    return {
      title: isCreate ? "Create token account" : "Associated token",
      details: [
        { label: "Owner", value: full(accounts[2]) },
        { label: "Mint", value: full(accounts[3]) },
      ],
      opaque: !isCreate,
      dangerous: false,
    };
  }

  if (programAddress === METADATA) {
    // TransferV1: token, token owner, destination token, destination owner, mint, ...
    if (data[0] === METADATA_TRANSFER_V1) {
      return {
        title: "Send NFT",
        details: [
          { label: "NFT", value: full(accounts[4]) },
          { label: "From", value: full(accounts[1]) },
          { label: "To", value: full(accounts[3]) },
        ],
        opaque: false,
        dangerous: false,
      };
    }
    return generic("Unreadable Token Metadata call", programAddress, accounts, data);
  }
  if (programAddress === BUBBLEGUM) {
    // transfer: tree config, leaf owner, leaf delegate, new leaf owner, merkle tree, ...; the leaf index ends the data.
    if (hasPrefix(data, BUBBLEGUM_TRANSFER)) {
      const index = readU32LE(data, data.length - 4);
      return {
        title: "Send compressed NFT",
        details: [
          { label: "Tree", value: full(accounts[4]) },
          { label: "Leaf", value: index === null ? "?" : `#${index}` },
          { label: "From", value: full(accounts[1]) },
          { label: "To", value: full(accounts[3]) },
        ],
        opaque: false,
        dangerous: false,
      };
    }
    // transfer_v2 (mpl-account-compression trees): tree config, payer, authority, leaf owner,
    // leaf delegate, new leaf owner, merkle tree, ...; the leaf index ends the data too.
    if (hasPrefix(data, BUBBLEGUM_TRANSFER_V2)) {
      const index = readU32LE(data, data.length - 4);
      return {
        title: "Send compressed NFT",
        details: [
          { label: "Tree", value: full(accounts[6]) },
          { label: "Leaf", value: index === null ? "?" : `#${index}` },
          { label: "From", value: full(accounts[3]) },
          { label: "To", value: full(accounts[5]) },
        ],
        opaque: false,
        dangerous: false,
      };
    }
    return generic("Unreadable Bubblegum call", programAddress, accounts, data);
  }
  if (programAddress === CORE) {
    // TransferV1: asset, collection, payer, authority, new owner, ...
    if (data[0] === CORE_TRANSFER_V1) {
      return {
        title: "Send NFT",
        details: [
          { label: "NFT", value: full(accounts[0]) },
          { label: "Collection", value: full(accounts[1]) },
          { label: "To", value: full(accounts[4]) },
        ],
        opaque: false,
        dangerous: false,
      };
    }
    return generic("Unreadable Metaplex Core call", programAddress, accounts, data);
  }

  return generic("Call an unknown program", programAddress, accounts, data);
}
