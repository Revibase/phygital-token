# Accessory and wallet journey

The accessory is the entry point. A tap proves it is genuine and present; that is all most people need. Its wallet is optional: it can hold funds, the owner approves sends and controls transaction permissions. Physical possession, owner control, and NFT ownership remain distinct.

## Principles

1. Core flows (tap landing, claim, release, authenticate) never prompt for or depend on the accessory wallet.
2. The wallet is reached only from Manage accessory, as its last row. It is view-only until the accessory is claimed: balances show, but Receive, Send, Send all and tap settings are hidden, because whoever claims it controls what is there.
3. Tap to sign is off until the owner turns it on. Turning it off never affects authentication.

## Two wallets: accessory and passkey

There are two wallet screens, and they must never be mistaken for each other.

| | Accessory wallet | Passkey wallet |
| --- | --- | --- |
| What it is | A PDA that belongs to the accessory and stays with it when it changes hands | The owner's own Revibase Passkey wallet, created with their passkey |
| Where | Manage accessory → Accessory wallet (`/wallet/[pda]`) | Home → Passkey wallet (`/passkey-wallet`), shown only when that wallet is connected |
| Identity row | "Accessory wallet · Stays with this accessory", with the accessory's artwork | "Passkey wallet · Yours · not tied to an accessory", with the passkey icon |
| Who approves | The owner wallet, through `OwnerApproval` | The passkey itself |
| Network fees | Revibase's fee service, refilled from the accessory wallet when needed | The passkey wallet's own SOL, as in Phantom or Solflare; never sponsored |
| Send all | Always to the owner | To any address the user enters |
| Signer screen | "Send from accessory wallet" | "Send from your wallet" |

When an accessory's owner is the connected passkey wallet, its Send all destination reads "Your passkey wallet", so a sweep visibly lands in the page the user can open. Other wallets (Phantom, Solflare, mobile wallets) get no passkey wallet page: their own app manages their assets. Export key lives in the passkey wallet's menu.

The passkey wallet's sends are plain transfers signed by the wallet itself, with nothing from phygital-token around them. Single sends support SOL (including all of it, minus the exact fee), tokens and every NFT standard the accessory wallet supports. Send all moves tokens (closing their accounts back into the wallet), then collectibles, then SOL last with whatever the final fee leaves. A wallet without enough SOL for the fee says how much to add before anything is signed.

## Product and hierarchy

The accessory is the product. Its on-chain owner wallet manages it; its stable accessory-wallet PDA can hold assets. The bound NFT holder can differ from both. Claiming changes the owner role without moving the bound NFT or accessory-wallet assets. Enabling tap transactions is a separate, optional choice.

The landing shows accessory identity and artwork, authenticity/claim status, an Owner row when claimed, and project experiences. It does not show an accessory-wallet balance card or require wallet connection on arrival. Keep collection identity separate from claim status. Do not infer the wallet app or current ownership from an address or local storage.

Manage accessory lists owner actions, then Accessory details, then Accessory wallet as its last row for valid records, including unclaimed and Permanent accessories. The wallet row has no balance or count; its detail reads “Optional · View only until claimed” or “Optional · Tap to sign on/off”. Invalid records open Details directly and expose no mutation actions. Wallet balances are readable without owner connection, and Receive once claimed; sending requires a claimed accessory and owner approval.

## Claim and management states

| State | Behavior |
| --- | --- |
| Unclaimed and claimable | Claim accessory is primary; Manage accessory is secondary. |
| Claimed Bearer, unlocked | Possession-based claiming remains available; warn that owner control changes while assets stay with the accessory. The owner may change owner or release. |
| Claimed Bearer, locked | The owner may release; no direct change-owner action. |
| Claimed Controlled | The current owner must release before another claim; no direct change-owner action. |
| Permanent | Permanent assignment is explicit; no claim, owner-change or release action. |
| Unknown/unavailable | Show recovery/retry; never present unknown state as unclaimed or empty. |

Claim runs on one page in the browser that tapped: approve with the accessory, choose a wallet, approve in the wallet. A reload starts again from the tap. A signed landing URL alone does not authorize transfer. Wallet selection uses the shared picker, and the chosen owner and type-specific consequences are clear before submission. Claim does not automatically enable tap transactions.

