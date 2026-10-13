/**
 * Test double for the trusted in-iframe UI (ui/ui.ts). A script of user
 * actions answers each prompt in order; every screen is recorded so tests can
 * assert what the user was shown (clear-sign summary, derived export key).
 */

import type { SignerUi } from "../src/dispatcher.js";
import type { TransactionSummary } from "../src/tx/policy.js";
import type { GestureStart } from "../src/ui/ui.js";

/**
 * - confirm: press the primary button
 * - cancel: press Cancel / dismiss the sheet
 * - dismiss-busy: confirm, then dismiss the busy sheet while WebAuthn is pending
 * - retry: "Try again" on a recoverable-error screen
 * - hold: leave the prompt open until `release()` (to test concurrency)
 */
export type UiStep = "confirm" | "cancel" | "dismiss-busy" | "retry" | "hold";

export type PromptKind =
  | "confirmImport"
  | "confirmFinishCreate"
  | "confirmSignTransaction"
  | "confirmSignMessage"
  | "confirmExportPrivateKey"
  | "showRecoverable";

export type Screen =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "confirmImport" }
  | { kind: "confirmFinishCreate" }
  | { kind: "confirmSignTransaction"; summary: TransactionSummary }
  | { kind: "confirmSignMessage"; text: string; site: string }
  | { kind: "confirmExportPrivateKey" }
  | { kind: "showRecoverable"; message: string }
  | { kind: "showExportedSecret"; secret: string; publicKey: string };

export class ScriptedUi implements SignerUi {
  readonly screens: Screen[] = [];
  private readonly steps: UiStep[] = [];
  private busyDismiss: (() => void) | null = null;
  private readonly held: Array<(step: UiStep) => void> = [];

  /** Queue the user's next actions, in order. Unscripted confirmations confirm; unscripted recoverable errors cancel. */
  script(...steps: UiStep[]): this {
    this.steps.push(...steps);
    return this;
  }

  /** Drop any queued steps (e.g. a fuzz iteration whose message never reached a prompt). */
  resetScript(): this {
    this.steps.length = 0;
    return this;
  }

  /** Steps that were scripted but never consumed (a test smell). */
  remainingSteps(): readonly UiStep[] {
    return this.steps;
  }

  /** Answer the oldest prompt parked by a "hold" step. */
  release(step: UiStep = "confirm"): void {
    const resolve = this.held.shift();
    if (!resolve) throw new Error("ScriptedUi: nothing is held");
    resolve(step);
  }

  prompts(kind?: Screen["kind"]): Screen[] {
    return kind ? this.screens.filter((s) => s.kind === kind) : this.screens;
  }

  renderIdle(): void {
    this.busyDismiss = null;
    this.screens.push({ kind: "idle" });
  }

  setBusyDismiss(handler: (() => void) | null): void {
    this.busyDismiss = handler;
  }

  setCeremonyBusy(message: string | null): void {
    if (message) this.screens.push({ kind: "busy", message });
  }

  confirmImport<T>(onConfirm: () => T): Promise<GestureStart<T>> {
    this.screens.push({ kind: "confirmImport" });
    return this.gesture("confirmImport", onConfirm);
  }

  confirmFinishCreate<T>(onConfirm: () => T): Promise<GestureStart<T>> {
    this.screens.push({ kind: "confirmFinishCreate" });
    return this.gesture("confirmFinishCreate", onConfirm);
  }

  confirmSignTransaction<T>(
    summary: TransactionSummary,
    onConfirm: () => T,
  ): Promise<GestureStart<T>> {
    this.screens.push({ kind: "confirmSignTransaction", summary });
    return this.gesture("confirmSignTransaction", onConfirm);
  }

  confirmSignMessage<T>(text: string, site: string, onConfirm: () => T): Promise<GestureStart<T>> {
    this.screens.push({ kind: "confirmSignMessage", text, site });
    return this.gesture("confirmSignMessage", onConfirm);
  }

  confirmExportPrivateKey<T>(onConfirm: () => T): Promise<GestureStart<T>> {
    this.screens.push({ kind: "confirmExportPrivateKey" });
    return this.gesture("confirmExportPrivateKey", onConfirm);
  }

  async showRecoverable(message: string): Promise<"retry" | "cancel"> {
    this.screens.push({ kind: "showRecoverable", message });
    const step = this.steps.shift() ?? "cancel";
    if (step !== "retry" && step !== "cancel") {
      throw new Error(`ScriptedUi: '${step}' is not valid on a recoverable-error screen`);
    }
    return step;
  }

  async showExportedSecret(secretBase58: string, publicKey: string): Promise<void> {
    this.screens.push({ kind: "showExportedSecret", secret: secretBase58, publicKey });
  }

  private async gesture<T>(kind: PromptKind, onConfirm: () => T): Promise<GestureStart<T>> {
    let step = this.steps.shift() ?? "confirm";
    if (step === "hold") {
      step = await new Promise<UiStep>((resolve) => this.held.push(resolve));
    }
    if (step === "retry" || step === "hold") {
      throw new Error(`ScriptedUi: '${step}' is not valid on ${kind}`);
    }
    if (step === "cancel") return { ok: false };
    // onConfirm runs synchronously inside the click handler in production —
    // that is what preserves transient user activation for WebAuthn.
    const started = onConfirm();
    if (step === "dismiss-busy") {
      const dismiss = this.busyDismiss;
      if (!dismiss) throw new Error("ScriptedUi: no busy sheet to dismiss");
      queueMicrotask(dismiss);
    }
    return { ok: true, started };
  }
}
