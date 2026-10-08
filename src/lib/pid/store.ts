import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_CIRCUIT_COLORS,
  type CircuitId, type MaterialId, type JointType,
} from "./catalog";
import { getSymbol, syncCustomSymbols, type CustomSymbol, type SymbolType } from "./symbols";
import type { Pipe, PidNode, Scheme } from "./types";
import { pipeRoute } from "./hydraulics";
import { planSizing, type SizingMode } from "./sizing";
import { solveNetwork } from "./solver";
import { flowFromKw, fluidProps } from "./fluids";
import { propagateFlows, totalDemand } from "./network";
import { maxR } from "./velocity";
import { emptyHistory, record, redo as redoTx, undo as undoTx, type HistoryState } from "./history";
import { migrateScheme, SCHEMA_VERSION } from "./migrate";
import { copySelectionData, pasteData, type ClipData } from "./clipboard";
import { bulkEditNodes, bulkEditPipes, type BulkResult, type NodeBulkPatch, type PipeBulkPatch } from "./bulk";
import { connectOpenEnd, validateConnection, type ConnectionCheck, type PortRef } from "./connect";
import { layerForNew, nodeLocked, pipeLocked, type LayerId, type LayerState } from "./layers";
import { BUILTIN_MODULES, insertModuleData } from "./modules";
import { rerouteMany } from "./routing";
import { retagSelection, tagAvailable, nextTag, pipeTag } from "./tags";

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

export interface SavedModule {
  id: string;
  name: string;
  nodes: PidNode[];
  pipes: Pipe[];
}

export type VisualMode = "design" | "hydraulic" | "check" | "critical" | "mto";
export type ViewRequest = { kind: "fit" } | { kind: "ids"; ids: string[] } | { kind: "selection" };

