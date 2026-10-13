import type { TransactionSummary } from "../tx/policy.js";
import { confirmModel, isAddress, type ConfirmModel, type Row } from "./confirm-model.js";

const app = (): HTMLElement => {
  const root = document.getElementById("app");
  if (!root) throw new Error("missing #app");
  return root;
};

export const CEREMONY_HEIGHT = 328;

const SECRET_MASK = "••••••••••••••••••••••••";

type SheetFamily = "ceremony" | "review";

function clear(node: HTMLElement) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { class?: string; text?: string } = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  for (const c of children) node.appendChild(c);
  return node;
}

function shorten(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

const ADDRESS_IN_TEXT = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

function shortenAddresses(text: string): string {
  return text.replace(ADDRESS_IN_TEXT, (a) => shorten(a));
}

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

type DismissOpts = {
  dismissible?: boolean;
  onDismiss?: () => void;
  grabber?: boolean;
  kicker?: string;
  family?: SheetFamily;
};

let escapeHandler: ((e: KeyboardEvent) => void) | null = null;
let busyDismiss: (() => void) | null = null;
let layoutReporter: ((height: number) => void) | null = null;
let layoutObserver: ResizeObserver | null = null;
let lastReportedHeight = -1;
let liveFamily: SheetFamily = "ceremony";
let liveSetBusy: ((message: string | null) => void) | null = null;

export function setLayoutReporter(fn: ((height: number) => void) | null): void {
  layoutReporter = fn;
}

function contentHeight(): number {
  const sheet = app().querySelector<HTMLElement>(".sheet");
  if (!sheet) return 0;
  const sheetStyles = getComputedStyle(sheet);
  let h = (parseFloat(sheetStyles.paddingTop) || 0) + (parseFloat(sheetStyles.paddingBottom) || 0);
  for (const child of Array.from(sheet.children) as HTMLElement[]) {
    const cs = getComputedStyle(child);
    h += (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    h += child.classList.contains("body")
      ? child.scrollHeight
      : child.getBoundingClientRect().height;
  }
  return Math.ceil(h);
}

function reportLayout(): void {
  if (!layoutReporter) return;
  const h = liveFamily === "ceremony" ? CEREMONY_HEIGHT : Math.max(contentHeight(), 1);
  if (h === lastReportedHeight) return;
  lastReportedHeight = h;
  layoutReporter(h);
}

function observeSheet(sheet: HTMLElement): void {
  layoutObserver?.disconnect();
  lastReportedHeight = -1;
  if (typeof ResizeObserver === "undefined") {
    reportLayout();
    return;
  }
  layoutObserver = new ResizeObserver(() => reportLayout());
  layoutObserver.observe(sheet);
  for (const child of sheet.children) {
    layoutObserver.observe(child);
  }
  const body = sheet.querySelector(".body");
  if (body) {
    for (const child of body.children) {
      layoutObserver.observe(child);
    }
  }
  reportLayout();
  requestAnimationFrame(() => reportLayout());
}

function detachEscape() {
  if (escapeHandler) {
    window.removeEventListener("keydown", escapeHandler);
    escapeHandler = null;
  }
}

function requestDismiss(fallback?: () => void): void {
  detachEscape();
  if (busyDismiss) {
    const fn = busyDismiss;
    busyDismiss = null;
    fn();
    return;
  }
  fallback?.();
}

function button(
  label: string,
  variant: "primary" | "ghost" | "danger",
  onClick: () => void,
): HTMLButtonElement {
  const b = el("button", { class: `btn btn-${variant}`, text: label });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function mountSheet(
  title: string,
  body: HTMLElement,
  actions: Node[],
  opts: DismissOpts = {},
): void {
  const root = app();
  clear(root);
  detachEscape();
  liveSetBusy = null;

  const family: SheetFamily = opts.family ?? "ceremony";
  liveFamily = family;
  busyDismiss = null;

  const sheet = el("div", { class: `sheet sheet-${family}` });
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "ss-title");
  if (opts.grabber) {
    sheet.appendChild(el("div", { class: "grabber" }));
  }

  const header = el("div", { class: "sheet-header" });
  const heading = el("div", { class: "sheet-heading" });
  if (opts.kicker) {
    heading.appendChild(el("p", { class: "kicker", text: opts.kicker }));
  }
  const h1 = el("h1", { class: "title", text: title });
  h1.id = "ss-title";
  heading.appendChild(h1);
  header.appendChild(heading);
  sheet.appendChild(header);

  const busyCopy = el("p", { class: "muted sheet-busy-copy" });
  busyCopy.hidden = true;
  body.appendChild(busyCopy);
  sheet.appendChild(body);

  if (actions.length) {
    sheet.appendChild(el("div", { class: "actions" }, actions));
  }

  if (opts.dismissible && opts.onDismiss) {
    const fallback = opts.onDismiss;
    escapeHandler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      requestDismiss(fallback);
    };
    window.addEventListener("keydown", escapeHandler);
  }

  liveSetBusy = (message) => {
    const intros = body.querySelectorAll("p.muted:not(.sheet-busy-copy)");
    const primaries = sheet.querySelectorAll<HTMLButtonElement>(".btn-primary, .btn-danger");
    if (!message) {
      sheet.classList.remove("is-busy");
      busyCopy.hidden = true;
      busyCopy.textContent = "";
      for (const p of intros) (p as HTMLElement).hidden = false;
      for (const b of primaries) b.disabled = false;
      reportLayout();
      return;
    }
    sheet.classList.add("is-busy");
    busyCopy.hidden = false;
    busyCopy.textContent = message;
    for (const p of intros) (p as HTMLElement).hidden = true;
    for (const b of primaries) b.disabled = true;
    reportLayout();
  };

  root.appendChild(sheet);
  observeSheet(sheet);
}

function confirmScreen(
  title: string,
  bodyNodes: Node[],
  actions: Node[],
  opts: DismissOpts = {},
): void {
  mountSheet(title, el("div", { class: "body" }, bodyNodes), actions, opts);
}

function promptChoice<T>(args: {
  title: string;
  body: Node[];
  primary: { label: string; value: T; variant?: "primary" | "danger" };
  secondary?: { label: string; value: T };
  cancelValue: T;
  family?: SheetFamily;
  kicker?: string;
}): Promise<T> {
  return new Promise((resolve) => {
    const done = (v: T) => {
      detachEscape();
      resolve(v);
    };
    const actions: Node[] = [
      button(args.primary.label, args.primary.variant ?? "primary", () => done(args.primary.value)),
    ];
    if (args.secondary) {
      actions.push(
        button(args.secondary.label, "ghost", () =>
          requestDismiss(() => done(args.secondary!.value)),
        ),
      );
    }
    const opts: DismissOpts = {
      dismissible: true,
      onDismiss: () => done(args.cancelValue),
      family: args.family ?? "ceremony",
    };
    if (args.kicker) opts.kicker = args.kicker;
    confirmScreen(args.title, args.body, actions, opts);
  });
}

export type GestureStart<T> = { ok: true; started: T } | { ok: false };

function promptChoiceWithGesture<T>(args: {
  title: string;
  body: Node[];
  primaryLabel: string;
  primaryVariant?: "primary" | "danger";
  secondaryLabel?: string;
  kicker?: string;
  family?: SheetFamily;
  onPrimary: () => T;
}): Promise<GestureStart<T>> {
  return new Promise((resolve) => {
    const done = (v: GestureStart<T>) => {
      detachEscape();
      resolve(v);
    };
    const actions: Node[] = [
      button(args.primaryLabel, args.primaryVariant ?? "primary", () => {
        done({ ok: true, started: args.onPrimary() });
      }),
    ];
    if (args.secondaryLabel) {
      actions.push(
        button(args.secondaryLabel, "ghost", () => requestDismiss(() => done({ ok: false }))),
      );
    }
    const opts: DismissOpts = {
      dismissible: true,
      onDismiss: () => done({ ok: false }),
      family: args.family ?? "ceremony",
    };
    if (args.kicker) opts.kicker = args.kicker;
    confirmScreen(args.title, args.body, actions, opts);
  });
}

export function renderIdle(): void {
  busyDismiss = null;
  liveSetBusy = null;
  detachEscape();
  clear(app());
  liveFamily = "ceremony";
  lastReportedHeight = -1;
  layoutReporter?.(CEREMONY_HEIGHT);
}

export function setBusyDismiss(handler: (() => void) | null): void {
  busyDismiss = handler;
}

export function setCeremonyBusy(message: string | null): void {
  if (liveSetBusy) {
    liveSetBusy(message);
    return;
  }
  if (!message) return;
  confirmScreen("Waiting", [el("p", { class: "muted", text: message })], [], {
    family: "ceremony",
  });
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
