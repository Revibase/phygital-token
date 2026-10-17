# Browser simulations

```sh
pnpm --filter revibase dev:simulation
pnpm --filter revibase test:browser
```

The server uses localhost:4187. Optional runner variables: `SIMULATION_ENGINE=webkit`, `SIMULATION_CHANNEL=chrome`, `SIMULATION_FILTER='scenario regex'`. Install the matching Playwright browser first. Reports go to the ignored `test/browser/results/` directory.

Preview token types with `/accessory?kind=bearer|controlled|permanent`. `savedWallet=phantom` seeds a saved claim. `mockup=madlads` previews Mad Lads #7256 from its [original metadata](https://madlads.s3.us-west-2.amazonaws.com/json/7256.json). Wallet ownership and project shortcuts stay simulated.

Scenarios cover claiming, embed and new-tab shortcuts, release, the NFT badge, layout, and failed requests. The rendered UI is real. Wallet signatures, NFC, and chain reads are simulated. Use `e2e:local` for program-backed claims.

The simulation config cannot be deployed. Nonlocal requests are blocked or served by fixtures.
