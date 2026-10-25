// Migrarea automată a schemelor salvate (localStorage / import) la versiunea curentă a modelului.
import { DEFAULT_CIRCUIT_COLORS } from "./catalog";
import type { Pipe, PidNode, Scheme } from "./types";

export const SCHEMA_VERSION = 4;

/**
 * v1/v2 (fără schemaVersion): câmpuri opționale lipsă, fittings/points nedefinite,
 * tag-uri goale. v3: straturi (layers) și schemaVersion. Migrarea este idempotentă.
 */
export function migrateScheme(raw: unknown): Scheme {
  const d = (raw ?? {}) as Partial<Scheme> & Record<string, unknown>;
  const nodes: PidNode[] = (Array.isArray(d.nodes) ? d.nodes : []).map((n: PidNode) => ({
    ...n,
    rotation: Number.isFinite(n.rotation) ? n.rotation : 0,
    x: Number(n.x) || 0,
    y: Number(n.y) || 0,
    tag: n.tag ?? "",
  }));
  const pipes: Pipe[] = (Array.isArray(d.pipes) ? d.pipes : []).map((p: Pipe) => ({
    ...p,
    fittings: p.fittings ?? {},
    routing: p.routing ?? "auto",
    flowMode: p.flowMode ?? "manual",
    flow: Number(p.flow) || 0,
    length: Number(p.length) || 0,
    tag: p.tag ?? "",
  }));
  return {
    ...(d as Scheme),
    id: String(d.id ?? Math.random().toString(36).slice(2, 10)),
    name: d.name ?? "Proiect",
    nodes,
    pipes,
    fluid: d.fluid ?? "water",
    concentration: d.concentration ?? 0,
    temperature: d.temperature ?? 10,
    deltaT: d.deltaT ?? 5,
    circuitColors: { ...DEFAULT_CIRCUIT_COLORS, ...(d.circuitColors ?? {}) },
    customSymbols: d.customSymbols ?? [],
    revision: d.revision ?? "R00",
    updatedAt: d.updatedAt ?? Date.now(),
    layers: d.layers ?? {},
    schemaVersion: SCHEMA_VERSION,
  };
}
