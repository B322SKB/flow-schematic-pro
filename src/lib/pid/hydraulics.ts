import { DN_LIST, fittingK, getMaterial, innerDiameterMm, type FittingId, type MaterialId } from "./catalog";
import type { FluidProps } from "./fluids";
import type { Pipe, Scheme } from "./types";
import { getSymbol } from "./symbols";
import { limitsFor } from "./velocity";

/* ------------------------------------------------------------------ */
/* Primitive pure (testabile, fără dependență de schemă)               */
/* ------------------------------------------------------------------ */

export const G = 9.81;
export const RE_LAMINAR = 2300;
export const RE_TURBULENT = 4000;

/** Viteza medie [m/s] din debit [m³/h] și diametru interior [m]. */
export function velocity(flowM3h: number, dM: number) {
  if (dM <= 0) return 0;
  return flowM3h / 3600 / ((Math.PI * dM * dM) / 4);
}

/** Numărul Reynolds. */
export function reynolds(v: number, dM: number, nu: number) {
  return nu > 0 ? (v * dM) / nu : 0;
}

export type Regime = "laminar" | "tranziție" | "turbulent";
export function regimeOf(Re: number): Regime {
  return Re < RE_LAMINAR ? "laminar" : Re < RE_TURBULENT ? "tranziție" : "turbulent";
}

/**
 * Factor de frecare Darcy. Laminar: 64/Re. Turbulent: Colebrook-White (start Swamee-Jain).
 * În zona de tranziție (2300–4000) se returnează valoarea Colebrook, dar rezultatul este
 * marcat ca nesigur prin status/warning în computePipe.
 */
export function colebrook(Re: number, relRough: number) {
  if (Re < RE_LAMINAR) return 64 / Math.max(Re, 1e-9);
  let f = 0.25 / Math.log10(relRough / 3.7 + 5.74 / Re ** 0.9) ** 2;
  for (let i = 0; i < 30; i++) {
    const rhs = -2 * Math.log10(relRough / 3.7 + 2.51 / (Re * Math.sqrt(f)));
    const nf = 1 / (rhs * rhs);
    if (Math.abs(nf - f) < 1e-10) { f = nf; break; }
    f = nf;
  }
  return f;
}

/** Presiune dinamică ρv²/2 [Pa]. */
export const dynamicPressure = (rho: number, v: number) => (rho * v * v) / 2;

/** Darcy–Weisbach: Δp = f·L/d·ρv²/2 [Pa]. */
export function darcyDp(f: number, L: number, dM: number, rho: number, v: number) {
  return dM > 0 ? (f * L / dM) * dynamicPressure(rho, v) : 0;
}

/** Pierdere locală Δp = ΣK·ρv²/2 [Pa]. */
export function localLoss(Ksum: number, rho: number, v: number) {
  return Ksum * dynamicPressure(rho, v);
}

/** Componentă statică ρ·g·Δz [Pa]. Pregătită pentru circuite deschise; nu se aplică în circuit închis. */
export function staticDp(rho: number, dz: number) {
  return rho * G * dz;
}

/** Căderea liniară R [Pa/m] pentru un material/DN/debit dat. */
export function unitLoss(material: MaterialId, dn: number, flowM3h: number, fp: FluidProps) {
  const d = innerDiameterMm(material, dn) / 1000;
  const v = velocity(flowM3h, d);
  const Re = reynolds(v, d, fp.nu);
  const f = flowM3h > 0 ? colebrook(Re, getMaterial(material).roughness / 1000 / d) : 0;
  return { d, v, Re, f, R: (f / d) * dynamicPressure(fp.rho, v) };
}

/**
 * Selecția DN (criteriile actuale, neschimbate): cel mai mic DN cu v ≤ vMax și R ≤ Rmax.
 * Dacă și viteza ≥ vMin este aleasă direct; altfel este acceptată tot prima treaptă validă.
 * Dacă nicio treaptă nu respectă criteriile se întoarce cea mai mare treaptă a materialului.
 */
export function selectDn(material: MaterialId, flowM3h: number, fp: FluidProps, rMax: number, scheme?: Scheme) {
  const [lo, hi] = getMaterial(material).dnRange;
  const list = DN_LIST.filter((d) => d >= lo && d <= hi);
  for (const d of list) {
    const { v, R } = unitLoss(material, d, flowM3h, fp);
    const [, vMax] = limitsFor(d, scheme);
    if (v <= vMax && R <= rMax) return d;
  }
  return list[list.length - 1]!;
}

