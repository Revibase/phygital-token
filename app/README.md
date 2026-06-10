# Phygital NFTs Web App

SvelteKit app for viewing a phygital NFT trading card and transferring ownership via the `phygital-nfts-client` SDK.

## URL format

```
/?mint=<token-mint-address>
```

## Development

```bash
# From repo root — build the SDK first
yarn build:client

# Install and run the app
cd app
npm install
npm run dev
```

## Deploy to Cloudflare Pages

```bash
cd app
npm run build
npx wrangler pages deploy .svelte-kit/cloudflare
```

Set `PUBLIC_SOLANA_RPC_URL` in your Cloudflare Pages environment variables if you are not using devnet.

## Wallet

- **Desktop:** use Phantom, Solflare, or other Wallet Standard extensions.
- **Android Chrome:** the app also registers [Mobile Wallet Adapter](https://docs.solanamobile.com/developers/mobile-wallet-adapter-web) for native mobile wallets.

MWA is not registered on desktop. If you previously saw `GET http://localhost/ net::ERR_CONNECTION_REFUSED`, that was MWA's loopback association probe — expected to fail outside Android Chrome and safe to ignore after this change.
