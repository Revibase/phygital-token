export function jsonStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, current) => (typeof current === "bigint" ? current.toString() : current),
    2,
  );
}

export function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

export function jsonResult(value: unknown) {
  return textResult(jsonStringify(value));
}
