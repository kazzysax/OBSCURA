// Ed25519 signatures, RFC 8785 canonical JSON, certificates and challenges (docs/PROTOCOL.md §4–6).
import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { MEMO_PREFIX } from "./memo.ts";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export { bytesToHex, hexToBytes };

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * RFC 8785 (JCS) canonical JSON for the value types we sign:
 * strings, safe integers, booleans, null, arrays, objects. Floats are rejected.
 */
export function canonicalJson(value: Json): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("canonicalJson: only safe integers are supported");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  // JCS sorts keys by UTF-16 code units, which is JS's default string sort.
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k]!)).join(",") + "}";
}

export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === "string" ? new TextEncoder().encode(data) : data));
}

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateKeyPair(): KeyPair {
  const priv = ed.utils.randomPrivateKey();
  return { privateKey: bytesToHex(priv), publicKey: bytesToHex(ed.getPublicKey(priv)) };
}

export function publicKeyOf(privateKeyHex: string): string {
  return bytesToHex(ed.getPublicKey(hexToBytes(privateKeyHex)));
}

export function signMessage(message: string, privateKeyHex: string): string {
  return bytesToHex(ed.sign(new TextEncoder().encode(message), hexToBytes(privateKeyHex)));
}

export function verifyMessage(message: string, signatureHex: string, publicKeyHex: string): boolean {
  try {
    return ed.verify(hexToBytes(signatureHex), new TextEncoder().encode(message), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

// --- Certificates --------------------------------------------------------------

export interface ProvenanceCertificate {
  type: "obscura.provenance.v0";
  piece_id: string;
  round_id: string;
  auction_id: string;
  price_zat: number;
  claim_pubkey: string;
  image_sha256: string;
  artist_pubkey: string;
  artist_sig: string;
}

export interface BadgeCertificate {
  type: "obscura.badge.v0";
  round_id: string;
  candidate_id: string;
  won: boolean;
  patron_pubkey: string;
  artist_pubkey: string;
  artist_sig: string;
}

export type Certificate = ProvenanceCertificate | BadgeCertificate;

function unsignedBytes(cert: Record<string, Json>): string {
  const { artist_sig: _sig, ...rest } = cert;
  return canonicalJson(rest);
}

export function signCertificate<T extends Certificate>(
  body: Omit<T, "artist_sig" | "artist_pubkey">,
  artistPrivateKeyHex: string,
): T {
  const withKey = { ...body, artist_pubkey: publicKeyOf(artistPrivateKeyHex) } as unknown as Record<string, Json>;
  const artist_sig = signMessage(unsignedBytes(withKey), artistPrivateKeyHex);
  return { ...withKey, artist_sig } as unknown as T;
}

/** Verify a certificate. Pass the artist's known public key; a cert claiming another key fails. */
export function verifyCertificate(cert: Certificate, artistPublicKeyHex: string): boolean {
  if (cert.artist_pubkey !== artistPublicKeyHex) return false;
  return verifyMessage(unsignedBytes(cert as unknown as Record<string, Json>), cert.artist_sig, artistPublicKeyHex);
}

// --- Challenges ----------------------------------------------------------------

export type ChallengeKind = "claim" | "badge";

export function newNonce(): string {
  return bytesToHex(randomBytes(16));
}

/** `obscura:v0:claim:<auction_id>:<nonce>` or `obscura:v0:badge:<round_id>:<nonce>`. */
export function challengeString(kind: ChallengeKind, id: string, nonce: string): string {
  return `${MEMO_PREFIX}${kind}:${id}:${nonce}`;
}
