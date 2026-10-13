/**
 * Everything the signer flows touch outside pure computation, injected so the
 * production control flow runs headlessly in tests. `main.ts` wires the
 * browser implementations.
 */
import type * as BackupApiModule from "./storage/api-backup.js";
import type { BlobStore } from "./storage/blob-store.js";
import type * as UiModule from "./ui/ui.js";
import type { DiscoverablePrfResult } from "./keys/webauthn.js";
import type { PrfProvider } from "./keys/wallet-service.js";

/** The trusted in-iframe UI (ui/ui.ts) as used by the dispatcher. */
export type SignerUi = Pick<
  typeof UiModule,
  | "renderIdle"
  | "setBusyDismiss"
  | "setCeremonyBusy"
  | "confirmImport"
  | "confirmFinishCreate"
  | "showRecoverable"
  | "confirmSignTransaction"
  | "confirmSignMessage"
  | "confirmExportPrivateKey"
  | "showExportedSecret"
>;

/** Signer → app worker backup calls (api-backup.ts). */
export type BackupApi = Pick<
  typeof BackupApiModule,
  "issueBackupChallenge" | "issueRestoreChallenge" | "restoreWalletBlob" | "backupWalletBlob"
>;

/** PRF provider plus the discoverable (no allowCredentials) restore ceremony. */
export interface SignerPrf extends PrfProvider {
  getDiscoverable(rpId: string, challenge: Uint8Array): Promise<DiscoverablePrfResult>;
}

export interface SignerDeps {
  /** Revibase's fee payers, to name them on the confirm screen (display only). */
  feePayers?: () => Promise<readonly string[] | null>;
  prf: SignerPrf;
  ui: SignerUi;
  api: BackupApi;
  /** Post a message to the parent (main.ts pins the target origin). */
  post: (message: Record<string, unknown>) => void;
  /** The only origin requests are accepted from. */
  parentOrigin: string;
  /** The only window requests are accepted from (`window.parent`). */
  parent: unknown;
  rpId: () => string;
  /** Ciphertext store; omitted ⇒ this origin's `/vault` partitioned cookie. */
  store?: BlobStore | null;
  now?: () => number;
  /** Schedules deferred busy UI (setTimeout 0 in the browser). */
  defer?: (fn: () => void) => void;
}

export interface InboundEvent {
  origin: string;
  source: unknown;
  data: unknown;
}
