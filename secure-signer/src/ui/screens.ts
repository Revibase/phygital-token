/** The trusted screens: create, unlock, confirm transaction or message, export. */
import type { TransactionSummary } from "../tx/policy.js";
import { confirmModel, isAddress, type ConfirmModel, type Row } from "./confirm-model.js";
import { button, el, shorten, shortenAddresses } from "./dom.js";
import {
  type GestureStart,
  confirmScreen,
  detachEscape,
  promptChoice,
  promptChoiceWithGesture,
  reportLayout,
  requestDismiss,
} from "./sheet.js";

const SECRET_MASK = "••••••••••••••••••••••••";

/**
 * Truncated address that expands to the full value on tap, so the user can
 * still verify every character (address-poisoning defence).
 */
function addressToggle(
  address: string,
  className: string,
  onToggle?: (expanded: boolean) => void,
): HTMLButtonElement {
  const b = el("button", {
    class: `${className} mono addr`,
    text: shorten(address),
  });
  b.type = "button";
  b.title = address;
  b.setAttribute("aria-expanded", "false");
  b.setAttribute("aria-label", `${address}. Tap to show full address`);
  b.addEventListener("click", () => {
    const expanded = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", expanded ? "true" : "false");
    b.textContent = expanded ? address : shorten(address);
    onToggle?.(expanded);
    reportLayout();
  });
  return b;
}

export function confirmImport<T>(onConfirm: () => T): Promise<GestureStart<T>> {
  return promptChoiceWithGesture({
    title: "Unlock your wallet",
    body: [
      el("p", {
        class: "muted",
        text: "Use Face ID or your fingerprint to unlock your Revibase passkey wallet.",
      }),
    ],
    primaryLabel: "Unlock",
    secondaryLabel: "Cancel",
    onPrimary: onConfirm,
  });
}

export function confirmFinishCreate<T>(onConfirm: () => T): Promise<GestureStart<T>> {
  return promptChoiceWithGesture({
    title: "Confirm on this phone",
    kicker: "Step 2 of 2 · This phone",
    body: [
      el("p", {
        class: "muted",
        text: "Confirm once more to secure your wallet key on this phone.",
      }),
    ],
    primaryLabel: "Confirm",
    secondaryLabel: "Cancel",
    onPrimary: onConfirm,
  });
}

export function showRecoverable(message: string): Promise<"retry" | "cancel"> {
  return promptChoice({
    title: "Couldn’t continue",
    body: [el("p", { class: "muted", text: message })],
    primary: { label: "Try again", value: "retry" },
    secondary: { label: "Cancel", value: "cancel" },
    cancelValue: "cancel",
    family: "ceremony",
  });
}

function group(className: string, rows: Row[]): HTMLElement | null {
  if (rows.length === 0) return null;
  return el(
    "div",
    { class: className },
    rows.map((r) => detailRow(r.label, r.value)),
  );
}