Owner management requests a connection only when needed. Connect wallet opens the selection dialog directly, without an intermediate Connect as owner sheet. Account discovery alone is not server authentication: remote owner browsing uses a single-use signed challenge and current chain ownership. Release and owner change retain their distinct consequences and type restrictions. Assets remain with the accessory; send them out first if that is intended.


## Main paths

| Starting point | Journey | What stays visible |
| --- | --- | --- |
| Fresh tap | Accessory → Manage accessory → Accessory wallet (optional) | Authenticity, accessory identity, project apps |
| Unclaimed or reclaimable accessory | Claim accessory → accessory approval → choose wallet → wallet approval → back to the accessory | Who becomes owner and the relinking consequences |
| Receive | Wallet → Receive → QR or copy address | Solana network and full wallet address |
| Send | Enter recipient and amount → connect owner wallet if needed → approve in wallet | Recipient, amount and relevant account setup or fee top-up costs |
| Tap permissions | Wallet → Tap to sign transactions → edit → connect owner wallet if needed → approve | Tap sign-in is independent of transaction permissions |
| Ownership changes | Manage accessory → move or unlink | Owner identity, NFT ownership, funds warning and sweep option |
| Expired tap | Tap again or sign in with wallet | A clear recovery action |
| Direct public wallet link | View balances → connect owner wallet for writes | Return to accessories when there is no matching active tap context |

## Visual decisions

- Accessory wallet is the last row in Manage accessory; the landing focuses on identity, claim status and project experiences.
- An empty claimed wallet with tap to sign off shows “Nothing here yet” with Receive and the Tap to sign row, instead of a zero balance.
- The wallet uses a single SOL balance, Send and Receive, and token holdings. SOL is not repeated in the token list.
- Receive exposes the full wallet address; the direct Tap to sign transactions row opens permission settings. About this wallet explains ownership.
- Moving, unlinking, and technical details live in Manage accessory. The owner’s accessory list no longer offers unlink as a competing row action.
- Permission editing shows configured token limits. Held tokens can be added by name; optional per-tap limits use disclosure. Import/Export live in the main settings header menu.
- Every sheet has an accessible close control on phones as well as desktop.
- Empty, loading, retry, owner mismatch, disabled transaction, frozen token, and fee refill states remain explicit.

## Owner connection and approval

Viewing assets and receiving funds require no owner connection. Transaction actions share `OwnerApproval`: when disconnected, Connect wallet opens the shared `WalletConnect` selection dialog directly. There is no extra connect-as-owner sheet. A connected non-owner sees a clear owner-only message. Claim, release and permission-request flows reuse the same picker while retaining their own authorization requirements.

Individual asset sends use a single form. Validation, account setup costs and relevant top-ups appear there; submission opens wallet approval without a separate app review page. Bulk sends retain their selection, destination and batch information because multiple approvals may be necessary. Current on-chain authority and transaction simulation remain enforced independently of UI state.

## Tap settings

The main pane contains Allow transactions, Spending limits, Sites that can ask for a tap, and a Custom actions entry. The sites list starts as Any site; owners type a site in any form (`app.example.com`, a full URL) and it is stored as the exact origin a browser signs. Its note says apps that read the accessory directly aren't covered, so spending limits still matter. Normal payment-policy descriptions and general fee/token helper paragraphs are omitted. Turning tap transactions off does not prevent owner sends or accessory sign-in. Amounts use exact display-unit conversion; optional per-tap caps and custom reset periods remain available.

### Asset-first sends and sending all

Receive stays in the primary action row. Send all reviews the owner address, SOL, tokens and transferable NFTs before owner approval. Transfers execute in separate batches; the review explains that completed batches persist after cancellation. A retry re-reads current holdings. Frozen and non-transferable NFTs stay in the accessory and are disclosed before approval. Programmable NFTs use their dedicated Token Metadata transfer path.

Tap the SOL balance or a token row to send that asset directly. NFTs appear separately as artwork cards. Standard token-account-backed NFTs transfer exactly one token, without an amount input; the send form identifies the collectible and recipient. DAS metadata identifies NFT standards rather than assuming all zero-decimal tokens are NFTs. Programmable NFTs use Token Metadata TransferV1 with metadata-derived rule sets and recipient token-record rent. Core NFTs use TransferV1 with ownership and collection membership read from chain. Core and compressed NFTs are discovered with paginated DAS owner queries. Compressed NFTs use fresh DAS leaf/proof data, validate the asset-id/tree relationship, distinguish nonce from leaf position, trim proofs using the on-chain canopy, and route to Bubblegum V1 or V2 according to the tree program. The final NFT transaction, including any sponsor refill, is simulated again before requesting a signature. References: https://www.metaplex.com/docs/smart-contracts/token-metadata/pnfts and https://developers.metaplex.com/core/transfer.

