/**
 * Module / șabloane reutilizabile. Un modul este un fragment de model (noduri + conducte interne)
 * cu ID-uri locale. Registrul este extensibil: module încorporate (BUILTIN_MODULES) și module
 * salvate de utilizator folosesc aceeași funcție de inserare (insertModuleData).
 */
import type { CircuitId } from "./catalog";
import { getSymbol } from "./symbols";
import { allTags, nextTag, pipeTag } from "./tags";
import type { Pipe, PidNode, Scheme } from "./types";

export interface ModuleData { id: string; name: string; desc?: string | undefined; nodes: PidNode[]; pipes: Pipe[] }

const uid = () => Math.random().toString(36).slice(2, 10);

function builder() {
  const nodes: PidNode[] = [];
  const pipes: Pipe[] = [];
  const n = (id: string, type: string, x: number, y: number, extra: Partial<PidNode> = {}) => {
    nodes.push({ id, type, tag: "", x, y, rotation: 0, dpFixed: getSymbol(type).dpDefault, ...extra });
  };
  const p = (id: string, from: [string, string], to: [string, string], circuit: CircuitId, dn: number, length = 2, extra: Partial<Pipe> = {}) => {
    pipes.push({ id, tag: "", from: { node: from[0], port: from[1] }, to: { node: to[0], port: to[1] }, dn, material: "steel_carbon",
      joint: dn <= 50 ? "threaded" : "grooved", circuit, length, flow: 0, flowMode: "manual", routing: "auto", fittings: {}, ...extra });
  };
  return { nodes, pipes, n, p };
}

function chillerHeader(): ModuleData {
  const b = builder();
  b.n("ch", "chiller", 0, 0, { kw: 300, deltaT: 5 });
  b.n("p1", "pump_inline", 200, -80);
  b.n("v1", "v_butterfly", 320, -80);
  b.n("nrv", "v_check", 420, -80);
  b.n("hdr", "tee", 540, -80);
  b.n("vr", "v_butterfly", 320, 80);
  b.n("str", "strainer", 200, 80);
  b.p("a", ["ch", "c"], ["p1", "a"], "supply", 100);
  b.p("b", ["p1", "b"], ["v1", "a"], "supply", 100, 0, { direct: true });
  b.p("c", ["v1", "b"], ["nrv", "a"], "supply", 100, 0, { direct: true });
  b.p("d", ["nrv", "b"], ["hdr", "a"], "supply", 100);
  b.p("e", ["vr", "a"], ["str", "b"], "return", 100, 0, { direct: true });
  b.p("f", ["str", "a"], ["ch", "d"], "return", 100);
  return { id: "builtin:chiller_header", name: "Chiller + pompă + header", desc: "Chiller, pompă inline, vană, clapetă, teu de distribuție; retur cu filtru.", ...b };
}

function crahCircuit(type: "ccu" | "fanwall"): ModuleData {
  const b = builder();
  b.n("u", type, 0, 0, { kw: 80, kwSens: 72, deltaT: 6 });
  b.n("vs", "v_ball", -160, -30);
  b.n("str", "strainer", -260, -30);
  b.n("vr", "v_balancing", -160, 30);
  b.n("cv", "v_motorized", -260, 30);
  b.p("a", ["str", "b"], ["vs", "a"], "supply", 50, 0, { direct: true });
  b.p("b", ["vs", "b"], ["u", "a"], "supply", 50, 1.5);
  b.p("c", ["u", "b"], ["vr", "b"], "return", 50, 1.5);
  b.p("d", ["vr", "a"], ["cv", "b"], "return", 50, 0, { direct: true });
  const name = type === "ccu" ? "Circuit CRAH / CCU" : "Circuit Fan Wall";
  return { id: `builtin:${type}_circuit`, name, desc: "Unitate terminală cu izolare, filtru, vană de echilibrare și vană motorizată pe retur.", ...b };
}

function valveAssembly(): ModuleData {
  const b = builder();
  b.n("g1", "v_butterfly", 0, 0);
  b.n("str", "strainer", 100, 0);
  b.n("cv", "v_control", 200, 0);
  b.n("bv", "v_balancing", 300, 0);
  b.n("g2", "v_butterfly", 400, 0);
  b.p("a", ["g1", "b"], ["str", "a"], "supply", 80, 0, { direct: true });
  b.p("b", ["str", "b"], ["cv", "a"], "supply", 80, 0, { direct: true });
  b.p("c", ["cv", "b"], ["bv", "a"], "supply", 80, 0, { direct: true });
  b.p("d", ["bv", "b"], ["g2", "a"], "supply", 80, 0, { direct: true });
  return { id: "builtin:valve_assembly", name: "Ansamblu vane de reglaj", desc: "Izolare – filtru Y – vană de reglaj – echilibrare – izolare.", ...b };
}

export const BUILTIN_MODULES: ModuleData[] = [chillerHeader(), crahCircuit("ccu"), crahCircuit("fanwall"), valveAssembly()];

/** Inserează un modul centrat în (x, y), cu ID-uri și tag-uri unice; conexiunile interne se păstrează. */
export function insertModuleData(s: Scheme, m: ModuleData, x: number, y: number) {
  if (!m.nodes.length) return { scheme: s, nodeIds: [] as string[], pipeIds: [] as string[] };
  const xs = m.nodes.map((n) => n.x), ys = m.nodes.map((n) => n.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const map = new Map<string, string>();
  const tags = new Set(allTags(s));
  const nodes = m.nodes.map((n) => {
    const id = uid();
    map.set(n.id, id);
    const tag = nextTag(getSymbol(n.type).prefix, tags);
    tags.add(tag);
    return { ...structuredClone(n), id, tag, x: Math.round(n.x - cx + x), y: Math.round(n.y - cy + y) };
  });
  const pipes = m.pipes.filter((p) => map.has(p.from.node) && map.has(p.to.node)).map((p) => {
    const np: Pipe = { ...structuredClone(p), id: uid(), from: { ...p.from, node: map.get(p.from.node)! }, to: { ...p.to, node: map.get(p.to.node)! }, points: undefined };
    np.tag = pipeTag(np, tags);
    tags.add(np.tag);
    return np;
  });
  return { scheme: { ...s, nodes: [...s.nodes, ...nodes], pipes: [...s.pipes, ...pipes] }, nodeIds: nodes.map((n) => n.id), pipeIds: pipes.map((p) => p.id) };
}
