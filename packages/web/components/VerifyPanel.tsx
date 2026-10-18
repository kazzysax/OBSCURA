"use client";
import { useState } from "react";
import { sha256Hex, verifyCertificate, type Certificate } from "@obscura/core";

export function VerifyPanel({ artistPubkey }: { artistPubkey: string }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [imageCheck, setImageCheck] = useState<string | null>(null);
  const [pubkey, setPubkey] = useState(artistPubkey);

  const check = () => {
    try {
      const cert = JSON.parse(text) as Certificate;
      const ok = verifyCertificate(cert, pubkey.trim());
      setResult({
        ok,
        msg: ok
          ? cert.type === "obscura.provenance.v0"
            ? `Valid. ${cert.piece_id} was sold in ${cert.auction_id} for ${cert.price_zat / 1e8} ZEC to the holder of key ${cert.claim_pubkey.slice(0, 12)}…`
            : `Valid patron badge for ${cert.round_id}, piece ${cert.candidate_id}${cert.won ? " (the winner)" : ""}.`
          : "Not valid for this artist key. Something was changed, or it was signed by someone else.",
      });
    } catch {
      setResult({ ok: false, msg: "That isn't JSON." });
    }
  };

  const hashImage = async (file: File | undefined) => {
    if (!file) return;
    const h = sha256Hex(new Uint8Array(await file.arrayBuffer()));
    let match = "";
    try {
      const cert = JSON.parse(text);
      if (cert.image_sha256) match = cert.image_sha256 === h ? " — matches the certificate." : " — does NOT match the certificate.";
    } catch {
      // no certificate pasted
    }
    setImageCheck(`sha256 ${h}${match}`);
  };

  return (
    <section className="stack" style={{ maxWidth: 760 }}>
      <h1>Verify</h1>
      <p className="muted">Check a provenance certificate or patron badge. Everything runs in your browser.</p>
      <div>
        <label>Artist public key</label>
        <input className="mono" value={pubkey} onChange={(e) => setPubkey(e.target.value)} />
      </div>
      <div>
        <label>Certificate or badge (JSON)</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} />
      </div>
      <div className="row">
        <button className="primary" onClick={check}>
          Verify signature
        </button>
        <label className="btn" style={{ margin: 0 }}>
          Check an image file
          <input type="file" style={{ display: "none" }} onChange={(e) => hashImage(e.target.files?.[0])} />
        </label>
      </div>
      {result && <div className={result.ok ? "ok" : "warn"}>{result.msg}</div>}
      {imageCheck && <code className="small">{imageCheck}</code>}
    </section>
  );
}
