import { fittingK, getMaterial, innerDiameterMm, type FittingId } from "./catalog";
import type { FluidProps } from "./fluids";
import type { Pipe, Scheme } from "./types";
import { SYMBOLS } from "./symbols";

export function colebrook(Re: number, relRough: number) {
  if (Re < 2300) return 64 / Math.max(Re, 1e-9);
  // Swamee-Jain start, then iterate Colebrook-White
  let f = 0.25 / Math.log10(relRough / 3.7 + 5.74 / Re ** 0.9) ** 2;
  for (let i = 0; i < 30; i++) {
    const rhs = -2 * Math.log10(relRough / 3.7 + 2.51 / (Re * Math.sqrt(f)));
    const nf = 1 / (rhs * rhs);
    if (Math.abs(nf - f) < 1e-10) { f = nf; break; }
    f = nf;
  }
  return f;
}

export interface PipeResult {
  id: string;
  tag: string;
  d: number; // m
  v: number; // m/s
  Re: number;
  regime: "laminar" | "tranziție" | "turbulent";
  f: number;
  R: number; // Pa/m
  dpLin: number; // Pa
  Ksum: number;
  dpLoc: number; // Pa
  dpComp: number; // Pa (valves + equipment attributed)
  dpTotal: number;
  velWarn: "low" | "high" | null;
}

export function autoBends(pipe: Pipe, scheme: Scheme): number {
  const pts = pipeRoute(pipe, scheme);
  return Math.max(0, pts.length - 2);
}

export function pipeRoute(pipe: Pipe, scheme: Scheme): { x: number; y: number }[] {
  const a = portPos(scheme, pipe.from.node, pipe.from.port);
  const b = portPos(scheme, pipe.to.node, pipe.to.port);
  if (!a || !b) return [];
  if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return [a, b];
  if (pipe.routing === "vh") return [a, { x: a.x, y: b.y }, b];
  if (pipe.routing === "hv") return [a, { x: b.x, y: a.y }, b];
  const mx = (a.x + b.x) / 2;
  return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
}

export function portPos(scheme: Scheme, nodeId: string, portId: string) {
  const n = scheme.nodes.find((x) => x.id === nodeId);
  if (!n) return null;
  const s = SYMBOLS[n.type];
  const p = s.ports.find((q) => q.id === portId);
  if (!p) return null;
  const rad = (n.rotation * Math.PI) / 180;
  const cx = p.x - s.w / 2, cy = p.y - s.h / 2;
  return {
    x: n.x + cx * Math.cos(rad) - cy * Math.sin(rad),
    y: n.y + cx * Math.sin(rad) + cy * Math.cos(rad),
  };
}

export function velocityLimits(dn: number): [number, number] {
  if (dn <= 25) return [0.3, 1.0];
  if (dn <= 50) return [0.4, 1.5];
  if (dn <= 100) return [0.5, 2.0];
  return [0.6, 2.8];
}

export function computePipe(pipe: Pipe, scheme: Scheme, fp: FluidProps): PipeResult {
  const mat = getMaterial(pipe.material);
  const d = innerDiameterMm(pipe.material, pipe.dn) / 1000;
  const A = (Math.PI * d * d) / 4;
  const Q = pipe.flow / 3600;
  const v = Q / A;
  const Re = (v * d) / fp.nu;
  const f = Q > 0 ? colebrook(Re, mat.roughness / 1000 / d) : 0;
  const dyn = (fp.rho * v * v) / 2;
  const R = (f / d) * dyn;
  const dpLin = R * pipe.length;
  let Ksum = autoBends(pipe, scheme) * fittingK("elbow90", pipe.joint);
  for (const [k, n] of Object.entries(pipe.fittings)) Ksum += (n ?? 0) * fittingK(k as FittingId, pipe.joint);
  // components whose inlet ("a"/first port) is this pipe's destination contribute
  let Kcomp = 0;
  let dpFixed = 0;
  const target = scheme.nodes.find((n) => n.id === pipe.to.node);
  if (target) {
    const sym = SYMBOLS[target.type];
    if (sym.K !== undefined) Kcomp += target.kOverride ?? sym.K;
    if (target.dpFixed) dpFixed += target.dpFixed * 1000;
  }
  const dpLoc = Ksum * dyn;
  const dpComp = Kcomp * dyn + dpFixed;
  const [lo, hi] = velocityLimits(pipe.dn);
  return {
    id: pipe.id, tag: pipe.tag, d, v, Re,
    regime: Re < 2300 ? "laminar" : Re < 4000 ? "tranziție" : "turbulent",
    f, R, dpLin, Ksum, dpLoc, dpComp,
    dpTotal: dpLin + dpLoc + dpComp,
    velWarn: Q <= 0 ? null : v < lo ? "low" : v > hi ? "high" : null,
  };
}

export type PUnit = "kPa" | "bar" | "mCA";
export function fmtP(pa: number, unit: PUnit, rho = 1000) {
  if (unit === "kPa") return (pa / 1000).toFixed(2);
  if (unit === "bar") return (pa / 1e5).toFixed(4);
  return (pa / (rho * 9.81)).toFixed(3);
}
