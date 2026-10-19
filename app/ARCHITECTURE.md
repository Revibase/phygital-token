# Revibase app architecture

See [README.md](README.md) for development, testing, and deployment. The program and SDK define the protocol. The app adds sessions and the claim flow.

## Access

| Entry | Grants |
| --- | --- |
| Signed NFC URL | Ten-minute `browse_unlock`: inspect the accessory and start a claim. |
| Wallet sign-in | Thirty-day `owner_session`. A current owner check then issues a view-only `owner_browse`. |
| Fresh WebAuthn assertion | Slot-bound approval for claiming. The connected wallet signs the transaction. |
| Owner signature | Release (`remove_owner`), without a tap. Rejected for Permanent tokens. |

An unused signed NFC URL stays valid until a newer counter is consumed. A tap does not prove wallet-key control or NFT ownership. The on-chain `owner`, the NFT holder, and the person holding the accessory can differ. Bearer can be claimed again while unlocked. Controlled must be released first. Permanent cannot change owner. Server and UI use `accessoryRules`.

The URL’s `pk` is the chip identifier, not its WebAuthn passkey. Resolve it to the token, then derive the PDA from `public_key`. The identifier-to-PDA mapping is cached in D1.

## Security

- Verify a signed tap URL before consuming the shared `tap_counters` mark. Ignore speculative prefetch. Redirect to a clean URL with `no-store` and `no-referrer`.
- A tap the server accepts must be signed on this origin for this rpId. `verifyResponse` checks `clientDataJSON.origin` against the request origin. The browser builds the claim and submits it to Solana RPC.
- Shared `auth_challenges` are single-use. Session cookies are HMAC-signed, HttpOnly, Secure, and SameSite=Lax (`__Host-` in production).
- `browse_unlock` can claim. `owner_browse` cannot. The claim page requires the fresh tap session.
- Claiming connects a wallet, then uses `beginTransfer`, `authenticatePasskeyForTransfer`, and `completeTransfer`. The program checks the recent slot hash, the token passkey, user presence, an increasing sign count, the lock, and that the tap names the recipient signer.
- The transfer challenge is `SHA256("transfer" ‖ token ‖ recipient ‖ slot_hash)`. The assertion stays in browser memory.
- Validate the transaction bytes before and after signing. Keep the approved programs, accounts, recipient, slot, and assertion. Reject unexpected signers or lookup tables.
- The program does not check origin or rpId on `set_owner`. The app checks both before it keeps a tap. Chip and passkey binding also depends on the issuer.
- Stateful APIs require same-origin requests. Claim construction, signing, and submission use the browser’s Solana RPC.
- `/api/tap/challenge`, `/api/tap/resume`, `/api/owner/challenge` and `/api/fee-payer` are rate-limited at the Cloudflare edge, not in the worker.

## Claim

On a phone, connect the wallet first, then prepare the challenge for that wallet before the tap. A desktop visit only shows a handoff to the phone, because the tap needs NFC. iOS WebAuthn needs a user gesture that does not wait on the network. The countdown estimates SlotHashes expiry (`TAP_WINDOW_MS`). The program is authoritative. If the assertion expires, the user taps again.

Every transaction the app builds is v1 (up to 4096 bytes; a claim with two WebAuthn verifies doesn't reliably fit v0's 1232). Its compute limit, priority fee and loaded-data limit live in the message header (`LINK_TX_CONFIG`), not in compute-budget instructions; v1 budgets zero for an unset limit. Wallet discovery and signing use `@solana/connector`. Wallet Standard signs kit 8 transaction bytes directly, because the connector uses kit 7.

## Revibase Passkey

