// Generator de tag-uri incremental (pe prefix de tip/circuit) și detecția duplicatelor.
import { CIRCUIT_PREFIX } from "./catalog";
import { getSymbol } from "./symbols";
import type { Pipe, Scheme } from "./types";

/** Următorul tag liber `PREFIX-NN`; nu reutilizează tag-uri existente. */
export function nextTag(prefix: string, existing: Iterable<string>) {
  const set = new Set(existing);
  let n = 1;
  while (set.has(`${prefix}-${String(n).padStart(2, "0")}`)) n++;
  return `${prefix}-${String(n).padStart(2, "0")}`;
}

export function pipeTag(p: Pick<Pipe, "circuit" | "dn">, existing: Iterable<string>) {
  return nextTag(`${CIRCUIT_PREFIX[p.circuit]}-DN${p.dn}`, existing);
}

export const allTags = (s: Scheme) => [...s.nodes.map((n) => n.tag), ...s.pipes.map((p) => p.tag)];

/** Tag-uri folosite de mai multe obiecte → lista de ID-uri afectate. */
export function duplicateTags(s: Scheme): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const o of [...s.nodes, ...s.pipes]) {
    if (!o.tag) continue;
    m.set(o.tag, [...(m.get(o.tag) ?? []), o.id]);
  }
  return new Map([...m].filter(([, ids]) => ids.length > 1));
}

/** Verifică dacă un tag poate fi atribuit unui obiect fără duplicat. */
export function tagAvailable(s: Scheme, tag: string, ownId?: string) {
  return ![...s.nodes, ...s.pipes].some((o) => o.tag === tag && o.id !== ownId);
}

/**
 * Re-numerotare incrementală a obiectelor selectate: `prefix-start`, `prefix-start+1`…
 * Fără prefix: se folosește prefixul tipului. Sare peste tag-urile ocupate de obiecte neselectate.
 */
export function retagSelection(s: Scheme, ids: string[], opts: { prefix?: string | undefined; start?: number | undefined } = {}): Scheme {
  const sel = new Set(ids);
  const used = new Set([...s.nodes, ...s.pipes].filter((o) => !sel.has(o.id)).map((o) => o.tag));
  const counters = new Map<string, number>();
  const take = (prefix: string) => {
    let n = counters.get(prefix) ?? opts.start ?? 1;
    let t = `${prefix}-${String(n).padStart(2, "0")}`;
    while (used.has(t)) { n++; t = `${prefix}-${String(n).padStart(2, "0")}`; }
    counters.set(prefix, n + 1);
    used.add(t);
    return t;
  };
  return {
    ...s,
    nodes: s.nodes.map((n) => (sel.has(n.id) ? { ...n, tag: take(opts.prefix || getSymbol(n.type).prefix) } : n)),
    pipes: s.pipes.map((p) => (sel.has(p.id) ? { ...p, tag: take(opts.prefix || `${CIRCUIT_PREFIX[p.circuit]}-DN${p.dn}`) } : p)),
  };
}
