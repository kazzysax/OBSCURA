import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { ctx } from "@/lib/server";

export const dynamic = "force-dynamic";

const PREVIEW_MARK = `<g opacity=".55"><rect x="0" y="940" width="1024" height="84" fill="#000"/><text x="512" y="993" text-anchor="middle" font-family="Georgia, serif" font-size="30" letter-spacing="10" fill="#fff">OBSCURA · PREVIEW</text></g>`;

/** Public preview images. The clean original is only released through a claim. */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const { config, store } = ctx();
  const rel = path.join("/");
  if (!/^r\d{4,}\/[a-h]\.svg$/.test(rel)) return new Response("not found", { status: 404 });
  const file = resolve(config.generatedDir, rel);
  if (!file.startsWith(resolve(config.generatedDir) + sep)) return new Response("not found", { status: 404 });
  const [roundId] = rel.split("/");
  const cand = store.candidates(roundId!).find((c) => c.imageFile === rel);
  if (!cand) return new Response("not found", { status: 404 });
  const svg = readFileSync(file, "utf8").replace(/<\/svg>\s*$/, PREVIEW_MARK + "</svg>\n");
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } });
}
