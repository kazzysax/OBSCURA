// Unified Address decoding/encoding (ZIP-316), enough to check receivers.
import { bech32mDecode, bech32mEncode } from "./bech32m.ts";
import { f4jumble, f4jumbleInv } from "./f4jumble.ts";
import type { Network } from "./types.ts";

export const UA_HRP: Record<Network, string> = { mainnet: "u", testnet: "utest" };

export const TYPECODE = { p2pkh: 0x00, p2sh: 0x01, sapling: 0x02, orchard: 0x03 } as const;

export interface UaReceiver {
  typecode: number;
  data: Uint8Array;
}

export interface DecodedUa {
  network: Network;
  receivers: UaReceiver[];
}

function readCompactSize(buf: Uint8Array, pos: number): [number, number] | null {
  const first = buf[pos];
  if (first === undefined) return null;
  if (first < 0xfd) return [first, pos + 1];
  if (first === 0xfd) {
    if (pos + 3 > buf.length) return null;
    const v = buf[pos + 1]! | (buf[pos + 2]! << 8);
    return v < 0xfd ? null : [v, pos + 3];
  }
  if (first === 0xfe) {
    if (pos + 5 > buf.length) return null;
    const v = (buf[pos + 1]! | (buf[pos + 2]! << 8) | (buf[pos + 3]! << 16)) + buf[pos + 4]! * 2 ** 24;
    return v <= 0xffff ? null : [v, pos + 5];
  }
  return null; // 8-byte sizes never occur in a UA
}

function writeCompactSize(n: number): number[] {
  if (n < 0xfd) return [n];
  if (n <= 0xffff) return [0xfd, n & 0xff, n >> 8];
  throw new Error("compactsize too large");
}

function hrpPadding(hrp: string): Uint8Array {
  const p = new Uint8Array(16);
  p.set(new TextEncoder().encode(hrp));
  return p;
}

/** Decode a Unified Address. Returns null if it isn't a well-formed UA. */
export function decodeUa(addr: string): DecodedUa | null {
  const dec = bech32mDecode(addr);
  if (!dec) return null;
  const network = (Object.keys(UA_HRP) as Network[]).find((n) => UA_HRP[n] === dec.hrp);
  if (!network) return null;
  let raw: Uint8Array;
  try {
    raw = f4jumbleInv(dec.bytes);
  } catch {
    return null;
  }
  const pad = hrpPadding(dec.hrp);
  const tail = raw.subarray(raw.length - 16);
  for (let i = 0; i < 16; i++) if (tail[i] !== pad[i]) return null;
  const body = raw.subarray(0, raw.length - 16);

  const receivers: UaReceiver[] = [];
  let pos = 0;
  while (pos < body.length) {
    const tc = readCompactSize(body, pos);
    if (!tc) return null;
    const len = readCompactSize(body, tc[1]);
    if (!len) return null;
    const end = len[1] + len[0];
    if (end > body.length) return null;
    receivers.push({ typecode: tc[0], data: body.slice(len[1], end) });
    pos = end;
  }
  // ZIP-316: typecodes strictly ascending, at least one shielded receiver, not both p2pkh and p2sh.
  for (let i = 1; i < receivers.length; i++) {
    if (receivers[i]!.typecode <= receivers[i - 1]!.typecode) return null;
  }
  const codes = new Set(receivers.map((r) => r.typecode));
  if (codes.has(TYPECODE.p2pkh) && codes.has(TYPECODE.p2sh)) return null;
  if (receivers.length === 0 || [...codes].every((c) => c === TYPECODE.p2pkh || c === TYPECODE.p2sh)) return null;
  return { network, receivers };
}

export function encodeUa(network: Network, receivers: UaReceiver[]): string {
  const sorted = [...receivers].sort((a, b) => a.typecode - b.typecode);
  const body: number[] = [];
  for (const r of sorted) body.push(...writeCompactSize(r.typecode), ...writeCompactSize(r.data.length), ...r.data);
  const hrp = UA_HRP[network];
  const raw = Uint8Array.from([...body, ...hrpPadding(hrp)]);
  return bech32mEncode(hrp, f4jumble(raw));
}

export function hasOrchardReceiver(addr: string, network?: Network): boolean {
  const ua = decodeUa(addr);
  if (!ua || (network && ua.network !== network)) return false;
  return ua.receivers.some((r) => r.typecode === TYPECODE.orchard && r.data.length === 43);
}

export function isOrchardOnly(addr: string, network?: Network): boolean {
  const ua = decodeUa(addr);
  if (!ua || (network && ua.network !== network)) return false;
  return ua.receivers.length === 1 && ua.receivers[0]!.typecode === TYPECODE.orchard;
}
