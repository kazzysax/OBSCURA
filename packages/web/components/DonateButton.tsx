"use client";
import { useState } from "react";
import { PayDialog } from "./PayDialog";

export function DonateButton({ address, mock }: { address: string; mock: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="primary" onClick={() => setOpen(true)} style={{ alignSelf: "flex-start" }}>
        Keep the artist alive
      </button>
      {open && (
        <PayDialog
          spec={{ title: "Donate to the treasury", address, amountZat: 10_000_000, memo: "obscura: for the artist", label: "Obscura treasury" }}
          mock={mock}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
