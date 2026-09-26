import type { FluidProps } from "./fluids";
import { getSymbol } from "./symbols";
import type { Pipe, Scheme } from "./types";

export interface PowerTotals {
  sensInstalled: number; // sensibilă, terminale active + redundante
  sensActive: number; // sensibilă, terminale active
  required: number; // totală, terminale active
  supplied: number; // chillere active
  deficit: boolean;
}

export function powerTotals(s: Scheme): PowerTotals {
  let sensInstalled = 0, sensActive = 0, required = 0, supplied = 0;
  for (const n of s.nodes) {
    const sym = getSymbol(n.type);
    if (sym.terminal) {
      sensInstalled += n.kwSens ?? 0;
      if (!n.redundant) { sensActive += n.kwSens ?? 0; required += n.kw ?? 0; }
    } else if (sym.source && !n.redundant) supplied += n.kw ?? 0;
  }
  return { sensInstalled, sensActive, required, supplied, deficit: required > supplied };
}

/** Putere transportată de o conductă [kW] = Q·ρ·cp·ΔT. */
export function pipePower(p: Pipe, s: Scheme, fp: FluidProps) {
  const dT = p.deltaT ?? s.deltaT;
  return (p.flow / 3600) * fp.rho * fp.cp * dT / 1000;
}
