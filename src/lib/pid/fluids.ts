// Fluid properties (Etapa 5 / Faza 2).
// WATER: reference table (IAPWS-based standard tables at ~1 atm, rounded), linear interpolation 0–90 °C.
// GLYCOLS (EG/PG): engineering-estimate correlations (±3–8%) — NOT manufacturer data. Kept unchanged
// from Sprint 1; replace with manufacturer tables when available (provider interface below).
export type FluidId = "water" | "eg" | "pg";

export const FLUID_LABEL: Record<FluidId, string> = {
  water: "Apă curată",
  eg: "Etilenglicol",
  pg: "Propilenglicol",
};

export type FluidDataSource = "reference" | "manufacturer" | "standard" | "engineering-estimate" | "user-defined";

export interface FluidProps {
  rho: number; // kg/m3
  mu: number; // Pa·s
  nu: number; // m2/s
  cp: number; // J/(kg·K)
  freeze: number; // °C
  /** Proveniența datelor (legacy: „engineering-estimate” | „tabulated”). */
  source: "engineering-estimate" | "tabulated";
  /** Conductivitate termică [W/(m·K)] */
  k?: number | undefined;
  dataSource?: FluidDataSource | undefined;
  /** Avertizări de domeniu: concentrație nesuportată, temperatură în afara tabelului etc. */
  rangeWarnings?: string[] | undefined;
}

export type FluidPropsProvider = (fluid: FluidId, concentration: number, T: number) => FluidProps;

// T [°C], rho [kg/m³], mu [mPa·s], cp [kJ/kgK], k [W/mK]
export const WATER_TABLE: readonly (readonly [number, number, number, number, number])[] = [
  [0, 999.84, 1.792, 4.218, 0.561],
  [5, 999.97, 1.519, 4.202, 0.571],
  [10, 999.70, 1.307, 4.192, 0.580],
  [15, 999.10, 1.138, 4.186, 0.589],
  [20, 998.21, 1.002, 4.182, 0.598],
  [25, 997.05, 0.890, 4.180, 0.607],
  [30, 995.65, 0.797, 4.178, 0.615],
  [40, 992.22, 0.653, 4.179, 0.631],
  [50, 988.03, 0.547, 4.181, 0.644],
  [60, 983.20, 0.466, 4.185, 0.654],
  [70, 977.76, 0.404, 4.190, 0.663],
  [80, 971.79, 0.354, 4.197, 0.670],
  [90, 965.31, 0.315, 4.205, 0.675],
];
export const WATER_T_RANGE: [number, number] = [0, 90];
export const GLYCOL_C_RANGE: [number, number] = [0, 60];

/** Interpolare liniară în tabelul apei; în afara domeniului se folosește capătul + avertizare. */
export function waterTable(T: number) {
  const t = WATER_TABLE;
  const Tc = Math.max(t[0]![0], Math.min(t[t.length - 1]![0], T));
  let i = 1;
  while (i < t.length - 1 && t[i]![0] < Tc) i++;
  const a = t[i - 1]!, b = t[i]!;
  const f = (Tc - a[0]) / (b[0] - a[0] || 1);
  const lerp = (j: 1 | 2 | 3 | 4) => a[j] + (b[j] - a[j]) * f;
  return { rho: lerp(1), mu: lerp(2) / 1000, cp: lerp(3) * 1000, k: lerp(4), outOfRange: T < t[0]![0] || T > t[t.length - 1]![0] };
}

export function freezePoint(fluid: FluidId, c: number) {
  if (fluid === "water" || c <= 0) return 0;
  if (fluid === "eg") return -(0.3 * c + 0.0088 * c * c);
  return -(0.2 * c + 0.0088 * c * c);
}

export function fluidProps(fluid: FluidId, concentration: number, T: number): FluidProps {
  const warns: string[] = [];
  const w = waterTable(T);
  if (w.outOfRange) warns.push(`Temperatura ${T} °C în afara tabelului (${WATER_T_RANGE[0]}–${WATER_T_RANGE[1]} °C) — valori la capătul domeniului`);
  if (fluid === "water") {
    return { rho: w.rho, mu: w.mu, nu: w.mu / w.rho, cp: w.cp, k: w.k, freeze: 0, source: "tabulated", dataSource: "reference", rangeWarnings: warns };
  }
  if (concentration < GLYCOL_C_RANGE[0] || concentration > GLYCOL_C_RANGE[1]) warns.push(`Concentrație ${concentration}% nesuportată (${GLYCOL_C_RANGE[0]}–${GLYCOL_C_RANGE[1]}%) — limitată`);
  const c = Math.max(0, Math.min(60, concentration));
  const fr = freezePoint(fluid, c);
  if (T < fr + 2) warns.push(`T=${T} °C sub/aproape de punctul de îngheț (${fr.toFixed(1)} °C)`);
  // Corelațiile Sprint 1 (neschimbate) aplicate pe proprietățile apei
  const rw = 1000 * (1 - ((T + 288.9414) / (508929.2 * (T + 68.12963))) * (T - 3.9863) ** 2);
  const mw = 2.414e-5 * 10 ** (247.8 / (T + 133.15));
  let cp = 4180 + 0.0007 * (T - 20) ** 2 * 10;
  let rho: number, mu: number, kG: number;
  if (fluid === "eg") {
    rho = rw * (1 + 0.0014 * c - 0.0000045 * c * T);
    mu = mw * Math.exp(c * (0.0267 + 0.0002 * (20 - T)));
    cp = cp * (1 - 0.0045 * c);
    kG = 0.25;
  } else {
    rho = rw * (1 + 0.0009 * c - 0.000004 * c * T);
    mu = mw * Math.exp(c * (0.0358 + 0.00034 * (20 - T)));
    cp = cp * (1 - 0.004 * c);
    kG = 0.2;
  }
  // conductivitate: amestec liniar pe fracție masică (estimare)
  const x = c / 100;
  const k = (1 - x) * w.k + x * kG;
  return { rho, mu, nu: mu / rho, cp, k, freeze: fr, source: "engineering-estimate", dataSource: "engineering-estimate", rangeWarnings: warns };
}

/** Debit volumic [m³/h] dintr-o putere termică [kW] și un ΔT [K]. */
export function flowFromKw(kw: number, dT: number, fp: FluidProps) {
  if (!kw || !dT) return 0;
  return Math.round(((kw * 1000) / (fp.rho * fp.cp * dT)) * 3600 * 100) / 100;
}