export interface State {
  /** Istoric tranzacțional (în memorie, per schemă activă) – sursă pentru Undo/Redo și Change Summary. */
  history: HistoryState;
  undo: () => boolean;
  redo: () => boolean;
  /** Grupează mai multe acțiuni într-o singură tranzacție (un singur pas de undo). */
  transact: <T>(label: string, fn: () => T) => T;
  beginTx: (label: string) => void;
  endTx: () => void;
  lastAction: string;
  clip: ClipData | null;
  pasteCount: number;
  pasteOffset: { x: number; y: number };
  setPasteOffset: (o: { x: number; y: number }) => void;
  toggleSelect: (kind: "node" | "pipe", id: string) => void;
  setSelection: (nodes: string[], pipes: string[]) => void;
  selectAll: (what?: "all" | "pipes" | "equipment" | "valves") => void;
  bulkPipes: (patch: PipeBulkPatch, ids?: string[]) => BulkResult;
  bulkNodes: (patch: NodeBulkPatch, ids?: string[]) => BulkResult;
  retagSelected: (prefix?: string, start?: number) => void;
  renameTag: (id: string, tag: string) => boolean;
  rerouteSelected: (ids?: string[]) => number;
  connectPorts: (a: PortRef, b: PortRef) => ConnectionCheck;
  smartConnectOpenEnd: (openNodeId: string, target: PortRef) => ConnectionCheck;
  autoSizeSelected: (mode?: SizingMode) => { pipes: number; valves: number; skipped: number };
  currentLayer: LayerId;
  setCurrentLayer: (l: LayerId) => void;
  setLayerState: (l: LayerId, p: Partial<LayerState>) => void;
  visualMode: VisualMode;
  setVisualMode: (m: VisualMode) => void;
  viewRequest: (ViewRequest & { nonce: number }) | null;
  requestView: (r: ViewRequest) => void;
  findOpen: boolean;
  commandOpen: boolean;
  setFindOpen: (v: boolean) => void;
  setCommandOpen: (v: boolean) => void;
  recentCommands: string[];
  lastCommand: string | null;
  pushRecentCommand: (id: string, repeatable: boolean) => void;
  inspectorFocus: number;
  focusInspector: () => void;
  modules: SavedModule[];
  multiPipes: string[];
  clipboardIds: string[];
  projects: Scheme[];
  activeId: string;
  selected: { kind: "node" | "pipe"; id: string } | null;
  multi: string[]; // noduri selectate în grup
  grid: number; // pas grilă (px)
  cad: { ortho: boolean; osnap: boolean; showGrid: boolean }; // comutatoare stil CAD
  setCad: (p: Partial<State["cad"]>) => void;
  setVelocityLimit: (dn: number, min: number, max: number) => void;
  resetVelocityLimits: () => void;
  setGrid: (g: number) => void;
  setMulti: (ids: string[]) => void;
  setMultiPipes: (ids: string[]) => void;
  copySelection: () => void;
  pasteClipboard: () => void;
  addGuide: (dir: "h" | "v", pos: number) => void;
  clearGuides: () => void;
  moveNodes: (ids: string[], dx: number, dy: number) => void;
  duplicateNodes: (ids: string[]) => void;
  pipeDefaults: PipeDefaults;
  scheme: Scheme;
  setScheme: (p: Partial<Scheme>) => void;
  addNode: (type: SymbolType, x: number, y: number) => void;
  updateNode: (id: string, p: Partial<PidNode>) => void;
  addPipe: (from: Pipe["from"], to: Pipe["to"], opts?: { direct?: boolean; circuit?: CircuitId }) => void;
  addPipeToEnd: (from: Pipe["from"], x: number, y: number) => void;
  insertNodeOnPipe: (nodeId: string) => boolean;
  autoSizePipes: (mode?: SizingMode) => { pipes: number; valves: number; skipped: number };
  /** Instantaneu pentru Undo al ultimei redimensionări (doar DN/tag; nu se persistă). */
  sizingUndo: { schemeId: string; pipes: { id: string; dn: number; tag: string }[]; nodes: { id: string; dn?: number | undefined }[] } | null;
  undoSizing: () => boolean;
  applyPipeDn: (pipeId: string, dn: number) => void;
  saveModule: (name: string, ids: string[]) => void;
  removeModule: (id: string) => void;
  insertModule: (id: string, x: number, y: number) => void;
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
  applyAutoFlows: () => { updated: number; ambiguous: number; unresolved: number; demand: number; notes: string[] };
  switchProject: (id: string) => void;
  duplicateProject: (id: string) => void;
  deleteProject: (id: string) => void;
  importProject: (raw: string) => string | null;
  reset: (empty?: boolean) => void;
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
        multiPipes: [],
        clipboardIds: [],
        modules: [],
        grid: 5,
        cad: { ortho: false, osnap: true, showGrid: true },
        setCad: (p) => set((st) => ({ cad: { ...st.cad, ...p } })),
        setVelocityLimit: (dn, min, max) =>
          patchScheme((s) => ({
            ...s,
            velocityLimits: { ...(s.velocityLimits ?? {}), [dn]: [min, max] as [number, number] },
          })),
        resetVelocityLimits: () => patchScheme((s) => ({ ...s, velocityLimits: undefined })),
        setGrid: (g) => set({ grid: g }),
        setMulti: (ids) => set({ multi: ids }),
        setMultiPipes: (ids) => set({ multiPipes: ids }),
        copySelection: () => {
          const st = get();
          const ids = st.multi.length ? st.multi : st.selected?.kind === "node" ? [st.selected.id] : [];
          if (ids.length) set({ clipboardIds: ids });
        },
        pasteClipboard: () => {
          const st = get();
          if (st.clipboardIds.length) st.duplicateNodes(st.clipboardIds);
        },
        addGuide: (dir, pos) =>
          patchScheme((s) => ({ ...s, guides: [...(s.guides ?? []), { id: uid(), dir, pos: Math.round(pos) }] })),
        clearGuides: () => patchScheme((s) => ({ ...s, guides: [] })),
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
            circuit: opts?.circuit ?? src?.circuit ?? d.circuit, length: d.length, flow: src?.flow ?? d.flow, flowMode: "manual", routing: "auto", fittings: {},
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