/* ------------------------------------------------------------------ */
/* Geometrie traseu                                                    */
/* ------------------------------------------------------------------ */

type Pt = { x: number; y: number };

/** Numărul de schimbări reale de direcție dintr-o polilinie (ignoră puncte coliniare/duplicate). */
export function countDirectionChanges(pts: Pt[]) {
  const dirs: { x: number; y: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i]!.x - pts[i - 1]!.x, dy = pts[i]!.y - pts[i - 1]!.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue; // segment degenerat
    dirs.push({ x: dx / len, y: dy / len });
  }
  let n = 0;
  for (let i = 1; i < dirs.length; i++) {
    const cross = dirs[i - 1]!.x * dirs[i]!.y - dirs[i - 1]!.y * dirs[i]!.x;
    const dot = dirs[i - 1]!.x * dirs[i]!.x + dirs[i - 1]!.y * dirs[i]!.y;
    if (Math.abs(cross) > 1e-3 || dot < 0) n++;
  }
  return n;
}

export function autoBends(pipe: Pipe, scheme: Scheme): number {
  return countDirectionChanges(pipeRoute(pipe, scheme));
}

export function pipeRoute(pipe: Pipe, scheme: Scheme): { x: number; y: number }[] {
  const a = portPos(scheme, pipe.from.node, pipe.from.port);
  const b = portPos(scheme, pipe.to.node, pipe.to.port);
  if (!a || !b) return [];
  if (pipe.points?.length && !pipe.direct) {
    const P = pipe.points.map((p) => ({ ...p }));
    if (P.length === 1) {
      const p = P[0]!, o1 = { x: a.x, y: b.y }, o2 = { x: b.x, y: a.y };
      P[0] = Math.hypot(p.x - o1.x, p.y - o1.y) <= Math.hypot(p.x - o2.x, p.y - o2.y) ? o1 : o2;
    } else {
      const f = P[0]!, f1 = P[1]!;
      if (Math.abs(f.y - f1.y) < 1) f.x = a.x; else f.y = a.y;
      const l = P[P.length - 1]!, l1 = P[P.length - 2]!;
      if (Math.abs(l.y - l1.y) < 1) l.x = b.x; else l.y = b.y;
    }
    return [a, ...P, b];
  }
  if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return [a, b];
  if (pipe.routing === "vh") return [a, { x: a.x, y: b.y }, b];
  if (pipe.routing === "hv") return [a, { x: b.x, y: a.y }, b];
  const mx = (a.x + b.x) / 2;
  return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
}

export function portPos(scheme: Scheme, nodeId: string, portId: string) {
  const n = scheme.nodes.find((x) => x.id === nodeId);
  if (!n) return null;
  const s = getSymbol(n.type);
  const p = s.ports.find((q) => q.id === portId);
  if (!p) return null;
  const rad = (n.rotation * Math.PI) / 180;
  const cx = p.x - s.w / 2, cy = p.y - s.h / 2;
  return {
    x: n.x + cx * Math.cos(rad) - cy * Math.sin(rad),
    y: n.y + cx * Math.sin(rad) + cy * Math.cos(rad),
  };
}

export function velocityLimits(dn: number, scheme?: Scheme | undefined): [number, number] {
  return limitsFor(dn, scheme);
}

/** Cota verticală (m) introdusă prin simbolurile de urcare/coborâre de la capătul conductei. */
export function riserRise(pipe: Pipe, scheme: Scheme) {
  const n = scheme.nodes.find((x) => x.id === pipe.to.node);
  if (!n) return 0;
  const sym = getSymbol(n.type);
  if (!sym.riser) return 0;
  const z = Math.abs(n.z ?? 0);
  return sym.riser === "up" ? z : -z;
}

/* ------------------------------------------------------------------ */
/* Rezultat pe tronson                                                  */
/* ------------------------------------------------------------------ */

export type CalcStatus = "ok" | "warning" | "incomplete";
export type CalcWarningCode =
  | "no_flow" | "transitional_re" | "missing_dn" | "missing_material"
  | "equipment_no_dp" | "manual_flow_auto_available" | "velocity_low" | "velocity_high"
  | "approx_fluid_props" | "flow_unresolved"
  | "r_over_limit" | "isolated_node" | "invalid_pipe_end" | "no_source" | "terminal_no_path"
  | "loop_insufficient_data" | "terminal_flow_inconsistent" | "source_demand_mismatch"
  | "not_converged" | "source_inferred" | "multi_source_split" | "source_head_unknown"
  | "equipment_dp_no_ref";

