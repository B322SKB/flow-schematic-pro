/**
 * Design assistant – dimensionare avansată (Etapa 3).
 *
 * Moduri:
 *  - "legacy"   : criteriile existente v ≤ vMax ȘI R ≤ Rmax (comportament implicit, neschimbat)
 *  - "velocity" : doar v ≤ vMax (tabel pe DN)
 *  - "gradient" : doar R ≤ Rmax [Pa/m]
 *  - "balanced" : v ≤ vMax·(1+tol) și R ≤ Rmax·(1+tol), cu respingerea supradimensionării
 *                 severe: utilizarea u = max(v/vMax, R/Rmax) trebuie să fie ≥ minUtilisation.
 * În toate modurile se alege cel mai mic DN acceptat. Dacă niciun DN nu este acceptat,
 * se propune cea mai mare treaptă a materialului cu status "fallback".
 *
 * Debitul de dimensionare: debitul solverului de rețea (dacă a convers), altfel debitul introdus.
 * După redimensionare, rețeaua se re-rezolvă (distribuția în bucle depinde de DN) până la stabilizare.
 */
import { DN_LIST, getMaterial, innerDiameterMm } from "./catalog";
import type { FluidProps } from "./fluids";
import { computePipe, unitLoss } from "./hydraulics";
import { solveNetwork, type SolverResult } from "./solver";
import type { Pipe, Scheme } from "./types";
import { limitsFor, maxR } from "./velocity";

export type SizingMode = "legacy" | "velocity" | "gradient" | "balanced";

export const SIZING_MODE_LABEL: Record<SizingMode, string> = {
  legacy: "Actual (v + Pa/m)",
  velocity: "Velocity",
  gradient: "Pressure Gradient",
  balanced: "Balanced",
};

export interface SizingOptions {
  mode: SizingMode;
  rMax?: number | undefined; // Pa/m (implicit din schemă)
  tolerance?: number | undefined; // balanced: depășire admisă (implicit 0.1)
  minUtilisation?: number | undefined; // balanced: prag anti-supradimensionare (implicit 0.35)
}

export type RejectReason = "velocity_high" | "gradient_high" | "oversized";
export const REJECT_LABEL: Record<RejectReason, string> = {
  velocity_high: "viteză peste vMax",
  gradient_high: "Pa/m peste Rmax",
  oversized: "supradimensionat (utilizare redusă)",
};

export interface DnCandidate {
  dn: number;
  idMm: number;
  flow: number; // m³/h
  v: number;
  R: number; // Pa/m
  dpPipe: number; // Pa – Δp tronson (liniar + local + echipament) la acest DN
  vMax: number;
  rMax: number;
  status: "selected" | "accepted" | "rejected";
  reasons: RejectReason[];
  note: string;
}

export interface PipeSizing {
  pipeId: string;
  tag: string;
  currentDn: number;
  flow: number;
  recommended: number;
  status: "ok" | "fallback" | "skipped";
  candidates: DnCandidate[];
}

export function evaluateCandidate(pipe: Pipe, dn: number, flow: number, fp: FluidProps, scheme: Scheme, o: SizingOptions) {
  const u = unitLoss(pipe.material, dn, flow, fp);
  const [, vMax] = limitsFor(dn, scheme);
  const rMax = o.rMax ?? maxR(scheme);
  const tol = o.mode === "balanced" ? (o.tolerance ?? 0.1) : 0;
  const reasons: RejectReason[] = [];
  const checkV = o.mode !== "gradient";
  const checkR = o.mode !== "velocity";
  if (checkV && u.v > vMax * (1 + tol)) reasons.push("velocity_high");
  if (checkR && u.R > rMax * (1 + tol)) reasons.push("gradient_high");
  if (o.mode === "balanced" && !reasons.length) {
    const util = Math.max(u.v / vMax, u.R / rMax);
    if (util < (o.minUtilisation ?? 0.35)) reasons.push("oversized");
  }
  const dpPipe = computePipe({ ...pipe, dn }, scheme, fp, { flow }).dpTotal;
  return { dn, idMm: innerDiameterMm(pipe.material, dn), flow, v: u.v, R: u.R, dpPipe, vMax, rMax, reasons };
}

