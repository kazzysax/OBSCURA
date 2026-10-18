// Generative SVG renderer: the default image provider. Deterministic for a given seed, so the
// image hash in a provenance certificate can be recomputed by anyone with the same inputs.
import type { SurvivalState } from "@obscura/core";
import type { Motif } from "./brain.ts";

export interface RenderInput {
  seed: string;
  motif: Motif;
  palette: string[];
  survival: SurvivalState;
  title: string;
}

export interface ImageOutput {
  bytes: Uint8Array;
  mime: string;
  ext: string;
}

export interface ImageGenerator {
  readonly name: string;
  generate(input: RenderInput & { concept: string }): Promise<ImageOutput>;
}

const S = 1024;

function prng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** How many marks to make: struggling art is sparse. */
function density(s: SurvivalState): number {
  return { thriving: 1, steady: 0.75, struggling: 0.35, dormant: 0.15 }[s];
}

function background(p: string[], r: () => number): string {
  const angle = Math.floor(r() * 360);
  return `<defs>
  <linearGradient id="bg" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${p[0]}"/><stop offset="1" stop-color="${p[1] ?? p[0]}" stop-opacity=".85"/></linearGradient>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${Math.floor(r() * 999)}"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .07 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
  <filter id="soft"><feGaussianBlur stdDeviation="${f(6 + r() * 18)}"/></filter>
</defs>
<rect width="${S}" height="${S}" fill="url(#bg)"/>`;
}

type Painter = (p: string[], r: () => number, d: number) => string;

