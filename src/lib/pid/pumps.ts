/**
 * Pump engineering (Etapa 5 / Faza 1). Pure, UI-free.
 * Operating point = pump curve H(Q) ∩ system curve H_sys(Q) = H0 + k·Q².
 * Ph = Q·Δp ; Pshaft = Ph / η_pump ; Pmotor = Pshaft / η_motor.
 * Curve data comes from the user/manufacturer; nothing is invented here.
 */
export type DataQuality = "reference" | "manufacturer" | "standard" | "engineering-estimate" | "user-defined";
export interface CurvePoint { q: number; h: number } // m³/h, mCA
export interface EffPoint { q: number; eta: number } // m³/h, 0..1

export interface PumpData {
  tag: string;
  manufacturer?: string | undefined;
  model?: string | undefined;
  nominalFlow?: number | undefined;
  nominalHead?: number | undefined;
  minFlow?: number | undefined;
  maxFlow?: number | undefined;
  shutoffHead?: number | undefined;
  curve: CurvePoint[];
  efficiency?: EffPoint[] | undefined;
  motorEfficiency?: number | undefined;
  motorPower?: number | undefined; // kW installed
  speed?: number | undefined; // rpm
  count: number;
  arrangement: "single" | "parallel" | "series";
  mounting: "integrated" | "external";
  quality: DataQuality;
}

export type PumpStatus = "ok" | "outside_curve" | "insufficient_head" | "no_curve" | "efficiency_missing" | "motor_undersized";

export interface PumpResult {
  basis: "curve-based" | "unavailable";
  q: number; h: number; dp: number; // m³/h, mCA, Pa
  qPerPump: number;
  eta?: number | undefined;
  hydraulicKw: number;
  shaftKw?: number | undefined;
  motorKwRequired?: number | undefined;
  status: PumpStatus[];
}

const sorted = (c: CurvePoint[]) => [...c].sort((a, b) => a.q - b.q);

/** Liniar între puncte; NaN în afara domeniului curbei (fără extrapolare). */
export function interpolateHead(curve: CurvePoint[], q: number): number {
  const c = sorted(curve);
  if (c.length < 2 || q < c[0]!.q - 1e-9 || q > c[c.length - 1]!.q + 1e-9) return NaN;
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1]!, b = c[i]!;
    if (q <= b.q) return a.h + ((b.h - a.h) * (q - a.q)) / (b.q - a.q || 1);
  }
  return c[c.length - 1]!.h;
}

export function interpolateEff(eff: EffPoint[] | undefined, q: number): number | undefined {
  if (!eff || eff.length < 2) return undefined;
  const c = [...eff].sort((a, b) => a.q - b.q);
  if (q < c[0]!.q || q > c[c.length - 1]!.q) return undefined;
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1]!, b = c[i]!;
    if (q <= b.q) return a.eta + ((b.eta - a.eta) * (q - a.q)) / (b.q - a.q || 1);
  }
  return undefined;
}

/** Curba combinată: paralel = debite însumate la aceeași înălțime; serie = înălțimi însumate. */
export function combinedCurve(p: PumpData): CurvePoint[] {
  const n = Math.max(1, p.count);
  const c = sorted(p.curve);
  if (p.arrangement === "parallel") return c.map((x) => ({ q: x.q * n, h: x.h }));
  if (p.arrangement === "series") return c.map((x) => ({ q: x.q, h: x.h * n }));
  return c;
}

/** Curba sistemului: H(Q) = h0 + k·Q², calibrată din punctul de proiect (Qd, Hd). */
export const systemCurve = (qd: number, hd: number, h0 = 0) => ({ h0, k: qd > 0 ? (hd - h0) / (qd * qd) : 0 });

export function operatingPoint(p: PumpData, sys: { h0: number; k: number }, rho = 1000, demandQ?: number): PumpResult {
  const status: PumpStatus[] = [];
  if (p.curve.length < 2) return { basis: "unavailable", q: 0, h: 0, dp: 0, qPerPump: 0, hydraulicKw: 0, status: ["no_curve"] };
  const c = combinedCurve(p);
  const f = (q: number) => interpolateHead(c, q) - (sys.h0 + sys.k * q * q);
  const qa = c[0]!.q, qb = c[c.length - 1]!.q;
  let q: number;
  if (f(qa) < 0) { q = qa; status.push("insufficient_head"); }
  else if (f(qb) > 0) { q = qb; status.push("outside_curve"); }
  else {
    let lo = qa, hi = qb;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
    q = (lo + hi) / 2;
  }
  const h = interpolateHead(c, q);
  const n = Math.max(1, p.count);
  const qPerPump = p.arrangement === "parallel" ? q / n : q;
  if ((p.minFlow !== undefined && qPerPump < p.minFlow) || (p.maxFlow !== undefined && qPerPump > p.maxFlow)) {
    if (!status.includes("outside_curve")) status.push("outside_curve");
  }
  if (demandQ !== undefined && q + 1e-6 < demandQ && !status.includes("insufficient_head")) status.push("insufficient_head");
  const dp = rho * 9.81 * h;
  const hydraulicKw = ((q / 3600) * dp) / 1000;
  const eta = interpolateEff(p.efficiency, qPerPump);
  let shaftKw: number | undefined, motorKwRequired: number | undefined;
  if (eta && eta > 0) {
    shaftKw = hydraulicKw / eta;
    if (p.motorEfficiency && p.motorEfficiency > 0) motorKwRequired = shaftKw / p.motorEfficiency;
    const perPump = (motorKwRequired ?? shaftKw) / (p.arrangement === "single" ? 1 : n);
    if (p.motorPower !== undefined && perPump > p.motorPower) status.push("motor_undersized");
  } else status.push("efficiency_missing");
  if (!status.length) status.push("ok");
  return { basis: "curve-based", q, h, dp, qPerPump, eta, hydraulicKw, shaftKw, motorKwRequired, status };
}

/** Etichetă explicită pentru fallback-ul solverului fără curbe. */
export const EQUAL_SPLIT_LABEL = "Preliminary – equal split fallback";