[revibase-wallet](https://github.com/jychab/revibase-wallet) is registered as a Wallet Standard wallet ("Revibase Passkey") when `SECURE_SIGNER_ORIGIN` and `FEE_PAYER_KEY` are set. Its keys live in the secure-signer iframe (`PasskeySignerHost`), which is shown only while it prompts. The page's Permissions-Policy delegates `publickey-credentials-get` to that origin.

Its address is a vault PDA. The vault signs only through the wallet program's `execute`, after a secp256r1 passkey assertion, and it can't pay fees. Nothing is sponsored: the server only relays.

- **Address.** The wallet is `["wallet", sha256(public key ‖ RP ID hash)]`, and `create_wallet` enforces that seed. The address is known as soon as the passkey exists, so it can be funded first. No one can create it with another key or RP. Connecting creates nothing on-chain.
- **Connect.** The signer asks "Use my passkey" or "Create a new wallet" (no username). Creating writes credential ID → public key to the signer's credential map before the wallet is shown. Signing in on a new device looks the key up by the sign-in's credential ID and verifies that sign-in's signature with it.
- **Fees.** The adapter appends one System transfer from the vault to the fee payer: the network fee (5000 lamports per signature, precompiles included, plus the priority fee), plus the wallet config's rent on its first transaction. On that first transaction, `create_wallet` (rent fronted by the fee payer) goes before everything else. `POST /api/fee-payer` (`server/fee-payer/policy.ts`) accepts only `[create_wallet?, secp256r1+, execute]` (v1, no compute-budget instructions, bounded limit and priority fee):
  - the fee payer is the outer fee payer, `create_wallet`'s payer, and the destination of exactly one transfer, and appears nowhere else
  - only the vault signs inside `execute`
  - any calls are allowed, because the user pays.

  It simulates and requires the fee payer to break even exactly (payment = fee + the rent actually taken), then signs last and submits. The signature is only returned once the transaction has been submitted. A transaction that fails on-chain costs the fee payer its fee (the repayment rolls back); that risk is accepted.
- **Claim.** The app builds the usual claim. The adapter keeps the tap's `secp256r1_verify` at the top level and wraps `set_owner`: v1 `[create_wallet?, secp256r1(wallet), secp256r1(tap), execute(set_owner, repayment)]`. Inside the CPI, `set_owner`'s `-1` still finds the tap. The claim page checks the vault can pay (fee plus any setup) before asking for a tap.
- **Sign-in.** `signMessage` returns a WebAuthn proof, not an ed25519 signature. The client sends the passkey's public key; the server derives the vault from it and our RP (no on-chain read, so it works before the wallet exists) and checks the RP, user presence and signature.
- **Transfers.** `/wallet` sends SOL and fungible tokens the same way for every wallet (`shared/wallet-transfer.ts`), and every cost comes out of the sending wallet. The signer prompt shows the repayment as "Network fee" and, on the first transaction, "Wallet setup (one time)".
- The passkey wallet only offers `signAndSendTransaction`: the fee payer never hands out its signature. An embedded dapp asking it for `signTransaction` gets a clear error, and nothing is sent.

## Shortcuts

Project `shortcuts.json` comes from the mint’s HTTPS `external_url`.

| Field | Opens |
| --- | --- |
| omitted, or `prefersExternalTarget: false` | In-app browser, and only when the link is the project host or a subdomain |
| `prefersExternalTarget: true` | New tab |

`solana:` links stay on the Solana Pay sheet. A shortcut carries no session or key material. The frame can ask the shell to connect and sign. The shell approves connect once per origin and account, then the connected wallet signs. A dApp registers that wallet with `registerIframeWallet({ parent: "https://portal.revibase.com" })` before it starts a connector. Registration happens only inside an iframe whose parent sent hello. A normal visit is unchanged.

“Forget wallet preference” clears the claim details shown for this accessory. It does not change where a shortcut opens, and it does not release the accessory.

Only NFT media queries persist locally. Shortcut caches include the owner address. The NFT owner badge is informational.

## Code

| Path | Responsibility |
| --- | --- |
| `src/lib/server/tap`, `session` | Tap verification, replay counters, cookies. |
| `src/lib/server/accessory` | Resolve tokens, enforce view and claim rules, load shortcuts. |
| `src/lib/shared/link-transaction.ts` | Transaction construction and byte validation. |
| `src/lib/client/link`, `wallet` | Claim, release, connector discovery, and signing. |
| `src/lib/client/wallet/embed-host.ts`, `src/lib/shared/wallet-bridge.ts` | In-app browser and the wallet injected into it. |
| `src/lib/client/wallet/{passkey.svelte,passkey-cost}.ts`, `src/lib/shared/passkey-transaction.ts`, `src/lib/server/fee-payer` | Revibase Passkey: registration, its costs, unwrapping `execute`, the relaying fee payer. |
| `src/lib/shared/wallet-{transfer,fee,holdings}.ts`, `src/lib/client/wallet/send.ts` | `/wallet`: balances, transfers, and who pays the fee. |
| `src/lib/components/app`, `src/routes` | UI, including `/accessory/link` and `/wallet`. |

Never expose an RPC URL that contains a secret to the browser.
