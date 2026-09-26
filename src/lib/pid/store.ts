import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CIRCUIT_PREFIX, type CircuitId, type MaterialId, type JointType } from "./catalog";
import { SYMBOLS, type SymbolType } from "./symbols";
import type { Pipe, PidNode, Scheme } from "./types";
import { pipeRoute } from "./hydraulics";

const uid = () => Math.random().toString(36).slice(2, 10);
export const PX_PER_M = 40;

export interface PipeDefaults {
  dn: number;
  material: MaterialId;
  joint: JointType;
  circuit: CircuitId;
  flow: number;
}

interface State {
  scheme: Scheme;
  selected: { kind: "node" | "pipe"; id: string } | null;
  pipeDefaults: PipeDefaults;
  setScheme: (p: Partial<Scheme>) => void;
  addNode: (type: SymbolType, x: number, y: number) => void;
  updateNode: (id: string, p: Partial<PidNode>) => void;
  addPipe: (from: Pipe["from"], to: Pipe["to"]) => void;
  updatePipe: (id: string, p: Partial<Pipe>) => void;
  select: (s: State["selected"]) => void;
  removeSelected: () => void;
  setPipeDefaults: (p: Partial<PipeDefaults>) => void;
  retag: () => void;
  recalcLengths: () => void;
  reset: (empty?: boolean) => void;
}

function nextTag(prefix: string, existing: string[]) {
  let n = 1;
  const set = new Set(existing);
  while (set.has(`${prefix}-${String(n).padStart(2, "0")}`)) n++;
  return `${prefix}-${String(n).padStart(2, "0")}`;
}
function pipeTag(p: Pick<Pipe, "circuit" | "dn">, existing: string[]) {
  return nextTag(`${CIRCUIT_PREFIX[p.circuit]}-DN${p.dn}`, existing);
}

function routeLen(pipe: Pipe, scheme: Scheme) {
  const pts = pipeRoute(pipe, scheme);
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  return Math.max(0.5, Math.round((L / PX_PER_M) * 10) / 10);
}

function demo(): Scheme {
  const n = (id: string, type: SymbolType, tag: string, x: number, y: number, extra: Partial<PidNode> = {}): PidNode => ({
    id, type, tag, x, y, rotation: 0, dpFixed: SYMBOLS[type].dpDefault, ...extra,
  });
  const nodes: PidNode[] = [
    n("ch", "chiller", "CH-01", 180, 320),
    n("p1", "pump_inline", "P-01", 380, 300),
    n("v1", "v_butterfly", "BFV-01", 500, 300),
    n("t1", "buffer_tank", "TK-01", 680, 340),
    n("cv", "v_control", "CV-01", 860, 280),
    n("cl", "ahu_coil", "CL-01", 1020, 330),
    n("nr", "v_check", "NRV-01", 500, 395),
    n("ev", "expansion", "EV-01", 380, 470),
    n("tee", "tee", "T-01", 380, 395),
    n("pi", "i_pg", "PI-01", 440, 240),
  ];
  const pipes: Pipe[] = [];
  const mk = (from: [string, string], to: [string, string], circuit: CircuitId, dn = 80, flow = 25) =>
    pipes.push({
      id: uid(), tag: "", from: { node: from[0], port: from[1] }, to: { node: to[0], port: to[1] },
      dn, material: "steel_carbon", joint: "grooved", circuit, length: 1, flow, routing: "auto", fittings: {},
    });
  mk(["ch", "c"], ["p1", "a"], "supply");
  mk(["p1", "b"], ["v1", "a"], "supply");
  mk(["v1", "b"], ["t1", "a"], "supply");
  mk(["t1", "c"], ["cv", "a"], "supply");
  mk(["cv", "b"], ["cl", "a"], "supply");
  mk(["cl", "b"], ["t1", "d"], "return");
  mk(["t1", "b"], ["nr", "b"], "return");
  mk(["nr", "a"], ["tee", "b"], "return");
  mk(["tee", "a"], ["ch", "d"], "return");
  mk(["tee", "c"], ["ev", "a"], "return", 25, 0);
  const s: Scheme = { name: "Circuit apă răcită – demo", nodes, pipes, fluid: "eg", concentration: 30, temperature: 7 };
  const tags: string[] = [];
  for (const p of s.pipes) { p.tag = pipeTag(p, tags); tags.push(p.tag); p.length = routeLen(p, s); }
  s.pipes[0].fittings = { elbow90: 2 };
  s.pipes[6].fittings = { strainer: 1 };
  return s;
}

