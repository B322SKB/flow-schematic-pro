import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  CIRCUIT_PREFIX, DEFAULT_CIRCUIT_COLORS, type CircuitId, type MaterialId, type JointType,
} from "./catalog";
import { getSymbol, syncCustomSymbols, type CustomSymbol, type SymbolType } from "./symbols";
import type { Pipe, PidNode, Scheme } from "./types";
import { pipeRoute } from "./hydraulics";
import { flowFromKw, fluidProps } from "./fluids";
import { propagateFlows } from "./network";

const uid = () => Math.random().toString(36).slice(2, 10);
export const PX_PER_M = 40;

export interface PipeDefaults {
  dn: number;
  material: MaterialId;
  joint: JointType;
  circuit: CircuitId;
  flow: number;
  length: number;
}

interface State {
  projects: Scheme[];
  activeId: string;
  selected: { kind: "node" | "pipe"; id: string } | null;
  multi: string[]; // noduri selectate în grup
  grid: number; // pas grilă (px)
  setGrid: (g: number) => void;
  setMulti: (ids: string[]) => void;
  moveNodes: (ids: string[], dx: number, dy: number) => void;
  duplicateNodes: (ids: string[]) => void;
  pipeDefaults: PipeDefaults;
  scheme: Scheme;
  setScheme: (p: Partial<Scheme>) => void;
  addNode: (type: SymbolType, x: number, y: number) => void;
  updateNode: (id: string, p: Partial<PidNode>) => void;
  addPipe: (from: Pipe["from"], to: Pipe["to"], opts?: { direct?: boolean }) => void;
  updatePipe: (id: string, p: Partial<Pipe>) => void;
  flipPipe: (id: string) => void;
  insertOnPipe: (pipeId: string, type: SymbolType, x: number, y: number) => boolean;
  select: (s: State["selected"]) => void;
  removeSelected: () => void;
  setPipeDefaults: (p: Partial<PipeDefaults>) => void;
  retag: () => void;
  setCircuitColor: (c: CircuitId, color: string) => void;
  resetCircuitColors: () => void;
  addCustomSymbol: (c: Omit<CustomSymbol, "id">) => void;
  removeCustomSymbol: (id: string) => void;
  newProject: (name?: string, template?: "empty" | "demo" | "ring_dc") => void;
  applyAutoFlows: () => { updated: number; ambiguous: number };
  switchProject: (id: string) => void;
  duplicateProject: (id: string) => void;
  deleteProject: (id: string) => void;
  importProject: (raw: string) => string | null;
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

/** Estimare inițială a lungimii din desen; ulterior lungimea este editată manual. */
function routeLen(pipe: Pipe, scheme: Scheme) {
  const pts = pipeRoute(pipe, scheme);
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.abs(pts[i]!.x - pts[i - 1]!.x) + Math.abs(pts[i]!.y - pts[i - 1]!.y);
  return Math.max(0.5, Math.round((L / PX_PER_M) * 10) / 10);
}

function emptyScheme(name = "Proiect nou"): Scheme {
  return {
    id: uid(), name, nodes: [], pipes: [], fluid: "water", concentration: 0, temperature: 10,
    deltaT: 5, circuitColors: { ...DEFAULT_CIRCUIT_COLORS }, customSymbols: [], revision: "R00",
    updatedAt: Date.now(),
  };
}

function demo(): Scheme {
  const n = (id: string, type: SymbolType, tag: string, x: number, y: number, extra: Partial<PidNode> = {}): PidNode => ({
    id, type, tag, x, y, rotation: 0, dpFixed: getSymbol(type).dpDefault, ...extra,
  });
  const nodes: PidNode[] = [
    n("ch", "chiller", "CH-01", 180, 320, { kw: 350, deltaT: 5 }),
    n("p1", "pump_inline", "P-01", 380, 300),
    n("v1", "v_butterfly", "BFV-01", 500, 300),
    n("t1", "buffer_tank", "TK-01", 680, 340, { volume: 1000 }),
    n("cv", "v_control", "CV-01", 860, 280),
    n("cl", "ahu_coil", "CL-01", 1020, 330, { kw: 120, kwSens: 105, deltaT: 5 }),
    n("nr", "v_check", "NRV-01", 500, 395),
    n("ev", "expansion", "EV-01", 380, 470),
    n("tee", "tee", "T-01", 380, 395),
    n("pi", "i_pg", "PI-01", 440, 240),
  ];
  const pipes: Pipe[] = [];
  const mk = (from: [string, string], to: [string, string], circuit: CircuitId, dn = 80, flow = 25) =>
    pipes.push({
      id: uid(), tag: "", from: { node: from[0]!, port: from[1]! }, to: { node: to[0]!, port: to[1]! },
      dn, material: "steel_carbon", joint: "grooved", circuit, length: 1, flow, flowMode: "manual",
      routing: "auto", fittings: {},
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
  const s: Scheme = { ...emptyScheme("Circuit apă răcită – demo"), nodes, pipes, fluid: "eg", concentration: 30, temperature: 7 };
  const tags: string[] = [];
  for (const p of s.pipes) { p.tag = pipeTag(p, tags); tags.push(p.tag); p.length = routeLen(p, s); }
  s.pipes[0]!.fittings = { elbow90: 2 };
  s.pipes[6]!.fittings = { strainer: 1 };
  return s;
}

/** Șablon: buclă inel Data Center, chillere N+1 cu modul hidraulic integrat, consumatori IRU/RDHX/CCU. */
function ringDc(): Scheme {
  const n = (id: string, type: SymbolType, tag: string, x: number, y: number, extra: Partial<PidNode> = {}): PidNode => ({
    id, type, tag, x, y, rotation: 0, dpFixed: getSymbol(type).dpDefault, ...extra,
  });
  const nodes: PidNode[] = [
    n("ch1", "chiller", "CH-01", 120, 200, { kw: 400, deltaT: 6, intPump: "twin", pumpHead: 150 }),
    n("ch2", "chiller", "CH-02", 120, 620, { kw: 400, deltaT: 6, intPump: "twin", pumpHead: 150, redundant: true }),
    n("ts1", "tee", "T-01", 520, 140),
    n("ts2", "tee", "T-02", 880, 140),
    n("ts3", "tee", "T-03", 1240, 140),
    n("ts4", "tee", "T-04", 1520, 140),
    n("tr1", "tee", "T-05", 520, 700, { rotation: 180 }),
    n("tr2", "tee", "T-06", 880, 700, { rotation: 180 }),
    n("tr3", "tee", "T-07", 1240, 700, { rotation: 180 }),
    n("tr4", "tee", "T-08", 1520, 700, { rotation: 180 }),
    n("iru", "inrow", "IRU-01", 440, 400, { kw: 60, kwSens: 60, deltaT: 6 }),
    n("rdhx", "rdhx", "RDHX-01", 800, 400, { kw: 45, kwSens: 45, deltaT: 6 }),
    n("ccu", "ccu", "CCU-01", 1160, 400, { kw: 80, kwSens: 70, deltaT: 6 }),
  ];
  const pipes: Pipe[] = [];
  const mk = (from: [string, string], to: [string, string], circuit: CircuitId, dn = 100) =>
    pipes.push({
      id: uid(), tag: "", from: { node: from[0]!, port: from[1]! }, to: { node: to[0]!, port: to[1]! },
      dn, material: "steel_carbon", joint: "grooved", circuit, length: 1, flow: 0, flowMode: "manual",
      routing: "auto", fittings: {},
    });
  // inel tur
  mk(["ch1", "c"], ["ts1", "a"], "supply");
  mk(["ts1", "b"], ["ts2", "a"], "supply");
  mk(["ts2", "b"], ["ts3", "a"], "supply");
  mk(["ts3", "b"], ["ts4", "a"], "supply");
  mk(["ts4", "b"], ["ch2", "c"], "supply");
  // inel retur
  mk(["tr1", "a"], ["ch1", "d"], "return");
  mk(["tr1", "b"], ["tr2", "a"], "return");
  mk(["tr2", "b"], ["tr3", "a"], "return");
  mk(["tr3", "b"], ["tr4", "a"], "return");
  mk(["tr4", "b"], ["ch2", "d"], "return");
  // consumatori
  mk(["ts1", "c"], ["iru", "a"], "supply", 50);
  mk(["iru", "b"], ["tr1", "c"], "return", 50);
  mk(["ts2", "c"], ["rdhx", "a"], "supply", 50);
  mk(["rdhx", "b"], ["tr2", "c"], "return", 50);
  mk(["ts3", "c"], ["ccu", "a"], "supply", 50);
  mk(["ccu", "b"], ["tr3", "c"], "return", 50);
  const s: Scheme = { ...emptyScheme("Inel Data Center – N+1"), nodes, pipes, fluid: "eg", concentration: 30, temperature: 12, deltaT: 6 };
  const tags: string[] = [];
  for (const p of s.pipes) { p.tag = pipeTag(p, tags); tags.push(p.tag); p.length = routeLen(p, s); }
  return s;
}

export type TemplateId = "empty" | "demo" | "ring_dc";
export const TEMPLATES: { id: TemplateId; name: string; desc: string }[] = [
  { id: "empty", name: "Proiect gol", desc: "Pornești de la o planșă liberă." },
  { id: "demo", name: "Circuit primar cu rezervor tampon", desc: "Chiller, pompă, rezervor tampon, vană de reglaj și baterie." },
  { id: "ring_dc", name: "Inel Data Center N+1", desc: "Două chillere cu modul hidraulic integrat, buclă inel tur/retur, IRU + RDHX + CCU." },
];
export function buildTemplate(id: TemplateId, name?: string): Scheme {
  const s = id === "demo" ? demo() : id === "ring_dc" ? ringDc() : emptyScheme(name ?? "Proiect nou");
  return name ? { ...s, name } : s;
}

const first = demo();


function touch(s: Scheme): Scheme {
  return { ...s, updatedAt: Date.now() };
}

export const usePid = create<State>()(
  persist(
    (set, get) => {
      /** Aplică o transformare pe schema activă și sincronizează lista de proiecte. */
      const patchScheme = (fn: (s: Scheme) => Scheme, extra?: Partial<State>) =>
        set((st) => {
          const scheme = touch(fn(st.scheme));
          return {
            scheme,
            projects: st.projects.map((p) => (p.id === scheme.id ? scheme : p)),
            ...extra,
          } as Partial<State>;
        });

      return {
        projects: [first],
        activeId: first.id,
        scheme: first,
        selected: null,
        multi: [],
        grid: 5,
        setGrid: (g) => set({ grid: g }),
        setMulti: (ids) => set({ multi: ids }),
        moveNodes: (ids, dx, dy) => {
          const set_ = new Set(ids);
          patchScheme((s) => ({ ...s, nodes: s.nodes.map((n) => (set_.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) }));
        },
        duplicateNodes: (ids) => {
          const st = get();
          const src = new Set(ids);
          const map = new Map<string, string>();
          const tags = st.scheme.nodes.map((n) => n.tag);
          const nodes: PidNode[] = [];
          for (const n of st.scheme.nodes) {
            if (!src.has(n.id)) continue;
            const id = uid();
            map.set(n.id, id);
            const tag = nextTag(getSymbol(n.type).prefix, tags);
            tags.push(tag);
            nodes.push({ ...structuredClone(n), id, tag, y: n.y + 120 });
          }
          const ptags = st.scheme.pipes.map((p) => p.tag);
          const pipes: Pipe[] = [];
          for (const p of st.scheme.pipes) {
            const a = map.get(p.from.node), b = map.get(p.to.node);
            if (!a || !b) continue;
            const np: Pipe = { ...structuredClone(p), id: uid(), from: { ...p.from, node: a }, to: { ...p.to, node: b } };
            np.tag = pipeTag(np, ptags);
            ptags.push(np.tag);
            pipes.push(np);
          }
          patchScheme((s) => ({ ...s, nodes: [...s.nodes, ...nodes], pipes: [...s.pipes, ...pipes] }),
            { multi: nodes.map((n) => n.id), selected: nodes[0] ? { kind: "node", id: nodes[0].id } : null });
        },
        pipeDefaults: { dn: 80, material: "steel_carbon", joint: "grooved", circuit: "supply", flow: 20, length: 5 },

        setScheme: (p) => patchScheme((s) => ({ ...s, ...p })),

        addNode: (type, x, y) => {
          const st = get();
          const sym = getSymbol(type);
          const node: PidNode = {
            id: uid(), type, x: Math.round(x / st.grid) * st.grid, y: Math.round(y / st.grid) * st.grid, rotation: 0,
            tag: nextTag(sym.prefix, st.scheme.nodes.map((n) => n.tag)), dpFixed: sym.dpDefault,
            ...(sym.riser ? { z: 1 } : {}),
          };
          patchScheme((s) => ({ ...s, nodes: [...s.nodes, node] }), { selected: { kind: "node", id: node.id } });
        },

        updateNode: (id, p) =>
          patchScheme((s) => ({
            ...s,
            nodes: s.nodes.map((n) => {
              if (n.id !== id) return n;
              const next = { ...n, ...p };
              if (next.kw && next.deltaT) {
                const fp = fluidProps(s.fluid, s.concentration, s.temperature);
                next.flow = flowFromKw(next.kw, next.deltaT, fp);
              }
              return next;
            }),
          })),

        addPipe: (from, to, opts) => {
          const st = get();
          if (from.node === to.node && from.port === to.port) return;
          const d = st.pipeDefaults;
          // moștenire circuit / DN / debit de la conducta din aval (sau, altfel, de la o conductă vecină)
          const ps = st.scheme.pipes.filter((p) => !p.direct);
          const src = ps.find((p) => p.from.node === to.node) ?? ps.find((p) => p.to.node === from.node)
            ?? ps.find((p) => p.from.node === from.node || p.to.node === to.node);
          const pipe: Pipe = {
            id: uid(), tag: "", from, to, dn: src?.dn ?? d.dn, material: src?.material ?? d.material, joint: src?.joint ?? d.joint,
            circuit: src?.circuit ?? d.circuit, length: d.length, flow: src?.flow ?? d.flow, flowMode: "manual", routing: "auto", fittings: {},
          };
          pipe.tag = pipeTag(pipe, st.scheme.pipes.map((p) => p.tag));
          pipe.length = opts?.direct ? 0 : routeLen(pipe, st.scheme);
          if (opts?.direct) pipe.direct = true;
          patchScheme((s) => ({ ...s, pipes: [...s.pipes, pipe] }), { selected: { kind: "pipe", id: pipe.id } });
        },

        updatePipe: (id, p) =>
          patchScheme((s) => ({
            ...s,
            pipes: s.pipes.map((x) => {
              if (x.id !== id) return x;
              const next = { ...x, ...p };
              if (next.flowMode === "kw") {
                const fp = fluidProps(s.fluid, s.concentration, s.temperature);
                next.flow = flowFromKw(next.kw ?? 0, next.deltaT ?? s.deltaT, fp);
              }
              return next;
            }),
          })),

        insertOnPipe: (pipeId, type, x, y) => {
          const st = get();
          const s0 = st.scheme;
          const pipe = s0.pipes.find((p) => p.id === pipeId);
          const sym = getSymbol(type);
          if (!pipe || pipe.direct || sym.ports.length < 2) return false;
          const pts = pipeRoute(pipe, s0);
          let best = { d: Infinity, x, y, i: 1, t: 0.5 };
          let acc = 0, total = 0;
          const segL: number[] = [];
          for (let i = 1; i < pts.length; i++) { const L = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y); segL.push(L); total += L; }
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1]!, b = pts[i]!;
            const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
            const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / L2));
            const px = a.x + t * (b.x - a.x), py = a.y + t * (b.y - a.y);
            const dd = Math.hypot(px - x, py - y);
            if (dd < best.d) best = { d: dd, x: px, y: py, i, t };
          }
          for (let i = 1; i < best.i; i++) acc += segL[i - 1]!;
          acc += segL[best.i - 1]! * best.t;
          const frac = total ? acc / total : 0.5;
          const a = pts[best.i - 1]!, b = pts[best.i]!;
          const vert = Math.abs(b.x - a.x) < 1;
          const rotation = vert ? (b.y > a.y ? 90 : 270) : b.x >= a.x ? 0 : 180;
          const [pa, pb] = [sym.ports[0]!, sym.ports[1]!];
          // centrul elementului pe traseu (portul a spre amonte)
          const mid = { x: ((pa.x + pb.x) / 2 - sym.w / 2), y: ((pa.y + pb.y) / 2 - sym.h / 2) };
          const rad = (rotation * Math.PI) / 180;
          const node: PidNode = {
            id: uid(), type, rotation, tag: nextTag(sym.prefix, s0.nodes.map((n) => n.tag)), dpFixed: sym.dpDefault,
            x: best.x - (mid.x * Math.cos(rad) - mid.y * Math.sin(rad)),
            y: best.y - (mid.x * Math.sin(rad) + mid.y * Math.cos(rad)),
            ...(sym.riser ? { z: 1 } : {}),
          };
          const L1 = Math.round(pipe.length * frac * 10) / 10;
          const p1: Pipe = { ...pipe, to: { node: node.id, port: pa.id }, length: L1, points: undefined };
          const p2: Pipe = { ...pipe, id: uid(), from: { node: node.id, port: pb.id }, length: Math.round((pipe.length - L1) * 10) / 10, fittings: {}, points: undefined };
          p2.tag = pipeTag(p2, s0.pipes.map((p) => p.tag));
          patchScheme((s) => ({ ...s, nodes: [...s.nodes, node], pipes: s.pipes.flatMap((p) => (p.id === pipeId ? [p1, p2] : [p])) }),
            { selected: { kind: "node", id: node.id } });
          return true;
        },

        flipPipe: (id) =>
          patchScheme((s) => ({
            ...s,
            pipes: s.pipes.map((p) => (p.id === id ? { ...p, from: p.to, to: p.from, points: p.points ? [...p.points].reverse() : undefined } : p)),
          })),

        select: (s) => set((st) => ({ selected: s, multi: s?.kind === "node" && st.multi.includes(s.id) ? st.multi : [] })),

        removeSelected: () => {
          const sel = get().selected;
          const multi = get().multi;
          if (multi.length > 1) {
            const ids = new Set(multi);
            patchScheme((s) => ({
              ...s,
              nodes: s.nodes.filter((n) => !ids.has(n.id)),
              pipes: s.pipes.filter((p) => !ids.has(p.from.node) && !ids.has(p.to.node)),
            }), { selected: null, multi: [] });
            return;
          }
          if (!sel) return;
          patchScheme((s) => sel.kind === "pipe"
            ? { ...s, pipes: s.pipes.filter((p) => p.id !== sel.id) }
            : {
              ...s,
              nodes: s.nodes.filter((n) => n.id !== sel.id),
              pipes: s.pipes.filter((p) => p.from.node !== sel.id && p.to.node !== sel.id),
            }, { selected: null });
        },

        setPipeDefaults: (p) => set((st) => ({ pipeDefaults: { ...st.pipeDefaults, ...p } })),

        retag: () =>
          patchScheme((s) => {
            const tags: string[] = [];
            const pipes = s.pipes.map((p) => { const tag = pipeTag(p, tags); tags.push(tag); return { ...p, tag }; });
            const ntags: string[] = [];
            const nodes = s.nodes.map((n) => { const tag = nextTag(getSymbol(n.type).prefix, ntags); ntags.push(tag); return { ...n, tag }; });
            return { ...s, pipes, nodes };
          }),

        setCircuitColor: (c, color) => patchScheme((s) => ({ ...s, circuitColors: { ...s.circuitColors, [c]: color } })),
        resetCircuitColors: () => patchScheme((s) => ({ ...s, circuitColors: { ...DEFAULT_CIRCUIT_COLORS } })),

        addCustomSymbol: (c) =>
          patchScheme((s) => {
            const list = [...s.customSymbols, { ...c, id: uid() }];
            syncCustomSymbols(list);
            return { ...s, customSymbols: list };
          }),

        removeCustomSymbol: (id) =>
          patchScheme((s) => {
            const list = s.customSymbols.filter((c) => c.id !== id);
            syncCustomSymbols(list);
            return {
              ...s,
              customSymbols: list,
              nodes: s.nodes.filter((n) => n.type !== `custom:${id}`),
            };
          }),

        newProject: (name, template) =>
          set((st) => {
            const s = buildTemplate(template ?? "empty", name);
            syncCustomSymbols(s.customSymbols);
            return { projects: [...st.projects, s], activeId: s.id, scheme: s, selected: null };
          }),

        /** Însumarea automată a debitelor la teuri, pornind de la consumatorii activi. */
        applyAutoFlows: () => {
          const st = get();
          const fp = fluidProps(st.scheme.fluid, st.scheme.concentration, st.scheme.temperature);
          const flows = propagateFlows(st.scheme, fp);
          let updated = 0, ambiguous = 0;
          patchScheme((s) => ({
            ...s,
            pipes: s.pipes.map((p) => {
              const info = flows.get(p.id);
              if (!info) return p;
              if (info.ambiguous) { ambiguous++; return p; }
              if (Math.abs(info.flow - p.flow) < 0.005) return p;
              updated++;
              return { ...p, flow: info.flow, flowMode: "manual" as const };
            }),
          }));
          return { updated, ambiguous };
        },

        switchProject: (id) =>
          set((st) => {
            const s = st.projects.find((p) => p.id === id);
            if (!s) return {};
            syncCustomSymbols(s.customSymbols);
            return { activeId: id, scheme: s, selected: null };
          }),

        duplicateProject: (id) =>
          set((st) => {
            const src = st.projects.find((p) => p.id === id);
            if (!src) return {};
            const copy: Scheme = { ...structuredClone(src), id: uid(), name: `${src.name} (copie)`, updatedAt: Date.now() };
            syncCustomSymbols(copy.customSymbols);
            return { projects: [...st.projects, copy], activeId: copy.id, scheme: copy, selected: null };
          }),

        deleteProject: (id) =>
          set((st) => {
            const rest = st.projects.filter((p) => p.id !== id);
            const list = rest.length ? rest : [emptyScheme()];
            const active = list.find((p) => p.id === st.activeId) ?? list[0]!;
            syncCustomSymbols(active.customSymbols);
            return { projects: list, activeId: active.id, scheme: active, selected: null };
          }),

        importProject: (raw) => {
          try {
            const data = JSON.parse(raw) as Scheme;
            if (!Array.isArray(data.nodes) || !Array.isArray(data.pipes)) return "Fișier nevalid.";
            const s: Scheme = {
              ...emptyScheme(data.name || "Proiect importat"),
              ...data,
              id: uid(),
              circuitColors: { ...DEFAULT_CIRCUIT_COLORS, ...(data.circuitColors ?? {}) },
              customSymbols: data.customSymbols ?? [],
              updatedAt: Date.now(),
            };
            syncCustomSymbols(s.customSymbols);
            set((st) => ({ projects: [...st.projects, s], activeId: s.id, scheme: s, selected: null }));
            return null;
          } catch {
            return "Fișierul nu a putut fi citit.";
          }
        },

        reset: (empty) =>
          set((st) => {
            const s = empty ? emptyScheme(st.scheme.name) : { ...demo(), id: st.scheme.id, name: st.scheme.name };
            syncCustomSymbols(s.customSymbols);
            return { scheme: s, projects: st.projects.map((p) => (p.id === st.activeId ? s : p)), selected: null };
          }),
      };
    },
    {
      name: "pid-studio-v2",
      partialize: (s) => ({ projects: s.projects, activeId: s.activeId, pipeDefaults: s.pipeDefaults, grid: s.grid }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        const projects = p.projects?.length ? p.projects : current.projects;
        const scheme = projects.find((x) => x.id === p.activeId) ?? projects[0]!;
        syncCustomSymbols(scheme.customSymbols ?? []);
        return { ...current, ...p, projects, activeId: scheme.id, scheme };
      },
    },
  ),
);
