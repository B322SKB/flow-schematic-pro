/**
 * Copy / Paste inteligent: duplică nodurile selectate și conductele dintre ele (topologie internă),
 * cu ID-uri și tag-uri noi. Conductele selectate cu un capăt în afara selecției devin conducte
 * cu capăt liber (port_open) — rămân neconectate până la Smart Connect.
 */
import { getSymbol } from "./symbols";
import { nextTag, pipeTag, allTags } from "./tags";
import type { Pipe, PidNode, Scheme } from "./types";
import { portPos } from "./hydraulics";

export interface ClipData {
  nodes: PidNode[];
  pipes: Pipe[];
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function copySelectionData(s: Scheme, nodeIds: string[], pipeIds: string[]): ClipData | null {
  const ns = new Set(nodeIds);
  const nodes = s.nodes.filter((n) => ns.has(n.id)).map((n) => structuredClone(n));
  const ps = new Set(pipeIds);
  const pipes: Pipe[] = [];
  const extra: PidNode[] = [];
  for (const p of s.pipes) {
    const fromIn = ns.has(p.from.node), toIn = ns.has(p.to.node);
    if (fromIn && toIn) { pipes.push(structuredClone(p)); continue; }
    if (!ps.has(p.id)) continue;
    // conductă selectată cu capăt(e) extern(e): capătul extern devine capăt liber la poziția actuală
    const q = structuredClone(p);
    for (const end of ["from", "to"] as const) {
      if (ns.has(q[end].node)) continue;
      const pos = portPos(s, q[end].node, q[end].port);
      const id = `open_${uid()}`;
      extra.push({ id, type: "port_open", tag: "CP", x: pos?.x ?? 0, y: pos?.y ?? 0, rotation: 0 });
      q[end] = { node: id, port: "a" };
    }
    q.points = undefined;
    pipes.push(q);
  }
  if (!nodes.length && !pipes.length) return null;
  return { nodes: [...nodes, ...extra], pipes };
}

/** Lipește datele cu un offset; întoarce schema nouă și ID-urile create. */
export function pasteData(s: Scheme, clip: ClipData, offset: { x: number; y: number }) {
  const map = new Map<string, string>();
  const ntags = new Set(allTags(s));
  const nodes: PidNode[] = clip.nodes.map((n) => {
    const id = uid();
    map.set(n.id, id);
    const tag = nextTag(n.type === "port_open" ? "CP" : getSymbol(n.type).prefix, ntags);
    ntags.add(tag);
    return { ...structuredClone(n), id, tag, x: n.x + offset.x, y: n.y + offset.y };
  });
  const pipes: Pipe[] = clip.pipes.map((p) => {
    const np: Pipe = {
      ...structuredClone(p), id: uid(),
      from: { ...p.from, node: map.get(p.from.node)! }, to: { ...p.to, node: map.get(p.to.node)! },
      points: p.points?.map((q) => ({ x: q.x + offset.x, y: q.y + offset.y })),
    };
    np.tag = pipeTag(np, ntags);
    ntags.add(np.tag);
    return np;
  });
  return {
    scheme: { ...s, nodes: [...s.nodes, ...nodes], pipes: [...s.pipes, ...pipes] },
    nodeIds: nodes.map((n) => n.id),
    pipeIds: pipes.map((p) => p.id),
  };
}
