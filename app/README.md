# Phygital NFTs Web App

SvelteKit app for viewing a phygital NFT trading card and claiming ownership via the `phygital-nfts-client` SDK.

## URL format

Canonical card page (card instance PDA):

```
/card/<card-instance-address>
```

Legacy query-param URLs redirect automatically:

```
/?mint=<card-instance-address>
```

Optional deep link to open the claim sheet:

```
/card/<instance>?claim=1
```

Create collection, design, or mint physical instances:

```
/create
```

**Breaking change:** This release uses the SFT design mint + card instance PDA model. Per-passkey member mints from earlier devnet builds are not compatible. Card URLs now use the **instance PDA**, not the design mint.

Encode plain HTTPS URLs on NFC/QR tags so cards open in the **system browser** (Safari or Chrome), not inside a wallet app.

## Development

```bash
# From repo root — build the SDK first
yarn build:client

# Install and run the app
cd app
npm install
npm run dev
```

Copy `.env.example` to `.env` and set `PUBLIC_WALLETCONNECT_PROJECT_ID` for wallet signing.

## Deploy to Cloudflare Pages

```bash
cd app
npm run build
npx wrangler pages deploy .svelte-kit/cloudflare
```

Set these environment variables in Cloudflare Pages:

- `PUBLIC_SOLANA_RPC_URL` — RPC endpoint (defaults to devnet)
- `PUBLIC_WALLETCONNECT_PROJECT_ID` — WalletConnect Cloud project ID

## Create flow

The `/create` page supports three on-chain steps:

1. **Create collection** — `create_collection_mint` with name, symbol, URI, max size, and unique ID.
2. **Create design** — uploads metadata once to Arweave, then `create_design_mint` for the shared design SFT mint.
3. **Mint card instance** — uploads per-card metadata to Arweave, then `mint_token` stores the metadata URI on-chain, binds a passkey to the design, and mints 1 token to your wallet. Supports batch mint (one pubkey per line).

Card instance metadata JSON (at the on-chain URI):

```json
{
  "secp256r1Pubkey": "<base58 compressed pubkey>",
  "credentialId": "<optional WebAuthn credential id>",
  "expiry": 1735689600000
}
```

Field limits (enforced in the UI):

- name ≤ 32 characters
- symbol ≤ 10 characters
- URI ≤ 200 characters

Prerequisites:

- A funded devnet wallet (browser extension or WalletConnect)
- Create collection → design → instance in that order
- `PUBLIC_SOLANA_RPC_URL` (and `PUBLIC_WALLETCONNECT_PROJECT_ID` for mobile WalletConnect)

## Claim flow

1. **Tap physical card** — WebAuthn passkey on the card (requires system browser)
2. **Sign with wallet** — recipient wallet pays fees and receives the NFT

## Browser support

| Environment | View card | Claim / create |
|-------------|-----------|----------------|
| Desktop with Phantom/Solflare extension | Yes | Yes (one-click extension connect) |
| Desktop Chrome/Firefox (no extension) | Yes | Yes (WalletConnect QR) |
| Android system Chrome | Yes | Yes (WalletConnect) |
| iOS Safari | Yes | Yes (WalletConnect) |
| Wallet in-app browser | Yes | **No** — WebAuthn unavailable |

## Wallet

Wallet connection happens **inside the claim sheet** (step 2) and on `/create`, not from a global header button.

Desktop users with a Solana browser extension (Phantom, Solflare, Backpack) can connect in one click. Mobile and extension-less desktop users connect via **WalletConnect** (scan QR or approve in wallet app). Stay in Safari/Chrome for the card tap, then connect and sign.

## Test checklist

1. `/?mint=X` redirects to `/card/X`
2. Card displays image, set, rarity, stats, flavor text
3. Wallet in-app browser shows banner and disables claim
4. Desktop + extension: tap card → connect extension → sign → success
5. Desktop/mobile without extension: tap card → WalletConnect → sign → success
6. `/create`: create collection → create design → mint instance → view at `/card/<instance>`
