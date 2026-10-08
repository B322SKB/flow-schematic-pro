/**
 * Smart routing ortogonal: generează candidați H/V, V/H, H/V/H, V/H/V (cu decalări) și alege
 * traseul cu scorul minim: lungime + coturi + traversări de echipamente + intersecții cu alte conducte.
 * Rezultatul este scris doar ca puncte intermediare (pipe.points) printr-o acțiune explicită (undo-abilă).
 */
import { pipeRoute, portPos } from "./hydraulics";
import { getSymbol } from "./symbols";
import type { Pipe, Scheme } from "./types";

type Pt = { x: number; y: number };

function boxes(s: Scheme, skip: Set<string>) {
  return s.nodes.filter((n) => !skip.has(n.id) && n.type !== "port_open").map((n) => {
    const sym = getSymbol(n.type);
    const rot = ((n.rotation % 180) + 180) % 180 === 90;
    const w = (rot ? sym.h : sym.w) / 2 + 6, h = (rot ? sym.w : sym.h) / 2 + 6;
    return { x1: n.x - w, x2: n.x + w, y1: n.y - h, y2: n.y + h };
  });
}

function segHitsBox(a: Pt, b: Pt, r: { x1: number; x2: number; y1: number; y2: number }) {
  const minx = Math.min(a.x, b.x), maxx = Math.max(a.x, b.x), miny = Math.min(a.y, b.y), maxy = Math.max(a.y, b.y);
  return maxx > r.x1 && minx < r.x2 && maxy > r.y1 && miny < r.y2;
}

function segCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const h1 = Math.abs(a.y - b.y) < 1, h2 = Math.abs(c.y - d.y) < 1;
  if (h1 === h2) return false;
  const [H0, H1, V0, V1] = h1 ? [a, b, c, d] : [c, d, a, b];
  const x = V0.x, y = H0.y;
  return x > Math.min(H0.x, H1.x) && x < Math.max(H0.x, H1.x) && y > Math.min(V0.y, V1.y) && y < Math.max(V0.y, V1.y);
}

export function routeScore(pts: Pt[], s: Scheme, pipe: Pipe) {
  const obstacles = boxes(s, new Set([pipe.from.node, pipe.to.node]));
  let len = 0, hits = 0, cross = 0;
  const others = s.pipes.filter((p) => p.id !== pipe.id && !p.direct).map((p) => pipeRoute(p, s));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    len += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    for (const r of obstacles) if (segHitsBox(a, b, r)) hits++;
    for (const o of others) for (let j = 1; j < o.length; j++) if (segCross(a, b, o[j - 1]!, o[j]!)) cross++;
  }
  return len + (pts.length - 2) * 30 + hits * 2000 + cross * 150;
}

/** Candidații de traseu ortogonal între două porturi. */
export function routeCandidates(a: Pt, b: Pt): Pt[][] {
  const out: Pt[][] = [];
  if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) out.push([a, b]);
  out.push([a, { x: b.x, y: a.y }, b], [a, { x: a.x, y: b.y }, b]);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  for (const off of [0, -80, 80, -160, 160, -240, 240]) {
    out.push([a, { x: mx + off, y: a.y }, { x: mx + off, y: b.y }, b]);
    out.push([a, { x: a.x, y: my + off }, { x: b.x, y: my + off }, b]);
  }
  // ocolire largă (stub + canal paralel)
  for (const off of [-120, 120]) {
    out.push([a, { x: a.x + Math.sign(b.x - a.x || 1) * 30, y: a.y }, { x: a.x + Math.sign(b.x - a.x || 1) * 30, y: Math.min(a.y, b.y) + off }, { x: b.x, y: Math.min(a.y, b.y) + off }, b]);
  }
  return out;
}

/** Cel mai bun traseu; întoarce punctele intermediare sau undefined (traseul automat implicit este deja optim). */
export function smartRoute(s: Scheme, pipe: Pipe): { points: Pt[] | undefined; score: number; current: number } {
  const a = portPos(s, pipe.from.node, pipe.from.port), b = portPos(s, pipe.to.node, pipe.to.port);
  const current = routeScore(pipeRoute(pipe, s), s, pipe);
  if (!a || !b || pipe.direct) return { points: pipe.points, score: current, current };
  let best: Pt[] | null = null, bs = Infinity;
  for (const c of routeCandidates(a, b)) {
    const sc = routeScore(c, s, pipe);
    if (sc < bs - 1e-6) { bs = sc; best = c; }
  }
  if (!best || bs >= current) return { points: pipe.points, score: current, current };
  const mid = best.slice(1, -1);
  return { points: mid.length ? mid : undefined, score: bs, current };
}

/** Rerutează conductele date; doar cele care se îmbunătățesc își schimbă geometria. */
export function rerouteMany(s: Scheme, pipeIds: string[]): { scheme: Scheme; changed: string[] } {
  let cur = s;
  const changed: string[] = [];
  for (const id of pipeIds) {
    const p = cur.pipes.find((x) => x.id === id);
    if (!p || p.direct) continue;
    const r = smartRoute(cur, p);
    if (r.score < r.current) {
      cur = { ...cur, pipes: cur.pipes.map((x) => (x.id === id ? { ...x, points: r.points, routing: "auto" as const } : x)) };
      changed.push(id);
    }
  }
  return { scheme: cur, changed };
}
