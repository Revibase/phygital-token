# Browser simulations

Run the app UI with mock wallet, NFC, metadata and transaction boundaries:

```sh
pnpm --filter revibase dev:simulation
pnpm --filter revibase test:browser
```

The server uses localhost:4187. Optional runner variables: `SIMULATION_ENGINE=webkit`, `SIMULATION_CHANNEL=chrome`, `SIMULATION_FILTER='scenario regex'`. Install the matching Playwright browser first. Reports/screenshots go to ignored `test/browser/results/`.

Preview token types with `/accessory?kind=bearer|controlled|permanent`. Add `savedWallet=phantom` to seed a previously linked Phantom owner. The parameter is consumed once.

Add `mockup=madlads` to preview Mad Lads #7256 using its [original metadata](https://madlads.s3.us-west-2.amazonaws.com/json/7256.json) and hosted artwork. Wallet ownership and project shortcuts remain simulated.

Scenarios cover claiming (tap, wallet and approval on one page, and recovering from a rejection), browser-only shortcut routing, wallet selection, the accessory wallet, unlink authorization, the desktop gate, NFT ownership badges, modal focus, responsive layouts and failed-request recovery. Rendered UI, storage and navigation are real; wallet signatures and NFC are simulated. Physical-device checks remain necessary. Use `e2e:local` for program-backed ceremonies.

The simulation config rejects builds and is never used for deployment. Nonlocal requests are blocked or served by fixtures.

Tap-permission checks should cover allowed sites (normalizing typed sites, rejecting invalid ones, saving and reloading), editing an existing instruction, adding restrictions, importing an IDL for a new or existing program, rejecting duplicate programs/selectors, program-scoped review and confirmed save, discard guards, and default-action reset. A file upload alone must never grant permissions. Verify that disconnected signing actions open the shared picker directly, and connected non-owners see an explanation.

The unit suite also covers semantic policy equality, IDL parsing, program-save scope and JSON client error contracts. Run `pnpm -C app check`, `pnpm -C app test`, and `pnpm -C app build` for type checks, unit/server tests and production fixture exclusion. Passing these does not replace mobile hardware ceremonies or live wallet integration checks.
