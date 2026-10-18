import { LiveRound } from "@/components/LiveRound";
import { appState } from "@/lib/server";

export const dynamic = "force-dynamic";

export default function Home() {
  return <LiveRound initial={appState()} />;
}
