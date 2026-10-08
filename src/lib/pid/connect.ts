// Smart Connect: snap pe porturi, validarea conexiunilor, propunerea circuitului, detecția orfanilor.
import type { CircuitId } from "./catalog";
import { portPos } from "./hydraulics";
import { getSymbol } from "./symbols";
import type { Pipe, Scheme } from "./types";

export interface PortRef { node: string; port: string }

export const portKey = (r: PortRef) => `${r.node}:${r.port}`;
export const usedPorts = (s: Scheme) => new Set(s.pipes.flatMap((p) => [portKey(p.from), portKey(p.to)]));

/** Cel mai apropiat port liber de un punct (în raza dată), excluzând opțional un nod / port. */
export function findSnapPort(s: Scheme, pt: { x: number; y: number }, radius: number, exclude?: { node?: string | undefined; port?: PortRef | undefined }) {
  const used = usedPorts(s);
  let best: (PortRef & { x: number; y: number; d: number }) | null = null;
  for (const n of s.nodes) {
    if (exclude?.node === n.id) continue;
    for (const p of getSymbol(n.type).ports) {
      const ref = { node: n.id, port: p.id };
      if (used.has(portKey(ref))) continue;
      if (exclude?.port && portKey(exclude.port) === portKey(ref)) continue;
      const pos = portPos(s, n.id, p.id);
      if (!pos) continue;
      const d = Math.hypot(pos.x - pt.x, pos.y - pt.y);
      if (d <= radius && (!best || d < best.d)) best = { ...ref, x: pos.x, y: pos.y, d };
    }
  }
  return best;
}

export interface ConnectionCheck { ok: boolean; reason?: string | undefined; circuit?: CircuitId | undefined }

/** Validează o conexiune nouă și propune circuitul (din rolurile porturilor sau din vecini). */
export function validateConnection(s: Scheme, a: PortRef, b: PortRef): ConnectionCheck {
  const na = s.nodes.find((n) => n.id === a.node), nb = s.nodes.find((n) => n.id === b.node);
  if (!na || !nb) return { ok: false, reason: "Element inexistent" };
  if (!getSymbol(na.type).ports.some((p) => p.id === a.port) || !getSymbol(nb.type).ports.some((p) => p.id === b.port)) return { ok: false, reason: "Port inexistent" };
  if (portKey(a) === portKey(b)) return { ok: false, reason: "Același port" };
  if (a.node === b.node) return { ok: false, reason: "Conexiune pe același element" };
  const used = usedPorts(s);
  if (used.has(portKey(a)) || used.has(portKey(b))) return { ok: false, reason: "Port deja ocupat" };
  const ra = getSymbol(na.type).roles?.[a.port], rb = getSymbol(nb.type).roles?.[b.port];
  if (ra && rb && ra !== rb) return { ok: false, reason: "Port TUR legat de port RETUR" };
  const role = ra ?? rb;
  let circuit: CircuitId | undefined = role === "s" ? "supply" : role === "r" ? "return" : undefined;
  if (!circuit) circuit = s.pipes.find((p) => [p.from.node, p.to.node].some((id) => id === a.node || id === b.node))?.circuit;
  return { ok: true, circuit };
}

/** Elemente/conducte cu conectare incompletă. */
export function orphans(s: Scheme) {
  const ids = new Set(s.nodes.map((n) => n.id));
  const used = usedPorts(s);
  const invalidPipes = s.pipes.filter((p) => !ids.has(p.from.node) || !ids.has(p.to.node)).map((p) => p.id);
  const unconnected = s.nodes.filter((n) => getSymbol(n.type).ports.length > 0 && !getSymbol(n.type).ports.some((p) => used.has(`${n.id}:${p.id}`))).map((n) => n.id);
  const openEnds = s.nodes.filter((n) => n.type === "port_open").map((n) => n.id);
  return { invalidPipes, unconnected, openEnds };
}

/**
 * Smart Connect din capătul unei conducte: capătul liber (port_open) este înlocuit cu portul țintă.
 * Metadatele conductei se păstrează; nodul port_open este eliminat.
 */
export function connectOpenEnd(s: Scheme, openNodeId: string, target: PortRef): { scheme: Scheme; check: ConnectionCheck } {
  const open = s.nodes.find((n) => n.id === openNodeId);
  const pipe = s.pipes.find((p) => p.from.node === openNodeId || p.to.node === openNodeId);
  if (!open || open.type !== "port_open" || !pipe) return { scheme: s, check: { ok: false, reason: "Nu este un capăt liber de conductă" } };
  const other = pipe.from.node === openNodeId ? pipe.to : pipe.from;
  const without = { ...s, pipes: s.pipes.filter((p) => p.id !== pipe.id) };
  const check = validateConnection(without, other, target);
  if (!check.ok) return { scheme: s, check };
  const np: Pipe = pipe.from.node === openNodeId ? { ...pipe, from: target, points: undefined } : { ...pipe, to: target, points: undefined };
  return {
    scheme: { ...s, nodes: s.nodes.filter((n) => n.id !== openNodeId), pipes: s.pipes.map((p) => (p.id === pipe.id ? np : p)) },
    check,
  };
}
