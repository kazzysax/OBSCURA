"use client";
// Shows a ZIP-321 payment request (QR + link + memo) for a shielded payment, plus a "simulate"
// button when the site runs on the mock chain.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { buildPaymentUri } from "@obscura/core";
import { zec } from "@/lib/view";

export interface PaymentSpec {
  title: string;
  address: string;
  amountZat: number;
  memo: string;
  label: string;
}

export function PayDialog({ spec, mock, onClose, children }: { spec: PaymentSpec; mock: boolean; onClose: () => void; children?: React.ReactNode }) {
  const uri = buildPaymentUri({ address: spec.address, amountZat: spec.amountZat, memo: spec.memo, label: spec.label });
  const [svg, setSvg] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 0 }).then(setSvg, () => setSvg(""));
  }, [uri]);

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  const simulate = async () => {
    setStatus("sending…");
    const res = await fetch("/api/mock/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: spec.address, valueZat: spec.amountZat, memo: spec.memo }),
    });
    const j = await res.json();
    setStatus(res.ok ? `Sent. It lands in block ${j.height}.` : `Failed: ${j.error}`);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog stack" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={spec.title}>
        <div className="spread">
          <h2>{spec.title}</h2>
          <button onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
        <p className="muted small">
          Scan with a Zcash wallet that supports shielded (Orchard) payments and memos. Send exactly <b>{zec(spec.amountZat, 8)} ZEC</b> with the memo
          below. Nobody, including us, learns who you are.
        </p>
        <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="row" style={{ justifyContent: "center" }}>
          <a className="btn primary" href={uri}>
            Open in wallet
          </a>
          <button onClick={() => copy("uri", uri)}>{copied === "uri" ? "Copied" : "Copy request"}</button>
          <button onClick={() => copy("memo", spec.memo)}>{copied === "memo" ? "Copied" : "Copy memo"}</button>
        </div>
        <div>
          <label>Memo</label>
          <code className="small">{spec.memo}</code>
        </div>
        {mock && (
          <div className="warn">
            Demo mode: this site runs on a simulated chain.{" "}
            <button className="primary" onClick={simulate} style={{ marginLeft: 8 }}>
              Simulate this payment
            </button>
            {status && <div style={{ marginTop: 6 }}>{status}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