        addPipeToEnd: (from, x, y) => {
          const st = get();
          const g = st.grid;
          const node: PidNode = {
            id: uid(), type: "port_open", x: Math.round(x / g) * g, y: Math.round(y / g) * g, rotation: 0,
            tag: nextTag("CP", st.scheme.nodes.map((n) => n.tag)),
          };
          const src = st.scheme.pipes.find((p) => !p.direct && (p.from.node === from.node || p.to.node === from.node));
          const d = st.pipeDefaults;
          const pipe: Pipe = {
            id: uid(), tag: "", from, to: { node: node.id, port: "a" },
            dn: src?.dn ?? d.dn, material: src?.material ?? d.material, joint: src?.joint ?? d.joint,
            circuit: src?.circuit ?? d.circuit, length: d.length, flow: src?.flow ?? d.flow, flowMode: "manual",
            routing: "auto", fittings: {},
          };
          pipe.tag = pipeTag(pipe, st.scheme.pipes.map((p) => p.tag));
          pipe.length = routeLen(pipe, { ...st.scheme, nodes: [...st.scheme.nodes, node] });
          patchScheme((s) => ({ ...s, nodes: [...s.nodes, node], pipes: [...s.pipes, pipe] }), { selected: { kind: "pipe", id: pipe.id } });
        },

