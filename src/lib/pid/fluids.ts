// Fluid property correlations (engineering approximations, ±3–8%).
export type FluidId = "water" | "eg" | "pg";

export const FLUID_LABEL: Record<FluidId, string> = {
  water: "Apă curată",
  eg: "Etilenglicol",
  pg: "Propilenglicol",
};

export interface FluidProps {
  rho: number; // kg/m3
  mu: number; // Pa·s
  nu: number; // m2/s
  cp: number; // J/(kg·K)
  freeze: number; // °C
}


function waterRho(T: number) {
  return 1000 * (1 - ((T + 288.9414) / (508929.2 * (T + 68.12963))) * (T - 3.9863) ** 2);
}
function waterMu(T: number) {
  return 2.414e-5 * 10 ** (247.8 / (T + 133.15));
}

export function freezePoint(fluid: FluidId, c: number) {
  if (fluid === "water" || c <= 0) return 0;
  if (fluid === "eg") return -(0.3 * c + 0.0088 * c * c);
  return -(0.2 * c + 0.0088 * c * c);
}

export function fluidProps(fluid: FluidId, concentration: number, T: number): FluidProps {
  const c = fluid === "water" ? 0 : Math.max(0, Math.min(60, concentration));
  const rw = waterRho(T);
  const mw = waterMu(T);
  let rho = rw;
  let mu = mw;
  let cp = 4180 + 0.0007 * (T - 20) ** 2 * 10;
  if (fluid === "eg") {
    rho = rw * (1 + 0.0014 * c - 0.0000045 * c * T);
    mu = mw * Math.exp(c * (0.0267 + 0.0002 * (20 - T)));
    cp = cp * (1 - 0.0045 * c);
  } else if (fluid === "pg") {
    rho = rw * (1 + 0.0009 * c - 0.000004 * c * T);
    mu = mw * Math.exp(c * (0.0358 + 0.00034 * (20 - T)));
    cp = cp * (1 - 0.004 * c);
  }
  return { rho, mu, nu: mu / rho, cp, freeze: freezePoint(fluid, c) };
}

/** Debit volumic [m³/h] dintr-o putere termică [kW] și un ΔT [K]. */
export function flowFromKw(kw: number, dT: number, fp: FluidProps) {
  if (!kw || !dT) return 0;
  return Math.round(((kw * 1000) / (fp.rho * fp.cp * dT)) * 3600 * 100) / 100;
}

