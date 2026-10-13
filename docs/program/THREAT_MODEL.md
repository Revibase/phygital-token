# Program threat model

Scope: the on-chain program in `programs/phygital-token`. The web app's server
boundaries are in [`app/ARCHITECTURE.md`](../../app/ARCHITECTURE.md).
Guarantees are listed in [INVARIANTS.md](INVARIANTS.md).

## Assets

- **Token ownership.** Who owns each accessory's token, and whether it is locked.
- **Token records.** Integrators that check a tap off-chain look the token up
  by the tapped key and trust its type and owner.

## Actors and trust

| Actor | Trusted for | Not trusted for |
|-------|-------------|-----------------|
| Accessory (NFC chip with a P-256 key) | keeping its private key; incrementing its sign count; setting the user-present flag only on a physical tap | — |
| Admin / issuer / minter | see "Trusted roles" | — |
| Owner | giving up their own token (`remove_owner`) | other tokens |
| Transaction submitter, fee payer, relayer, RPC | nothing | ordering, censoring or copying transactions |
| Web page requesting the tap | nothing on-chain | — |

## Trusted roles

These are trust assumptions, not bugs:

- **The issuer chooses each token's passkey, type and initial owner.** An issuer
  could register a key it controls instead of the chip's.
- **The admin can close any token** (`close_phygital_token`). Re-initializing the
  same passkey recreates the same token address with a type and owner the
  issuer chooses.
- **The minter can change any token's `mint`.** The program does not use it;
  off-chain readers must not treat it as proof of anything.
- **Whoever first calls `create_config` becomes admin.** Deploy and initialize in
  one step and check the config before announcing the program (see Deployment).

## Threats and mitigations

| Threat | Mitigation | Invariant |
|--------|------------|-----------|
| Forge a tap without the chip | precompile signature, key read from the verified bytes only, key match | T1 |
| Replay a captured tap | strictly increasing sign count; slot-hash expiry | T4, T5 |
| Reuse a tap made for another token | domain-tagged challenge binding the token | T5 |
| Take a locked token by tap | `set_owner` refuses locked tokens | O1 |
| Change a Permanent token's owner | owner fixed at `initialize`; `remove_owner` refuses | O2 |
| Malformed account or sysvar bytes crash the program | bounds-checked readers, no panics, no `unsafe` | F1 |

## Accepted limitations

- **A tap does not name its recipient.** The `set_owner` challenge is
  `SHA256("transfer" ‖ token ‖ slot_hash)`, so the tap can happen before the
  wallet that finishes the claim is known (the in-app wallet and desktop
  handoffs). Anyone who sees a valid assertion before it lands (an RPC node,
  the slot leader, a relayer, or the page that asked for the tap) can submit it
  with themselves as recipient and take a Bearer or unowned Controlled token.
  The window is short (the assertion is single-use and expires with its slot
  hash), and the real owner can tap again if the token is not locked.
- **Authenticators that always report a sign count of 0 cannot be used.** The
  count must increase.
- **No rpId or origin check.** `set_owner` never checks the rpId hash or
  `clientDataJSON.origin`. With a standard authenticator a credential's key is
  scoped to one rpId, so the key match implies it. If the accessory's chip
  signs for any rpId with the same key, the challenge and sign count are the
  remaining protections.

## Deployment

`create_config` makes its first caller the admin, so it must be called in the
same transaction as the program deployment, or immediately after it, with the
resulting admin checked before the program is announced. See
[docs/audit/BUILD.md](../audit/BUILD.md#deploying). This was chosen over
restricting `create_config` to the upgrade authority in the program.
