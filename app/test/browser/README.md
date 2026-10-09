# Browser simulations

Run the app UI with mock wallet, NFC, metadata and ceremony boundaries:

```sh
pnpm --filter revibase dev:simulation
pnpm --filter revibase test:browser
```

The server uses localhost:4187. Optional runner variables: `SIMULATION_ENGINE=webkit`, `SIMULATION_CHANNEL=chrome`, `SIMULATION_FILTER='scenario regex'`. Install the matching Playwright browser first. Reports/screenshots go to ignored `test/browser/results/`.

Preview token types with `/accessory?kind=bearer|controlled|permanent`. Add `savedWallet=phantom` to seed saved Phantom link details. The parameter is consumed once.

Add `mockup=madlads` to preview Mad Lads #7256 using its [original metadata](https://madlads.s3.us-west-2.amazonaws.com/json/7256.json) and hosted artwork. Wallet ownership and project shortcuts remain simulated.

Scenarios cover linking/handoff recovery, shortcut routing and proofs, wallet selection/preferences, unlink authorization, NFT ownership badges, modal focus, responsive layouts and failed-request recovery. Rendered UI, storage, navigation and proof cryptography are real; wallet signatures, OS app launches and NFC are simulated. Physical-device checks remain necessary. Use `e2e:local` for program-backed ceremonies.

The simulation config rejects builds and is never used for deployment. Nonlocal requests are blocked or served by fixtures.