The isolated preview includes a sample NFT and permits transfer-form inspection without contacting live RPC. Actual individual and bulk asset transfers remain disabled in the preview. Verification: holdings metadata/classification, one-token NFT transfer encoding, unsupported transfer rejection and sweep exclusion tests; manual browser review of individual token/NFT and bulk send flows.

Send all always receives into the current owner wallet. Its review shows that fixed destination and has no wallet-change action. If another wallet is connected, the user is prompted to connect the owner wallet for approval. The on-chain owner check prevents an outdated owner from executing the transfer.

SOL sends reserve the exact required prepaid-fee refill from the same transaction. Max sends the remaining SOL; fixed amounts remain fixed and are rejected before approval when the amount plus refill cannot be funded. Send all moves SOL last, reading its balance again after tokens/NFTs and account-rent refunds.

## Custom actions

All programs appear in one list, including System, Token, Token-2022 and Associated Token Account. Each row shows its purpose, allowed-action count and unsaved status. Payment programs are not a separate configuration group. Selecting a program opens its allowed actions; selecting an action opens its restrictions.

### Edit an existing action

1. Open Custom actions → program → action.
2. Edit existing restrictions or use Add a restriction to expose a named account or supported argument.
3. Tap Review changes to stage the action and see the program-specific before/after differences.
4. Tap Save changes, connecting the owner wallet if needed, and approve in the wallet.
5. Wait for transaction confirmation. Changes saved means the chain update confirmed; current permissions remain active until then.

Saving here applies only the selected program against the active policy. Other active programs and limits stay intact; unrelated draft changes remain unsaved. Users do not need to navigate back to spending limits to apply a program edit. The review offers Keep editing, and leaving modified work offers Keep editing or Discard.

### Add a program from an IDL

Use Add a program and the styled file picker. Anchor and Codama JSON are supported. Ask for a program address only if the file omits it. A new file opens the named action chooser; selecting an instruction opens its restrictions directly, without Continue or an Add program confirmation. Uploading an existing program opens its existing entry and preserves its rules.

A newly uploaded program remains pending until an action or explicit all-action access is configured. Uploading alone grants nothing and produces no empty-rule validation error. File labels are display metadata, not verification of the deployed program. Program addresses must be unique, and each program allows at most one rule per instruction (no selector may repeat or prefix another), including in imported JSON. The program enforces this on chain; configured actions are excluded from the chooser.

### Restrictions and secondary actions

Guided controls use IDL names, shared Select/Input/Button/DropdownMenu components and optional restriction rows. Known System amounts display SOL; token amounts use display units only when mint semantics and decimals are known. Other values use program units. Fixed offsets are derived only where safe. Existing unsupported constraints are preserved and disclosed; there is no raw byte/index editor.

Each pane has one emphasized primary action. Add an action is quiet when Review changes is the next primary task. Advanced access discloses Allow all actions and requires explicit acknowledgement. Delete program and Delete action use matching red text buttons below the main action. One contextual Back control handles navigation.

The custom-action overview explains customization and offers Reset to default actions only for a non-default policy. Reset restores payment actions and removes action customizations while keeping spending limits and sites; it stays a draft until Save changes on the permissions page. Import/Export remain in the main permissions header menu. Export downloads JSON; Import previews replacement permissions before staging them.

## Shared controls and verification

Use the shared shadcn components wherever their semantics fit. Touch targets are at least 44 × 44 CSS pixels, inputs/select triggers are 48 px high, and primary full-width buttons use the 52 px `xl` variant. Retain visible focus, accessible labels and consistent disabled feedback.

Run `pnpm -C app check`, `pnpm -C app test`, and `pnpm -C app build`. The build checks for simulation fixtures. Test counts change as coverage grows; current runs, rather than historical counts in this document, are authoritative. Browser simulations do not establish physical-device or live-wallet compatibility. See [browser simulation guidance](../app/test/browser/README.md).
