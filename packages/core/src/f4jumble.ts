// F4Jumble (ZIP-316 §"Jumbling").
import { blake2b } from "@noble/hashes/blake2b.js";

const ELL_H = 64;
const MIN_LEN = 48;
const MAX_LEN = 4194368;

function personal(tag: string, i: number, j?: number): Uint8Array {
  const p = new Uint8Array(16);
  p.set(new TextEncoder().encode(tag));
  p[13] = i;
  if (j === undefined) {
    p[14] = 0;
    p[15] = 0;
  } else {
    p[14] = j & 0xff;
    p[15] = (j >> 8) & 0xff;
  }
  return p;
}

function H(i: number, u: Uint8Array, outLen: number): Uint8Array {
  return blake2b(u, { dkLen: outLen, personalization: personal("UA_F4Jumble_H", i) });
}

function G(i: number, u: Uint8Array, outLen: number): Uint8Array {
  const out = new Uint8Array(outLen);
  const blocks = Math.ceil(outLen / ELL_H);
  for (let j = 0; j < blocks; j++) {
    const h = blake2b(u, { dkLen: ELL_H, personalization: personal("UA_F4Jumble_G", i, j) });
    out.set(h.subarray(0, Math.min(ELL_H, outLen - j * ELL_H)), j * ELL_H);
  }
  return out;
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k]! ^ b[k]!;
  return out;
}

function split(m: Uint8Array): [Uint8Array, Uint8Array] {
  if (m.length < MIN_LEN || m.length > MAX_LEN) throw new Error("f4jumble: invalid length");
  const ellL = Math.min(ELL_H, Math.floor(m.length / 2));
  return [m.slice(0, ellL), m.slice(ellL)];
}

export function f4jumble(m: Uint8Array): Uint8Array {
  const [a, b] = split(m);
  const x = xor(b, G(0, a, b.length));
  const y = xor(a, H(0, x, a.length));
  const d = xor(x, G(1, y, x.length));
  const c = xor(y, H(1, d, y.length));
  return Uint8Array.from([...c, ...d]);
}

export function f4jumbleInv(m: Uint8Array): Uint8Array {
  const [c, d] = split(m);
  const y = xor(c, H(1, d, c.length));
  const x = xor(d, G(1, y, d.length));
  const a = xor(y, H(0, x, y.length));
  const b = xor(x, G(0, a, x.length));
  return Uint8Array.from([...a, ...b]);
}
