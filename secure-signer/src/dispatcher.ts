/**
 * Signer request dispatcher: every sensitive flow (create, unlock, restore,
 * sign, export) and the message gate in front of them.
 *
 * All side effects are injected (`SignerDeps`) so the exact production control
 * flow runs headlessly in tests: WebAuthn/PRF, the trusted UI, the backup API,
 * storage, the parent channel and the clock. `main.ts` wires the browser
 * implementations; nothing here touches `window`, `document` or `fetch`.
 */

import { validateInbound, type InboundRequest } from "./messaging/protocol.js";
import type { InboundEvent, SignerDeps } from "./deps.js";
import { createSignerContext } from "./flows/context.js";
import { codeOf } from "./flows/errors.js";
import { handleAuth } from "./flows/auth.js";
import { handleSign } from "./flows/sign-transaction.js";
import { handleSignMessage } from "./flows/sign-message.js";
import { handleExportPrivateKey } from "./flows/export-key.js";

export type { BackupApi, InboundEvent, SignerDeps, SignerPrf, SignerUi } from "./deps.js";

export function createSignerDispatcher(deps: SignerDeps): {
  handleMessage: (event: InboundEvent) => void;
} {
  const ctx = createSignerContext(deps);
  const { state, ui, fail } = ctx;

  function handleMessage(event: InboundEvent): void {
    if (event.origin !== deps.parentOrigin) return;
    if (event.source !== deps.parent) return;

    const validation = validateInbound(event.data);
    if (!validation.ok) {
      fail(validation.requestId, validation.code);
      return;
    }
    const request = validation.request;

    const replay = state.checkFreshnessAndReplay(request.requestId, request.timestamp);
    if (replay) {
      fail(request.requestId, replay);
      return;
    }
    state.remember(request.requestId, request.timestamp);

    void handle(request).catch(() => {
      fail(request.requestId, "INTERNAL_ERROR");
      state.end();
      ui.renderIdle();
    });
  }

  async function handle(request: InboundRequest): Promise<void> {
    const rpId = deps.rpId();
    const opFor = {
      AUTH_START: "AUTH_PENDING",
      SIGN_TRANSACTION: "SIGN_PENDING",
      SIGN_MESSAGE: "SIGN_PENDING",
      EXPORT_PRIVATE_KEY: "PRIVATE_EXPORT_PENDING",
    } as const;

    const op = opFor[request.type];
    if (!state.begin(op, request.requestId)) {
      fail(request.requestId, "SIGNER_BUSY");
      return;
    }
    try {
      switch (request.type) {
        case "AUTH_START":
          await handleAuth(ctx, {
            requestId: request.requestId,
            rpId,
            authMode: request.authMode,
            credentialIdB64: request.credentialId,
            webauthnAttestationObject: request.webauthnAttestationObject,
          });
          break;
        case "SIGN_TRANSACTION":
          await handleSign(ctx, request.requestId, rpId, request.transaction);
          break;
        case "SIGN_MESSAGE":
          await handleSignMessage(ctx, request.requestId, rpId, request.message);
          break;
        case "EXPORT_PRIVATE_KEY":
          await handleExportPrivateKey(ctx, request.requestId, rpId);
          break;
      }
    } catch (e) {
      fail(request.requestId, codeOf(e));
    } finally {
      state.end();
      ui.renderIdle();
    }
  }

  return { handleMessage };
}
