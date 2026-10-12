# Official program IDL snapshots

Unmodified Codama IDLs downloaded from the official solana-program repositories on 2026-10-11. No hand-authored account or instruction layouts. Runtime parsing and tests read these exact files.

- System: https://github.com/solana-program/system/blob/15f18487535a4f248afc1bf700a1a8a14f305452/idl.json
- Token: https://github.com/solana-program/token/blob/8185db13640f0df038266c7cf4306c212d81380a/idl.json
- Token-2022: https://github.com/solana-program/token-2022/blob/b4724e6e7fecc8fc36295f861a769401bf92b270/idl.json
- Associated Token Account: https://github.com/solana-program/associated-token-account/blob/06b93de62562a86eb0a5da8164a40fd06fbd4f74/idl.json

These describe the published interfaces; loading an IDL is not verification of a deployed binary. Unsupported variable field positions remain unavailable in the guided restriction builder. Token-2022 extension instructions use explicit multi-field or fixed-byte discriminators; never derive Anchor hashes for them.

The editor loads `native.json`, the parsed form of these snapshots (names, selectors, accounts and argument offsets), on demand through `nativeProgramIdls()`: a few KB instead of the full files. `test/native-program-idls.test.ts` checks it matches a fresh parse of the snapshots; run it with `UPDATE_NATIVE_IDLS=1` to regenerate after updating a snapshot. A module-level promise shares the result across editor mounts; a failed load clears the promise so a later attempt can retry. Uploaded Anchor/Codama IDLs are kept parsed for the session (`savedIdls` in `client/memory.ts`), without overwriting newly uploaded metadata. Neither an uploaded file nor its name grants permissions or verifies deployed code.