/** Lista de candidați DN pentru un tronson și recomandarea (cel mai mic DN acceptat). */
export function sizePipe(pipe: Pipe, flow: number, fp: FluidProps, scheme: Scheme, o: SizingOptions): PipeSizing {
  const [lo, hi] = getMaterial(pipe.material).dnRange;
  const list = DN_LIST.filter((d) => d >= lo && d <= hi);
  if (pipe.direct || flow <= 0) {
    return { pipeId: pipe.id, tag: pipe.tag, currentDn: pipe.dn, flow, recommended: pipe.dn, status: "skipped", candidates: [] };
  }
  const raw = list.map((d) => evaluateCandidate(pipe, d, flow, fp, scheme, o));
  const first = raw.find((c) => !c.reasons.length);
  // balanced: dacă toate trec de limitele superioare dar sunt "oversized", se acceptă primul fără depășiri
  const firstUpper = raw.find((c) => !c.reasons.some((r) => r !== "oversized"));
  const pick = first ?? firstUpper;
  const recommended = pick?.dn ?? list[list.length - 1]!;
  const candidates: DnCandidate[] = raw.map((c) => ({
    ...c,
    status: c.dn === recommended ? "selected" : c.reasons.length ? "rejected" : "accepted",
    note: c.dn === recommended
      ? (pick ? (c.reasons.length ? "cel mai mic DN fără depășiri (toate supradimensionate)" : "cel mai mic DN care respectă criteriile") : "nicio treaptă nu respectă criteriile – treapta maximă")
      : c.reasons.length ? c.reasons.map((r) => REJECT_LABEL[r]).join(", ") : "valid, dar mai mare decât minimul",
  }));
  return { pipeId: pipe.id, tag: pipe.tag, currentDn: pipe.dn, flow, recommended, status: pick ? "ok" : "fallback", candidates };
}

const flowFor = (p: Pipe, sol: SolverResult | null) => {
  const sp = sol?.converged ? sol.pipes.get(p.id) : undefined;
  return sp ? Math.abs(sp.flowSigned) : p.flow;
};

export interface SizingPlan {
  sizes: Map<string, PipeSizing>;
  changes: Map<string, number>; // pipeId → DN nou
  passes: number;
  scheme: Scheme; // schema redimensionată (doar DN)
  solution: SolverResult; // rețeaua re-rezolvată cu DN-urile noi
}

/**
 * Plan de redimensionare cu re-rezolvarea rețelei după fiecare trecere
 * (în bucle debitul se redistribuie după DN). Max 5 treceri sau până la stabilizare.
 */
export function planSizing(scheme: Scheme, fp: FluidProps, o: SizingOptions, maxPasses = 5): SizingPlan {
  let cur = scheme;
  let sol = solveNetwork(cur, fp);
  let sizes = new Map<string, PipeSizing>();
  let passes = 0;
  for (passes = 1; passes <= maxPasses; passes++) {
    sizes = new Map();
    let changed = false;
    const pipes = cur.pipes.map((p) => {
      if (p.disabled) return p;
      const sz = sizePipe(p, flowFor(p, sol), fp, cur, o);
      sizes.set(p.id, sz);
      if (sz.status !== "skipped" && sz.recommended !== p.dn) { changed = true; return { ...p, dn: sz.recommended }; }
      return p;
    });
    if (!changed) break;
    cur = { ...cur, pipes };
    sol = solveNetwork(cur, fp);
  }
  const changes = new Map<string, number>();
  for (const p of cur.pipes) {
    const orig = scheme.pipes.find((x) => x.id === p.id)!;
    if (orig.dn !== p.dn) changes.set(p.id, p.dn);
  }
  // candidații raportați față de DN-ul curent din schema originală
  for (const [id, sz] of sizes) sizes.set(id, { ...sz, currentDn: scheme.pipes.find((x) => x.id === id)!.dn });
  return { sizes, changes, passes: Math.min(passes, maxPasses), scheme: cur, solution: sol };
}
