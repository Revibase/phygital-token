/**
 * The sheet every screen renders into, and the only module-level UI state:
 * dismissal, the busy indicator and height reporting to the parent page.
 */
import { app, button, clear, el } from "./dom.js";

export const CEREMONY_HEIGHT = 328;

type SheetFamily = "ceremony" | "review";

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

export function reportLayout(): void {
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

export function detachEscape() {
  if (escapeHandler) {
    window.removeEventListener("keydown", escapeHandler);
    escapeHandler = null;
  }
}

export function requestDismiss(fallback?: () => void): void {
  detachEscape();
  if (busyDismiss) {
    const fn = busyDismiss;
    busyDismiss = null;
    fn();
    return;
  }
  fallback?.();
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

export function confirmScreen(
  title: string,
  bodyNodes: Node[],
  actions: Node[],
  opts: DismissOpts = {},
): void {
  mountSheet(title, el("div", { class: "body" }, bodyNodes), actions, opts);
}

export function promptChoice<T>(args: {
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

export function promptChoiceWithGesture<T>(args: {
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
