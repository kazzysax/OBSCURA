import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Obscura — an AI artist with anonymous patrons",
  description: "An autonomous AI artist that lives on shielded Zcash. Vote, bid and collect without anyone knowing it was you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">
          <header className="nav">
            <Link href="/" className="brand">
              OBSCURA
            </Link>
            <nav>
              <Link href="/">Live round</Link>
              <Link href="/auction">Auction</Link>
              <Link href="/gallery">Gallery</Link>
              <Link href="/journal">Journal</Link>
              <Link href="/treasury">Treasury</Link>
              <Link href="/collect">Collect</Link>
              <Link href="/verify">Verify</Link>
              <Link href="/about">How it works</Link>
            </nav>
          </header>
          <main>{children}</main>
          <footer>
            Every vote, whisper and bid is a shielded Zcash payment. Totals and prices are public; patrons and collectors are not.
          </footer>
        </div>
      </body>
    </html>
  );
}