const painters: Record<Motif, Painter> = {
  horizon(p, r, d) {
    const y = S * (0.45 + r() * 0.2);
    let out = `<rect y="${f(y)}" width="${S}" height="${f(S - y)}" fill="${p[2] ?? p[1]}" opacity=".55"/>`;
    out += `<circle cx="${f(S * (0.2 + r() * 0.6))}" cy="${f(y - 40 - r() * 160)}" r="${f(40 + r() * 120)}" fill="${p[3] ?? p[2]}" opacity=".9"/>`;
    const n = Math.ceil(40 * d);
    for (let i = 0; i < n; i++) {
      const yy = y + 8 + i * ((S - y) / n);
      out += `<line x1="${f(r() * S * 0.3)}" x2="${f(S - r() * S * 0.3)}" y1="${f(yy)}" y2="${f(yy)}" stroke="${p[3] ?? p[1]}" stroke-width="${f(1 + r() * 3)}" opacity="${f(0.15 + r() * 0.4)}"/>`;
    }
    return out;
  },
  orbits(p, r, d) {
    const cx = S / 2 + (r() - 0.5) * 200;
    const cy = S / 2 + (r() - 0.5) * 200;
    let out = "";
    const n = Math.ceil(18 * d);
    for (let i = 0; i < n; i++) {
      const rx = 60 + i * (420 / n) + r() * 30;
      out += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(rx * (0.3 + r() * 0.5))}" transform="rotate(${f(r() * 180)} ${f(cx)} ${f(cy)})" fill="none" stroke="${p[2 + (i % 2)] ?? p[1]}" stroke-width="${f(1 + r() * 2.5)}" opacity="${f(0.3 + r() * 0.6)}"/>`;
      const a = r() * Math.PI * 2;
      out += `<circle cx="${f(cx + Math.cos(a) * rx)}" cy="${f(cy + Math.sin(a) * rx * 0.5)}" r="${f(3 + r() * 10)}" fill="${p[3] ?? p[2]}"/>`;
    }
    return out;
  },
  fog(p, r, d) {
    let out = `<g filter="url(#soft)">`;
    const n = Math.ceil(14 * d) + 2;
    for (let i = 0; i < n; i++)
      out += `<ellipse cx="${f(r() * S)}" cy="${f(S * 0.3 + r() * S * 0.7)}" rx="${f(150 + r() * 350)}" ry="${f(40 + r() * 90)}" fill="${p[2] ?? p[1]}" opacity="${f(0.15 + r() * 0.35)}"/>`;
    out += `</g>`;
    const x = S * (0.25 + r() * 0.5);
    out += `<rect x="${f(x - 14)}" y="${f(S * 0.38)}" width="28" height="${f(S * 0.32)}" fill="${p[0]}" opacity=".85"/>`;
    out += `<polygon points="${f(x)},${f(S * 0.4)} ${f(x - 600)},${f(S * 0.3)} ${f(x - 600)},${f(S * 0.5)}" fill="${p[3] ?? p[2]}" opacity="${f(0.12 + d * 0.15)}"/>`;
    out += `<circle cx="${f(x)}" cy="${f(S * 0.4)}" r="10" fill="${p[3] ?? "#fff"}"/>`;
    return out;
  },
  grid(p, r, d) {
    let out = "";
    const cells = 8 + Math.floor(r() * 6);
    const c = S / cells;
    for (let i = 0; i < cells; i++)
      for (let j = 0; j < cells; j++) {
        if (r() > 0.25 + 0.6 * d) continue;
        const fill = p[1 + Math.floor(r() * (p.length - 1))]!;
        const inset = 4 + r() * c * 0.3;
        out += `<rect x="${f(i * c + inset)}" y="${f(j * c + inset)}" width="${f(c - 2 * inset)}" height="${f(c - 2 * inset)}" fill="${fill}" opacity="${f(0.25 + r() * 0.75)}" rx="${f(r() * 6)}"/>`;
      }
    return out;
  },
  tide(p, r, d) {
    let out = "";
    const n = Math.ceil(26 * d) + 3;
    for (let i = 0; i < n; i++) {
      const y0 = S * 0.25 + (i / n) * S * 0.7;
      const amp = 10 + r() * 40;
      const freq = 1 + r() * 3;
      let path = `M0 ${f(y0)}`;
      for (let x = 0; x <= S; x += 32) path += ` L${x} ${f(y0 + Math.sin((x / S) * Math.PI * 2 * freq + i) * amp)}`;
      out += `<path d="${path}" fill="none" stroke="${p[2 + (i % 2)] ?? p[1]}" stroke-width="${f(1.5 + r() * 3)}" opacity="${f(0.25 + r() * 0.6)}"/>`;
    }
    return out;
  },
  constellation(p, r, d) {
    let out = "";
    const n = Math.ceil(70 * d) + 6;
    const pts = Array.from({ length: n }, () => [r() * S, r() * S] as const);
    for (const [x, y] of pts) out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1 + r() * 4)}" fill="${p[3] ?? p[2] ?? "#fff"}" opacity="${f(0.5 + r() * 0.5)}"/>`;
    for (let i = 0; i < Math.ceil(n / 4); i++) {
      const a = pts[Math.floor(r() * n)]!;
      const b = pts[Math.floor(r() * n)]!;
      out += `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${p[2] ?? p[1]}" stroke-width="1" opacity=".35"/>`;
    }
    return out;
  },
  bloom(p, r, d) {
    let out = "";
    const n = Math.ceil(9 * d) + 1;
    for (let k = 0; k < n; k++) {
      const cx = r() * S;
      const cy = r() * S;
      const petals = 5 + Math.floor(r() * 8);
      const len = 40 + r() * 140;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * 360;
        out += `<ellipse cx="${f(cx)}" cy="${f(cy - len / 2)}" rx="${f(len * 0.18)}" ry="${f(len / 2)}" transform="rotate(${f(a)} ${f(cx)} ${f(cy)})" fill="${p[1 + ((k + i) % (p.length - 1))]}" opacity="${f(0.35 + r() * 0.4)}"/>`;
      }
      out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(len * 0.12)}" fill="${p[0]}"/>`;
    }
    return out;
  },
  fracture(p, r, d) {
    let out = "";
    const n = Math.ceil(16 * d) + 3;
    for (let i = 0; i < n; i++) {
      const pts: string[] = [];
      let x = r() * S;
      let y = r() * S;
      for (let k = 0; k < 6; k++) {
        pts.push(`${f(x)},${f(y)}`);
        x += (r() - 0.5) * 300;
        y += (r() - 0.5) * 300;
      }
      out += `<polyline points="${pts.join(" ")}" fill="none" stroke="${p[2 + (i % 2)] ?? p[1]}" stroke-width="${f(1 + r() * 5)}" stroke-linejoin="bevel" opacity="${f(0.4 + r() * 0.5)}"/>`;
      if (r() < 0.4) out += `<polygon points="${pts.slice(0, 3).join(" ")}" fill="${p[1 + (i % (p.length - 1))]}" opacity=".25"/>`;
    }
    return out;
  },
};

export function renderSvg(input: RenderInput): string {
  const r = prng(`${input.seed}:${input.motif}`);
  const p = input.palette.length >= 3 ? input.palette : ["#0d1b2a", "#415a77", "#e0e1dd", "#ffb703"];
  const d = density(input.survival);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
<title>${esc(input.title)}</title>
${background(p, r)}
${painters[input.motif](p, r, d)}
<rect width="${S}" height="${S}" filter="url(#grain)" opacity=".9"/>
</svg>
`;
}

export class SvgGenerator implements ImageGenerator {
  readonly name = "svg";
  async generate(input: RenderInput & { concept: string }): Promise<ImageOutput> {
    return { bytes: new TextEncoder().encode(renderSvg(input)), mime: "image/svg+xml", ext: "svg" };
  }
}