/** error = blochează rezultatul (nu este valid); warning = rezultat cu rezervă; info = notă. */
export type Severity = "error" | "warning" | "info";

export interface CalcWarning {
  code: CalcWarningCode;
  message: string;
  target?: string | undefined; // id tronson / nod
  severity?: Severity | undefined; // implicit "warning"
}

export interface PipeResult {
  id: string;
  tag: string;
  d: number; // m
  v: number; // m/s
  Re: number;
  regime: Regime;
  f: number;
  R: number; // Pa/m
  L: number; // m (inclusiv cote verticale)
  dpLin: number; // Pa
  Ksum: number;
  dpLoc: number; // Pa
  /** (a) pierderea proprie a conductei: liniară + locală (coturi, fitinguri) */
  dpPipe: number;
  /** (b) pierderea pe echipamentul/armătura de la capătul aval (K sau Δp fix) */
  dpComp: number; // Pa
  dpStatic: number; // Pa – aplicat (0 în circuit închis)
  /** ρ·g·Δz al urcării/coborârii; doar informativ, NU este adăugat în circuit închis */
  dpStaticPotential: number;
  dpTotal: number; // dpPipe + dpComp
  velWarn: "low" | "high" | null;
  status: CalcStatus;
  warnings: CalcWarning[];
}

export interface ComputeOpts {
  /** Debit (valoare absolută, m³/h) folosit în locul pipe.flow – utilizat de solver. */
  flow?: number | undefined;
  /**
   * Debitul de referință la care este dat Δp fix al echipamentului. Dacă este dat,
   * Δp_eq = dpFixed·(Q/Qref)² (comportament pătratic, tip Kv). Altfel Δp fix constant.
   */
  compRefFlow?: number | undefined;
}

export function computePipe(pipe: Pipe, scheme: Scheme, fp: FluidProps, opts?: ComputeOpts): PipeResult {
  if (opts?.flow !== undefined) pipe = { ...pipe, flow: Math.abs(opts.flow) };
  const warnings: CalcWarning[] = [];
  const mat = pipe.material ? getMaterial(pipe.material) : undefined;
  if (!mat) warnings.push({ code: "missing_material", message: "Material lipsă", target: pipe.id });
  if (!pipe.dn) warnings.push({ code: "missing_dn", message: "DN lipsă", target: pipe.id });
  const d = mat && pipe.dn ? innerDiameterMm(pipe.material, pipe.dn) / 1000 : 0;
  const v = velocity(pipe.flow, d);
  const Re = reynolds(v, d, fp.nu);
  const f = pipe.flow > 0 && mat && d > 0 ? colebrook(Re, mat.roughness / 1000 / d) : 0;
  const dyn = dynamicPressure(fp.rho, v);
  const R = d > 0 ? (f / d) * dyn : 0;
  const rise = riserRise(pipe, scheme);
  const L = pipe.direct ? 0 : pipe.length + Math.abs(rise);
  const dpLin = R * L;
  let Ksum = pipe.direct ? 0 : autoBends(pipe, scheme) * fittingK("elbow90", pipe.joint);
  for (const [k, n] of Object.entries(pipe.fittings)) Ksum += (n ?? 0) * fittingK(k as FittingId, pipe.joint);
  // echipamentul / armătura de la capătul aval contribuie cu K sau Δp fix
  let Kcomp = 0;
  let dpFixed = 0;
  const target = scheme.nodes.find((n) => n.id === pipe.to.node);
  if (target) {
    const sym = getSymbol(target.type);
    if (sym.K !== undefined) Kcomp += target.kOverride ?? sym.K;
    if (target.dpFixed) {
      const ref = opts?.compRefFlow;
      dpFixed += target.dpFixed * 1000 * (ref && ref > 0 ? (pipe.flow / ref) ** 2 : 1);
    }
    if ((sym.terminal || sym.source) && !target.dpFixed && target.kOverride === undefined) {
      warnings.push({ code: "equipment_no_dp", message: `${target.tag}: echipament fără Δp definit`, target: target.id });
    }
  }
  const dpLoc = localLoss(Ksum, fp.rho, v);
  const dpComp = Kcomp * dyn + dpFixed;
  const dpStaticPotential = staticDp(fp.rho, rise);
  const dpStatic = 0; // circuit închis: coloana statică tur/retur se compensează
  const [lo, hi] = velocityLimits(pipe.dn, scheme);
  const Q = pipe.flow;
  const velWarn = Q <= 0 ? null : v < lo ? "low" : v > hi ? "high" : null;
  const regime = regimeOf(Re);
  if (Q <= 0 && !pipe.direct) warnings.push({ code: "no_flow", message: "Debit lipsă / zero", target: pipe.id });
  if (Q > 0 && regime === "tranziție") warnings.push({ code: "transitional_re", message: `Re=${Math.round(Re)} în zona de tranziție: factorul de frecare este incert`, target: pipe.id });
  if (velWarn === "low") warnings.push({ code: "velocity_low", message: "Viteză sub intervalul recomandat", target: pipe.id });
  if (velWarn === "high") warnings.push({ code: "velocity_high", message: "Viteză peste intervalul recomandat", target: pipe.id });
  const incomplete = warnings.some((w) => w.code === "no_flow" || w.code === "missing_dn" || w.code === "missing_material");
  const dpPipe = dpLin + dpLoc;
  return {
    id: pipe.id, tag: pipe.tag, d, v, Re, regime,
    f, R, L, dpLin, Ksum, dpLoc, dpPipe, dpComp, dpStatic, dpStaticPotential,
    dpTotal: dpPipe + dpComp,
    velWarn,
    status: incomplete ? "incomplete" : warnings.length ? "warning" : "ok",
    warnings,
  };
}

