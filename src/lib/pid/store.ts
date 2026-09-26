import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  CIRCUIT_PREFIX, DEFAULT_CIRCUIT_COLORS, type CircuitId, type MaterialId, type JointType,
} from "./catalog";
import { getSymbol, syncCustomSymbols, type CustomSymbol, type SymbolType } from "./symbols";
import type { Pipe, PidNode, Scheme } from "./types";
import { pipeRoute } from "./hydraulics";
import { flowFromKw, fluidProps } from "./fluids";

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
  pipeDefaults: PipeDefaults;
  scheme: Scheme;
  setScheme: (p: Partial<Scheme>) => void;
  addNode: (type: SymbolType, x: number, y: number) => void;
  updateNode: (id: string, p: Partial<PidNode>) => void;
  addPipe: (from: Pipe["from"], to: Pipe["to"]) => void;
  updatePipe: (id: string, p: Partial<Pipe>) => void;
  flipPipe: (id: string) => void;
  select: (s: State["selected"]) => void;
  removeSelected: () => void;
  setPipeDefaults: (p: Partial<PipeDefaults>) => void;
  retag: () => void;
  setCircuitColor: (c: CircuitId, color: string) => void;
  resetCircuitColors: () => void;
  addCustomSymbol: (c: Omit<CustomSymbol, "id">) => void;
  removeCustomSymbol: (id: string) => void;
  newProject: (name?: string, demoScheme?: boolean) => void;
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
    n("t1", "buffer_tank", "TK-01", 680, 340),
    n("cv", "v_control", "CV-01", 860, 280),
    n("cl", "ahu_coil", "CL-01", 1020, 330, { kw: 120, deltaT: 5 }),
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
        pipeDefaults: { dn: 80, material: "steel_carbon", joint: "grooved", circuit: "supply", flow: 20, length: 5 },

        setScheme: (p) => patchScheme((s) => ({ ...s, ...p })),

        addNode: (type, x, y) => {
          const st = get();
          const sym = getSymbol(type);
          const node: PidNode = {
            id: uid(), type, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, rotation: 0,
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

        addPipe: (from, to) => {
          const st = get();
          if (from.node === to.node && from.port === to.port) return;
          const d = st.pipeDefaults;
          const pipe: Pipe = {
            id: uid(), tag: "", from, to, dn: d.dn, material: d.material, joint: d.joint, circuit: d.circuit,
            length: d.length, flow: d.flow, flowMode: "manual", routing: "auto", fittings: {},
          };
          pipe.tag = pipeTag(pipe, st.scheme.pipes.map((p) => p.tag));
          pipe.length = routeLen(pipe, st.scheme);
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

        flipPipe: (id) =>
          patchScheme((s) => ({
            ...s,
            pipes: s.pipes.map((p) => (p.id === id ? { ...p, from: p.to, to: p.from } : p)),
          })),

        select: (s) => set({ selected: s }),

        removeSelected: () => {
          const sel = get().selected;
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

        newProject: (name, demoScheme) =>
          set((st) => {
            const s = demoScheme ? { ...demo(), name: name ?? "Copie demo" } : emptyScheme(name);
            syncCustomSymbols(s.customSymbols);
            return { projects: [...st.projects, s], activeId: s.id, scheme: s, selected: null };
          }),

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
      partialize: (s) => ({ projects: s.projects, activeId: s.activeId, pipeDefaults: s.pipeDefaults }),
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
