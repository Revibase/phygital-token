# Design decisions and accepted risks

Choices that can look like findings but are deliberate. Each says what was
decided, why, and what it costs.

## Program

**Trusted roles.** The admin can close any token; re-initializing the same
passkey restores the same token and wallet address with a type and owner the
issuer chooses, so admin and issuer together can take any wallet. The minter
can rewrite a token's `mint`, which the program never relies on. The upgrade
authority can change everything. These roles are operated by the issuer of the
accessories. See [program threat model](../program/THREAT_MODEL.md#trusted-roles).

**`create_config` is first-caller-wins.** Mitigated by the deploy procedure in
[BUILD.md](BUILD.md#deploying) rather than in code; a front-run is recoverable by
the upgrade authority.

**No rpId check, optional origin check.** No instruction checks the rpId; only
`execute_with_accessory` checks the origin, and only when the owner's policy
lists allowed origins. A credential's key is scoped to one rpId on standard
authenticators, and the challenge plus sign count bind the action. The policy's
allowed origins bind browser taps only; a native client writes its own
`clientDataJSON`.

**`clientDataJSON` is scanned, not parsed.** The first `"type"`, `"challenge"`
and `"origin"` keys are taken as the fields, which is what browsers serialize
first. A crafted `clientDataJSON` only matters if the passkey signs it, and the
challenge must still match.

**The challenge decoder accepts non-canonical trailing bits.** The decoded 32
bytes are compared to the expected challenge, so two spellings of the same bytes
authorize the same thing.

**No on-chain authentication instruction.** Integrators check taps off-chain
(`verifyResponse` in the SDK) and read the token account. An earlier `verify`
instruction let other programs check a tap by CPI over a message they chose; it
was removed because nothing used it, and because anyone could replay a pending
tap's assertion through it to advance the sign count and make the real
`set_owner` or execute fail. Adding an instruction later does not change
existing discriminators.

**Strictly increasing sign count.** Authenticators that always report 0 cannot
be used as accessories.

**Spend accounting is conservative.** Each account's decrease is charged on its
own (`saturating_sub`), so moving tokens between two wallet accounts of the same
mint is charged as a spend. Lamports moved where someone else can close them
count as spent.

**`execute_with_accessory` locates the policy by its stored keys.** The policy
account is checked for owner, discriminator, token and wallet rather than
re-derived from seeds. Policies are only ever created at their PDA by
`update_policy`, so the stored keys are equivalent and the check is cheaper.

**Arithmetic and indexing fail closed.** See [INVARIANTS F2](../program/INVARIANTS.md#failure-behavior).

## Signer

See [secure-signer/THREAT_MODEL.md](../../secure-signer/THREAT_MODEL.md),
including the accepted risk that script on the app origin can request the
passkey's PRF with a user gesture (the app and signer share the RP ID), and the
absence of a seed backup beyond the passkey.

**No `withSecret` wrapper.** Seeds are zeroed explicitly at every exit of each
flow rather than by a try/finally helper. The flows hand seeds across branches
and into `signAndScrub`, so a wrapper would mean restructuring each flow; the
dispatcher tests scan every posted message and API body for key material.

## App server

**No in-app rate limiting.** The public endpoints (`/api/tap/challenge`,
`/api/owner/challenge`, the signer challenge routes and `/api/sponsor`) are
rate-limited in the Cloudflare dashboard, not in code. Until that is configured,
a flood can grow the shared `auth_challenges` table, which is pruned per
namespace on the next insert.

**The app and signer keep separate base64 helpers.** The app's
`shared/encoding.ts` (kit codecs) serves values the app produced itself. All
attacker-controlled blob, signature and challenge decoding on the server goes
through the signer's strict decoder (`secure-signer/shared`).

**`noUncheckedIndexedAccess` is not enabled in the app.** It is on in the SDK,
MCP server and signer. In the app it flags about 150 sites, almost all in tests;
the security-relevant ones in the fee-service validator are guarded explicitly.

**The owner login lasts 30 days** (`OWNER_SESSION_TTL_MS`). It only grants a
view-only `owner_browse` after a fresh on-chain owner check; every owner action
still needs a wallet signature.
