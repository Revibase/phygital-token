/** DOM builders for the trusted UI. Text only: nothing here sets innerHTML. */

export const app = (): HTMLElement => {
  const root = document.getElementById("app");
  if (!root) throw new Error("missing #app");
  return root;
};

export function clear(node: HTMLElement) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function el<K extends keyof HTMLElementTagNameMap>(
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

export function shorten(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

const ADDRESS_IN_TEXT = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

export function shortenAddresses(text: string): string {
  return text.replace(ADDRESS_IN_TEXT, (a) => shorten(a));
}

export function button(
  label: string,
  variant: "primary" | "ghost" | "danger",
  onClick: () => void,
): HTMLButtonElement {
  const b = el("button", { class: `btn btn-${variant}`, text: label });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}
