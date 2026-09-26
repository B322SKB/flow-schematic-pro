import type { CircuitId, FittingId, JointType, MaterialId } from "./catalog";
import type { FluidId } from "./fluids";
import type { SymbolType } from "./symbols";

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
  length: number; // m
  flow: number; // m3/h
  routing: "auto" | "hv" | "vh";
  fittings: Partial<Record<FittingId, number>>;
}

export interface Scheme {
  name: string;
  nodes: PidNode[];
  pipes: Pipe[];
  fluid: FluidId;
  concentration: number;
  temperature: number;
}
