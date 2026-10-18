"use client";
// Keys a patron or bidder generated in this browser. Stored only in this browser; the server never
// sees a private key. Losing the key means losing the ability to claim — so we also offer a download.
import { generateKeyPair } from "@obscura/core";

export type KeyKind = "patron" | "bidder";

export interface StoredKey {
  kind: KeyKind;
  /** round id for patrons, auction id for bidders */
  target: string;
  publicKey: string;
  privateKey: string;
  createdAt: string;
  label?: string;
}

const STORAGE = "obscura.keys.v0";

export function loadKeys(): StoredKey[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? "[]") as StoredKey[];
  } catch {
    return [];
  }
}

export function saveKey(k: StoredKey): void {
  try {
    const all = loadKeys().filter((x) => x.publicKey !== k.publicKey);
    localStorage.setItem(STORAGE, JSON.stringify([...all, k]));
  } catch {
    // Storage blocked (private window etc.): the download is the backup.
  }
}

export function newKey(kind: KeyKind, target: string, label?: string): StoredKey {
  const kp = generateKeyPair();
  return { kind, target, ...kp, createdAt: new Date().toISOString(), label };
}

export function downloadKey(k: StoredKey): void {
  const blob = new Blob([JSON.stringify(k, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `obscura-${k.kind}-${k.target}-${k.publicKey.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function parseKeyFile(text: string): StoredKey | null {
  try {
    const k = JSON.parse(text) as StoredKey;
    if (/^[0-9a-f]{64}$/.test(k.privateKey) && /^[0-9a-f]{64}$/.test(k.publicKey)) return k;
  } catch {
    // fall through
  }
  return null;
}