        /** Inserează un element existent (cu ≥2 porturi libere aliniate) într-o conductă apropiată, tăind traseul. */
        insertNodeOnPipe: (nodeId) => {
          const st = get();
          const s0 = st.scheme;
          const n = s0.nodes.find((x) => x.id === nodeId);
          if (!n) return false;
          const used = new Set(s0.pipes.flatMap((p) => [`${p.from.node}:${p.from.port}`, `${p.to.node}:${p.to.port}`]));
          const free = getSymbol(n.type).ports.filter((pt) => !used.has(`${n.id}:${pt.id}`));
          if (free.length < 2) return false;
          const pa = free[0]!, pb = free[1]!;
          // porturile trebuie să fie opuse față de centru (element inline)
          const cx = n.x, cy = n.y;
          const va = { x: pa.x - getSymbol(n.type).w / 2, y: pa.y - getSymbol(n.type).h / 2 };
          const vb = { x: pb.x - getSymbol(n.type).w / 2, y: pb.y - getSymbol(n.type).h / 2 };
          if (Math.abs(va.x + vb.x) > 4 || Math.abs(va.y + vb.y) > 4) return false;
          let best: { pipe: Pipe; d: number; x: number; y: number; i: number; t: number; dx: number; dy: number } | null = null;
          for (const p of s0.pipes) {
            if (p.direct) continue;
            const pts = pipeRoute(p, s0);
            for (let i = 1; i < pts.length; i++) {
              const a = pts[i - 1]!, b = pts[i]!;
              const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
              const t = Math.max(0, Math.min(1, ((n.x - a.x) * (b.x - a.x) + (n.y - a.y) * (b.y - a.y)) / L2));
              const px = a.x + t * (b.x - a.x), py = a.y + t * (b.y - a.y);
              const d = Math.hypot(px - cx, py - cy);
              if (d < 24 && (!best || d < best.d)) best = { pipe: p, d, x: px, y: py, i, t, dx: b.x - a.x, dy: b.y - a.y };
            }
          }
          if (!best) return false;
          const rotation = Math.abs(best.dx) < 1 ? (best.dy > 0 ? 90 : 270) : best.dx >= 0 ? 0 : 180;
          let acc = 0, total = 0;
          const segL: number[] = [];
          const pts = pipeRoute(best.pipe, s0);
          for (let i = 1; i < pts.length; i++) { const L = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y); segL.push(L); total += L; }
          for (let i = 1; i < best.i; i++) acc += segL[i - 1]!;
          acc += segL[best.i - 1]! * best.t;
          const frac = total ? acc / total : 0.5;
          const p1: Pipe = { ...best.pipe, to: { node: n.id, port: pa.id }, length: Math.round(best.pipe.length * frac * 10) / 10, points: undefined };
          const p2: Pipe = { ...best.pipe, id: uid(), from: { node: n.id, port: pb.id }, length: Math.round(best.pipe.length * (1 - frac) * 10) / 10, fittings: {}, points: undefined };
          p2.tag = pipeTag(p2, s0.pipes.map((p) => p.tag));
          patchScheme((s) => ({
            ...s,
            nodes: s.nodes.map((x) => (x.id === n.id ? { ...x, x: best.x, y: best.y, rotation } : x)),
            pipes: s.pipes.flatMap((p) => (p.id === best.pipe.id ? [p1, p2] : [p])),
          }), { selected: { kind: "node", id: n.id } });
          return true;
        },

        /**
         * Dimensionare cu dublu criteriu: viteza rămâne în intervalul recomandat pentru
         * treapta de DN (tabel editabil de utilizator) și căderea liniară nu depășește
         * limita R [Pa/m]. Se alege cel mai mic diametru care respectă ambele condiții.
         */
        sizingUndo: null,

        autoSizePipes: (mode = "legacy") => {
          const st = get();
          const s = st.scheme;
          const fp = fluidProps(s.fluid, s.concentration, s.temperature);
          const plan = planSizing(s, fp, { mode, rMax: maxR(s) });
          const tags = s.pipes.map((p) => p.tag);
          let pipes = 0, skipped = 0;
          for (const sz of plan.sizes.values()) if (sz.status === "skipped" && !s.pipes.find((p) => p.id === sz.pipeId)?.direct) skipped++;
          const dnMap = plan.changes;
          const next = s.pipes.map((p) => {
            const pick = dnMap.get(p.id);
            if (pick === undefined) return p;
            pipes++;
            const np = { ...p, dn: pick };
            np.tag = pipeTag(np, tags);
            tags.push(np.tag);
            return np;
          });
          // vanele și fitingurile de pe tronsoanele redimensionate preiau DN-ul nou
          let valves = 0;
          const nodes = s.nodes.map((n) => {
            if (!n.dn || getSymbol(n.type).bomGroup !== "Vane") return n;
            const rel = next.find((p) => dnMap.has(p.id) && (p.from.node === n.id || p.to.node === n.id));
            if (!rel || rel.dn === n.dn) return n;
            valves++;
            return { ...n, dn: rel.dn };
          });
          if (pipes || valves) {
            const undo = {
              schemeId: s.id,
              pipes: s.pipes.filter((p) => dnMap.has(p.id)).map((p) => ({ id: p.id, dn: p.dn, tag: p.tag })),
              nodes: s.nodes.filter((n, i) => nodes[i] !== n).map((n) => ({ id: n.id, dn: n.dn })),
            };
            patchScheme((s2) => ({ ...s2, pipes: next, nodes }), { sizingUndo: undo });
          }
          return { pipes, valves, skipped };
        },

        applyPipeDn: (pipeId, dn) => {
          const s = get().scheme;
          const p = s.pipes.find((x) => x.id === pipeId);
          if (!p || p.dn === dn) return;
          const undo = { schemeId: s.id, pipes: [{ id: p.id, dn: p.dn, tag: p.tag }], nodes: [] };
          const tags = s.pipes.filter((x) => x.id !== pipeId).map((x) => x.tag);
          patchScheme((s2) => ({ ...s2, pipes: s2.pipes.map((x) => (x.id === pipeId ? { ...x, dn, tag: pipeTag({ ...x, dn }, tags) } : x)) }), { sizingUndo: undo });
        },

        undoSizing: () => {
          const st = get();
          const u = st.sizingUndo;
          if (!u || u.schemeId !== st.scheme.id) return false;
          const pm = new Map(u.pipes.map((x) => [x.id, x]));
          const nm = new Map(u.nodes.map((x) => [x.id, x]));
          // se restaurează doar DN/tag; celelalte modificări ale utilizatorului rămân intacte
          patchScheme((s2) => ({
            ...s2,
            pipes: s2.pipes.map((p) => (pm.has(p.id) ? { ...p, dn: pm.get(p.id)!.dn, tag: pm.get(p.id)!.tag } : p)),
            nodes: s2.nodes.map((n) => (nm.has(n.id) ? { ...n, dn: nm.get(n.id)!.dn } : n)),
          }), { sizingUndo: null });
          return true;
        },

        saveModule: (name, ids) => {
          const st = get();
          const set_ = new Set(ids);
          const nodes = st.scheme.nodes.filter((n) => set_.has(n.id)).map((n) => structuredClone(n));
          const pipes = st.scheme.pipes.filter((p) => set_.has(p.from.node) && set_.has(p.to.node)).map((p) => structuredClone(p));
          if (!nodes.length) return;
          set((s) => ({ modules: [...s.modules, { id: uid(), name, nodes, pipes }] }));
        },

        removeModule: (id) => set((s) => ({ modules: s.modules.filter((m) => m.id !== id) })),

        insertModule: (id, x, y) => {
          const st = get();
          const m = st.modules.find((mm) => mm.id === id);
          if (!m) return;
          const xs = m.nodes.map((n) => n.x), ys = m.nodes.map((n) => n.y);
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
          const map = new Map<string, string>();
          const tags = st.scheme.nodes.map((n) => n.tag);
          const nodes: PidNode[] = m.nodes.map((n) => {
            const nid = uid();
            map.set(n.id, nid);
            const tag = nextTag(getSymbol(n.type).prefix, tags);
            tags.push(tag);
            return { ...structuredClone(n), id: nid, tag, x: n.x - cx + x, y: n.y - cy + y };
          });
          const ptags = st.scheme.pipes.map((p) => p.tag);
          const pipes: Pipe[] = m.pipes.map((p) => {
            const np: Pipe = { ...structuredClone(p), id: uid(), from: { ...p.from, node: map.get(p.from.node)! }, to: { ...p.to, node: map.get(p.to.node)! } };
            np.tag = pipeTag(np, ptags);
            ptags.push(np.tag);
            return np;
          });
          patchScheme((s) => ({ ...s, nodes: [...s.nodes, ...nodes], pipes: [...s.pipes, ...pipes] }),
            { multi: nodes.map((n) => n.id), selected: nodes[0] ? { kind: "node", id: nodes[0].id } : null });
        },

        flipPipe: (id) =>
          patchScheme((s) => ({
            ...s,
            pipes: s.pipes.map((p) => (p.id === id ? { ...p, from: p.to, to: p.from, points: p.points ? [...p.points].reverse() : undefined } : p)),
          })),

        select: (s) => set((st) => ({ selected: s, multi: s?.kind === "node" && st.multi.includes(s.id) ? st.multi : [], multiPipes: [] })),

        removeSelected: () => {
          const st = get();
          const sel = st.selected;
          const multi = st.multi;
          const mp = st.multiPipes;
          if (mp.length) {
            const pipeIds = new Set(mp);
            const nodeIds = new Set(multi);
            patchScheme((s) => ({
              ...s,
              nodes: s.nodes.filter((n) => !nodeIds.has(n.id)),
              pipes: s.pipes.filter((p) => !pipeIds.has(p.id) && !nodeIds.has(p.from.node) && !nodeIds.has(p.to.node)),
            }), { selected: null, multi: [], multiPipes: [] });
            return;
          }
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
          // tronsoanele de inel: debitul se preia din solverul de rețea dacă acesta a convers
          const sol = solveNetwork(st.scheme, fp);
          let updated = 0, ambiguous = 0, unresolved = 0;
          const notes = new Set<string>();
          patchScheme((s) => ({
            ...s,
            pipes: s.pipes.map((p) => {
              const info = flows.get(p.id);
              if (!info) return p;
              if (info.reason) notes.add(info.reason);
              if (info.ambiguous) {
                const sp = sol.converged ? sol.pipes.get(p.id) : undefined;
                if (!sp) { ambiguous++; return p; }
                const fl = Math.round(Math.abs(sp.flowSigned) * 100) / 100;
                if (Math.abs(fl - p.flow) < 0.005) return p;
                updated++;
                return { ...p, flow: fl, flowMode: "manual" as const };
              }
              if (info.reason) { unresolved++; return p; }
              if (Math.abs(info.flow - p.flow) < 0.005) return p;
              updated++;
              return { ...p, flow: info.flow, flowMode: "manual" as const };
            }),
          }));
          const demand = Math.round(totalDemand(st.scheme, fp) * 100) / 100;
          return { updated, ambiguous, unresolved, demand, notes: [...notes] };
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
      partialize: (s) => ({ projects: s.projects, activeId: s.activeId, pipeDefaults: s.pipeDefaults, grid: s.grid, modules: s.modules, cad: s.cad }),
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
