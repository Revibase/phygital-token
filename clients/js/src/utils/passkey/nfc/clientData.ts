// Vendored from @revibase/ctap2-js.
interface CollectedClientDataInput {
  challenge: string;
  origin: string;
  crossOrigin: boolean;
  topOrigin?: string;
}

export function buildCollectedClientDataJSON(
  type: "webauthn.get" | "webauthn.create",
  input: CollectedClientDataInput,
): string {
  const o: Record<string, unknown> = {
    type,
    challenge: input.challenge,
    origin: input.origin,
  };
  if (input.crossOrigin !== undefined) {
    o.crossOrigin = input.crossOrigin;
  }
  if (input.topOrigin !== undefined) {
    o.topOrigin = input.topOrigin;
  }
  return JSON.stringify(o);
}
