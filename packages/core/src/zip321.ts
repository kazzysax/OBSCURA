// ZIP-321 payment request URIs (single payment).
import { ZAT_PER_ZEC, type Zat } from "./types.ts";

/** Format zatoshis as a ZIP-321 decimal ZEC amount (no exponent, ≤ 8 decimals, no trailing zeros). */
export function formatZec(zat: Zat): string {
  if (!Number.isSafeInteger(zat) || zat < 0) throw new Error("bad amount");
  const whole = Math.floor(zat / ZAT_PER_ZEC);
  const frac = String(zat % ZAT_PER_ZEC).padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

export function parseZec(s: string): Zat {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(s);
  if (!m) throw new Error("bad ZEC amount");
  return Number(m[1]) * ZAT_PER_ZEC + Number((m[2] ?? "").padEnd(8, "0"));
}

export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
}

// ZIP-321 qchar: unreserved / pct-encoded / "!$'()*,;:@" (no "&", "=", "+").
function encodeQchar(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export interface PaymentRequest {
  address: string;
  amountZat?: Zat;
  memo?: string;
  label?: string;
  message?: string;
}

export function buildPaymentUri(req: PaymentRequest): string {
  const params: string[] = [];
  if (req.amountZat !== undefined) params.push(`amount=${formatZec(req.amountZat)}`);
  if (req.memo !== undefined) params.push(`memo=${base64url(new TextEncoder().encode(req.memo))}`);
  if (req.label) params.push(`label=${encodeQchar(req.label)}`);
  if (req.message) params.push(`message=${encodeQchar(req.message)}`);
  return `zcash:${req.address}${params.length ? "?" + params.join("&") : ""}`;
}

export function parsePaymentUri(uri: string): PaymentRequest {
  const m = /^zcash:([^?]+)(?:\?(.*))?$/.exec(uri);
  if (!m) throw new Error("not a zcash: URI");
  const req: PaymentRequest = { address: m[1]! };
  for (const kv of (m[2] ?? "").split("&").filter(Boolean)) {
    const [k, v = ""] = kv.split("=", 2) as [string, string?];
    if (k === "amount") req.amountZat = parseZec(v);
    else if (k === "memo") req.memo = new TextDecoder().decode(fromBase64url(v));
    else if (k === "label") req.label = decodeURIComponent(v);
    else if (k === "message") req.message = decodeURIComponent(v);
  }
  return req;
}
