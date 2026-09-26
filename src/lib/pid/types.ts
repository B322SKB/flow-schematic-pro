import type { CircuitId, FittingId, JointType, MaterialId } from "./catalog";
import type { FluidId } from "./fluids";
import type { CustomSymbol, SymbolType } from "./symbols";

export interface PidNode {
  id: string;
  type: SymbolType;
  tag: string;
  x: number;
  y: number;
  rotation: number;
  dn?: number | undefined;
  kOverride?: number | undefined;
  dpFixed?: number | undefined; // kPa, equipment pressure drop
  kw?: number | undefined; // putere termică
  deltaT?: number | undefined; // K
  flow?: number | undefined; // m3/h (din kW sau manual)
  z?: number | undefined; // cotă urcare/coborâre (m)
  note?: string | undefined;
}

export interface Pipe {
  id: string;
  tag: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
  dn: number;
  material: MaterialId;
  joint: JointType;
  circuit: CircuitId;
  length: number; // m, introdusă manual
  flow: number; // m3/h
  flowMode: "manual" | "kw";
  kw?: number | undefined;
  deltaT?: number | undefined;
  routing: "auto" | "hv" | "vh";
  fittings: Partial<Record<FittingId, number>>;
}

export interface Scheme {
  id: string;
  name: string;
  nodes: PidNode[];
  pipes: Pipe[];
  fluid: FluidId;
  concentration: number;
  temperature: number;
  deltaT: number; // ΔT implicit pentru calculul debitului din kW
  circuitColors: Partial<Record<CircuitId, string>>;
  customSymbols: CustomSymbol[];
  revision: string;
  updatedAt: number;
}
