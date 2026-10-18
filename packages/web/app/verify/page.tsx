import { VerifyPanel } from "@/components/VerifyPanel";
import { ctx } from "@/lib/server";

export const dynamic = "force-dynamic";

export default function Verify() {
  return <VerifyPanel artistPubkey={ctx().artist.publicKey} />;
}