function detailRow(label: string, value: string): HTMLElement {
  if (isAddress(value)) {
    const row = el("div", { class: "kv-row" });
    row.appendChild(el("span", { class: "kv-label", text: label }));
    row.appendChild(
      addressToggle(value, "kv-value", (expanded) =>
        row.classList.toggle("kv-row-stack", expanded),
      ),
    );
    return row;
  }
  value = shortenAddresses(value);
  const long =
    value.length > 28 ||
    value.includes(" · ") ||
    value.includes("\n") ||
    /None \(|Baseline|Restricted|Allowed/.test(value);
  return el("div", { class: long ? "kv-row kv-row-stack" : "kv-row" }, [
    el("span", { class: "kv-label", text: label }),
    el("span", { class: "kv-value mono", text: value }),
  ]);
}

function heroBlock(hero: ConfirmModel["hero"]): HTMLElement {
  const wrap = el("div", { class: "tx-hero" });
  wrap.appendChild(el("p", { class: "tx-hero-title", text: hero.title }));
  if (hero.subtitle) {
    wrap.appendChild(
      el("p", {
        class: "tx-hero-subtitle",
        text: shortenAddresses(hero.subtitle),
      }),
    );
  }
  return wrap;
}

export function confirmSignTransaction<T>(
  summary: TransactionSummary,
  onConfirm: () => T,
): Promise<GestureStart<T>> {
  return new Promise((resolve) => {
    const done = (v: GestureStart<T>) => {
      detachEscape();
      resolve(v);
    };
    const model = confirmModel(summary);
    const body: Node[] = [heroBlock(model.hero)];

    if (model.callout) {
      body.push(
        el("div", {
          class:
            model.callout.tone === "danger" ? "callout callout-danger" : "callout callout-warn",
          text: model.callout.text,
        }),
      );
    }

    const primaryGroup = group("kv kv-primary", model.rows);
    if (primaryGroup) body.push(primaryGroup);

    const advancedGroup = group("kv", model.details);
    if (advancedGroup) {
      const details = el("details", { class: "tx-details" });
      details.appendChild(el("summary", { class: "tx-details-summary", text: "Details" }));
      details.appendChild(advancedGroup);
      body.push(details);
    }

    const ctaVariant = model.cta.danger ? "danger" : "primary";
    const ctaLabel = model.cta.label;

    confirmScreen(
      "Authorize",
      body,
      [
        button(ctaLabel, ctaVariant, () => {
          done({ ok: true, started: onConfirm() });
        }),
        button("Cancel", "ghost", () => requestDismiss(() => done({ ok: false }))),
      ],
      {
        dismissible: true,
        onDismiss: () => done({ ok: false }),
        family: "review",
      },
    );
  });
}

/** Shows the exact text being signed; only ever the app's sign-in message. */
export function confirmSignMessage<T>(
  text: string,
  site: string,
  onConfirm: () => T,
): Promise<GestureStart<T>> {
  const message = el("p", { class: "mono sign-message", text });
  return promptChoiceWithGesture({
    title: `Sign in to ${site}`,
    body: [
      el("p", {
        class: "muted",
        text: "This only proves you own this wallet. It can’t move funds.",
      }),
      message,
    ],
    primaryLabel: "Sign in",
    secondaryLabel: "Cancel",
    family: "review",
    onPrimary: onConfirm,
  });
}

export function confirmExportPrivateKey<T>(onConfirm: () => T): Promise<GestureStart<T>> {
  return promptChoiceWithGesture({
    title: "Export private key",
    body: [
      el("div", {
        class: "callout callout-danger",
        text: "Anyone with this key can move your funds forever.",
      }),
      el("p", {
        class: "muted",
        text: "Only export on a device you trust. Prefer a password manager or offline backup.",
      }),
    ],
    primaryLabel: "Continue to export",
    primaryVariant: "danger",
    secondaryLabel: "Cancel",
    family: "review",
    onPrimary: onConfirm,
  });
}

export function showExportedSecret(secretBase58: string, publicKey: string): Promise<void> {
  return new Promise((resolve) => {
    let clipboardTimer: number | null = null;
    let revealed = false;
    const secretValue = el("p", {
      class: "mono export-secret",
      text: SECRET_MASK,
    });
    secretValue.setAttribute("aria-label", "Private key hidden");

    const revealBtn = el("button", { class: "reveal-btn", text: "Show" });
    revealBtn.type = "button";
    revealBtn.setAttribute("aria-pressed", "false");

    const hideSecret = () => {
      revealed = false;
      secretValue.textContent = SECRET_MASK;
      secretValue.setAttribute("aria-label", "Private key hidden");
      revealBtn.textContent = "Show";
      revealBtn.setAttribute("aria-pressed", "false");
    };
    const done = () => {
      hideSecret();
      if (clipboardTimer !== null) window.clearTimeout(clipboardTimer);
      detachEscape();
      resolve();
    };

    const addressEl = addressToggle(publicKey, "export-address");

    revealBtn.addEventListener("click", () => {
      revealed = !revealed;
      revealBtn.setAttribute("aria-pressed", revealed ? "true" : "false");
      if (revealed) {
        secretValue.textContent = secretBase58;
        secretValue.setAttribute("aria-label", "Private key");
        revealBtn.textContent = "Hide";
      } else {
        hideSecret();
      }
      reportLayout();
    });

    const secretHead = el("div", { class: "export-field-head" }, [
      el("span", { class: "kv-label", text: "Private key" }),
      revealBtn,
    ]);

    const copyBtn = button("Copy private key", "primary", () => {
      void navigator.clipboard
        ?.writeText(secretBase58)
        .then(() => {
          copyBtn.textContent = "Copied — clears in 30s";
          copyBtn.disabled = true;
          if (clipboardTimer !== null) window.clearTimeout(clipboardTimer);
          clipboardTimer = window.setTimeout(() => {
            void navigator.clipboard?.writeText("").catch(() => {});
            copyBtn.textContent = "Clipboard cleared";
            copyBtn.disabled = false;
          }, 30_000);
        })
        .catch(() => {
          copyBtn.textContent = "Copy failed — try again";
        });
    });

    confirmScreen(
      "Export private key",
      [
        el("div", {
          class: "callout callout-danger",
          text: "Paste into a password manager or offline backup. Don’t screenshot this screen.",
        }),
        el("div", { class: "kv" }, [
          el("div", { class: "kv-row kv-row-stack" }, [
            el("span", { class: "kv-label", text: "Wallet" }),
            addressEl,
          ]),
          el("div", { class: "kv-row kv-row-stack" }, [secretHead, secretValue]),
        ]),
      ],
      [copyBtn, button("Done", "ghost", () => requestDismiss(done))],
      { dismissible: true, onDismiss: done, family: "review" },
    );
  });
}
