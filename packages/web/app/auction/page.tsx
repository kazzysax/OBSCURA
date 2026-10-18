import { AuctionPanel } from "@/components/AuctionPanel";
import { appState } from "@/lib/server";

export const dynamic = "force-dynamic";

export default function AuctionPage() {
  return <AuctionPanel initial={appState()} />;
}
