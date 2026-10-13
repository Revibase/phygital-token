import {
  PROTOCOL_VERSION,
  type SignerHeightMessage,
  type SignerReadyMessage,
} from "./shared/protocol.js";
import "./styles.css";
import * as api from "./api-backup.js";
import { EXPECTED_PARENT_ORIGIN } from "./constants.js";
import { createSignerDispatcher } from "./dispatcher.js";
import * as ui from "./ui/ui.js";
import { BrowserPrfProvider, currentRpId } from "./webauthn.js";

function post(message: Record<string, unknown>): void {
  window.parent.postMessage(message, EXPECTED_PARENT_ORIGIN);
}

const dispatcher = createSignerDispatcher({
  prf: new BrowserPrfProvider(),
  ui,
  api,
  post,
  parentOrigin: EXPECTED_PARENT_ORIGIN,
  parent: window.parent,
  rpId: currentRpId,
  feePayers: () => api.fetchRevibaseFeePayers(),
});

window.addEventListener("message", (event: MessageEvent) => {
  dispatcher.handleMessage(event);
});

ui.setLayoutReporter((height) => {
  post({ type: "SIGNER_HEIGHT", height } satisfies SignerHeightMessage);
});
ui.renderIdle();
post({ type: "SIGNER_READY", protocolVersion: PROTOCOL_VERSION } satisfies SignerReadyMessage);
