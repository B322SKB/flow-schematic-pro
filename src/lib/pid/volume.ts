// Volumul de fluid din instalație, cantitatea de glicol și dimensionarea vasului de expansiune.
import { innerDiameterMm } from "./catalog";
import { fluidProps } from "./fluids";
import { getSymbol } from "./symbols";
import { riserRise } from "./hydraulics";
import type { Scheme } from "./types";

export interface VolumeTotals {
  pipes: number; // litri în conducte
  equipment: number; // litri în rezervoare / vase
  total: number; // litri
  glycolPure: number; // litri de glicol pur la umplere
  water: number; // litri de apă la umplere
  byDn: { dn: number; length: number; liters: number }[];
}

/** Volum de fluid: conducte (π·di²/4·L) + volumele declarate ale rezervoarelor. */
export function volumeTotals(scheme: Scheme): VolumeTotals {
  const map = new Map<number, { dn: number; length: number; liters: number }>();
  let pipes = 0;
  for (const p of scheme.pipes) {
    if (p.direct || p.disabled) continue;
    const L = p.length + Math.abs(riserRise(p, scheme));
    const di = innerDiameterMm(p.material, p.dn) / 1000;
    const liters = (Math.PI * di * di) / 4 * L * 1000;
    pipes += liters;
    const e = map.get(p.dn) ?? { dn: p.dn, length: 0, liters: 0 };
    e.length += L; e.liters += liters;
    map.set(p.dn, e);
  }
  let equipment = 0;
  for (const n of scheme.nodes) {
    if (!getSymbol(n.type).hasVolume) continue;
    equipment += n.volume ?? 0;
  }
  const total = pipes + equipment;
  const c = scheme.fluid === "water" ? 0 : Math.max(0, Math.min(60, scheme.concentration));
  return {
    pipes, equipment, total,
    glycolPure: (total * c) / 100,
    water: total * (1 - c / 100),
    byDn: [...map.values()].sort((a, b) => a.dn - b.dn),
  };
}

/** Volume nominale comerciale uzuale pentru vase de expansiune cu membrană [litri]. */
export const STANDARD_TANKS = [8, 12, 18, 25, 35, 50, 80, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1500, 2000];

export interface ExpansionSizing {
  tMin: number;
  tMax: number;
  expansionFactor: number; // fracție de dilatare între tMin și tMax
  expansionVolume: number; // litri de dilatare
  reserve: number; // litri rezervă de apă (min. 0,5% sau 3 l)
  utilVolume: number; // litri utili necesari
  nominal: number; // litri volum nominal calculat
  standard: number; // litri, mărimea comercială aleasă
  staticHeight: number; // m coloană de fluid
  p0: number; // bar abs, presiune de preîncărcare
  pe: number; // bar abs, presiune finală
  relief: number; // bar suprapresiune, supapa de siguranță
  efficiency: number; // randamentul vasului (pe − p0)/pe
  installed: number; // litri deja prevăzuți în schemă
  ok: boolean;
}

/**
 * Vas de expansiune cu membrană: Vn = Vu · pe/(pe − p0), presiuni absolute.
 * p0 se calculează din înălțimea statică a instalației (h/10 + 0,3 bar),
 * iar pe din presiunea supapei de siguranță (90% din valoarea de deschidere).
 */
export function expansionSizing(scheme: Scheme): ExpansionSizing {
  const v = volumeTotals(scheme);
  const tMin = Math.min(scheme.temperature, 10);
  const tMax = Math.max(scheme.tStagnation ?? 40, tMin + 5);
  const lo = fluidProps(scheme.fluid, scheme.concentration, tMin).rho;
  const hi = fluidProps(scheme.fluid, scheme.concentration, tMax).rho;
  const expansionFactor = Math.max(0, lo / hi - 1);
  const expansionVolume = v.total * expansionFactor;
  const reserve = Math.max(3, v.total * 0.005);
  const utilVolume = expansionVolume + reserve;
  const staticHeight = scheme.staticHeight ?? 15;
  const relief = scheme.reliefPressure ?? 3;
  const p0 = staticHeight / 10 + 0.3 + 1; // bar absolut
  const pe = Math.max(p0 + 0.5, relief * 0.9 + 1); // bar absolut
  const nominal = (utilVolume * pe) / (pe - p0);
  let installed = 0;
  for (const n of scheme.nodes) {
    if (n.type === "expansion") installed += n.volume ?? 0;
  }
  const standard = STANDARD_TANKS.find((t) => t >= nominal) ?? Math.ceil(nominal / 100) * 100;
  return {
    tMin, tMax, expansionFactor, expansionVolume, reserve, utilVolume,
    nominal: Math.ceil(nominal), standard, staticHeight, p0, pe, relief,
    efficiency: (pe - p0) / pe, installed,
    ok: installed >= nominal,
  };
}