export type PUnit = "kPa" | "bar" | "mCA";
export function fmtP(pa: number, unit: PUnit, rho = 1000) {
  if (unit === "kPa") return (pa / 1000).toFixed(2);
  if (unit === "bar") return (pa / 1e5).toFixed(4);
  return (pa / (rho * 9.81)).toFixed(3);
}

/** Puncte de traversare a conductelor (pentru punțile de trecere pe desen). */
export function pipeCrossings(scheme: Scheme) {
  type Seg = { a: { x: number; y: number }; b: { x: number; y: number }; id: string; horiz: boolean };
  const segs: Seg[] = [];
  for (const p of scheme.pipes) {
    if (p.direct) continue;
    const pts = pipeRoute(p, scheme);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const horiz = Math.abs(a.y - b.y) < 1;
      if (!horiz && Math.abs(a.x - b.x) > 1) continue;
      segs.push({ a, b, id: p.id, horiz });
    }
  }
  const out: { x: number; y: number; pipeId: string }[] = [];
  for (const h of segs.filter((s) => s.horiz)) {
    for (const v of segs.filter((s) => !s.horiz)) {
      if (h.id === v.id) continue;
      const x = v.a.x, y = h.a.y;
      const inH = x > Math.min(h.a.x, h.b.x) + 6 && x < Math.max(h.a.x, h.b.x) - 6;
      const inV = y > Math.min(v.a.y, v.b.y) + 6 && y < Math.max(v.a.y, v.b.y) - 6;
      if (inH && inV) out.push({ x, y, pipeId: h.id });
    }
  }
  return out;
}

export interface CircuitSummary {
  L: number; // m
  n: number; // tronsoane
  /** Σ pierderi proprii conducte (informativ; NU este Δp de sistem în rețele ramificate) */
  dpPipes: number;
  /** Σ pierderi pe echipamente/armături (informativ) */
  dpComponents: number;
  /** Compatibilitate: Σ tuturor pierderilor din circuit. NU reprezintă Δp de sistem. */
  dp: number;
}

/** Sumar pe circuit (inventar de pierderi). Δp de sistem se obține din traseul critic (network.ts). */
export function circuitTotals(scheme: Scheme, fp: FluidProps) {
  const map = new Map<string, CircuitSummary>();
  for (const p of scheme.pipes) {
    if (p.disabled) continue;
    const r = computePipe(p, scheme, fp);
    const c = map.get(p.circuit) ?? { L: 0, dp: 0, n: 0, dpPipes: 0, dpComponents: 0 };
    c.L += r.L; c.dp += r.dpTotal; c.dpPipes += r.dpPipe; c.dpComponents += r.dpComp; c.n++;
    map.set(p.circuit, c);
  }
  return map;
}