export const usePid = create<State>()(
  persist(
    (set, get) => ({
      scheme: demo(),
      selected: null,
      pipeDefaults: { dn: 80, material: "steel_carbon", joint: "grooved", circuit: "supply", flow: 20 },
      setScheme: (p) => set((st) => ({ scheme: { ...st.scheme, ...p } })),
      addNode: (type, x, y) =>
        set((st) => {
          const sym = SYMBOLS[type];
          const node: PidNode = {
            id: uid(), type, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, rotation: 0,
            tag: nextTag(sym.prefix, st.scheme.nodes.map((n) => n.tag)), dpFixed: sym.dpDefault,
          };
          return { scheme: { ...st.scheme, nodes: [...st.scheme.nodes, node] }, selected: { kind: "node", id: node.id } };
        }),
      updateNode: (id, p) =>
        set((st) => {
          const scheme = { ...st.scheme, nodes: st.scheme.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) };
          return { scheme };
        }),
      addPipe: (from, to) =>
        set((st) => {
          if (from.node === to.node && from.port === to.port) return {};
          const d = st.pipeDefaults;
          const pipe: Pipe = {
            id: uid(), tag: "", from, to, dn: d.dn, material: d.material, joint: d.joint, circuit: d.circuit,
            length: 1, flow: d.flow, routing: "auto", fittings: {},
          };
          pipe.tag = pipeTag(pipe, st.scheme.pipes.map((p) => p.tag));
          pipe.length = routeLen(pipe, st.scheme);
          return { scheme: { ...st.scheme, pipes: [...st.scheme.pipes, pipe] }, selected: { kind: "pipe", id: pipe.id } };
        }),
      updatePipe: (id, p) =>
        set((st) => ({ scheme: { ...st.scheme, pipes: st.scheme.pipes.map((x) => (x.id === id ? { ...x, ...p } : x)) } })),
      select: (s) => set({ selected: s }),
      removeSelected: () => {
        const sel = get().selected;
        if (!sel) return;
        set((st) => {
          if (sel.kind === "pipe") return { scheme: { ...st.scheme, pipes: st.scheme.pipes.filter((p) => p.id !== sel.id) }, selected: null };
          return {
            scheme: {
              ...st.scheme,
              nodes: st.scheme.nodes.filter((n) => n.id !== sel.id),
              pipes: st.scheme.pipes.filter((p) => p.from.node !== sel.id && p.to.node !== sel.id),
            },
            selected: null,
          };
        });
      },
      setPipeDefaults: (p) => set((st) => ({ pipeDefaults: { ...st.pipeDefaults, ...p } })),
      retag: () =>
        set((st) => {
          const tags: string[] = [];
          const pipes = st.scheme.pipes.map((p) => { const tag = pipeTag(p, tags); tags.push(tag); return { ...p, tag }; });
          const ntags: string[] = [];
          const nodes = st.scheme.nodes.map((n) => { const tag = nextTag(SYMBOLS[n.type].prefix, ntags); ntags.push(tag); return { ...n, tag }; });
          return { scheme: { ...st.scheme, pipes, nodes } };
        }),
      recalcLengths: () => set((st) => ({ scheme: { ...st.scheme, pipes: st.scheme.pipes.map((p) => ({ ...p, length: routeLen(p, st.scheme) })) } })),
      reset: (empty) =>
        set({ selected: null, scheme: empty ? { name: "Schemă nouă", nodes: [], pipes: [], fluid: "water", concentration: 0, temperature: 10 } : demo() }),
    }),
    { name: "pid-studio-v1", partialize: (s) => ({ scheme: s.scheme, pipeDefaults: s.pipeDefaults }) },
  ),
);
