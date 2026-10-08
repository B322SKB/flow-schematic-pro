/**
 * Registrul de comenzi: aceeași sursă pentru Command Bar (Ctrl+K), scurtături, Space (repetă) și Copilot.
 * Comenzile operează doar prin acțiunile store-ului (tranzacționale), deci sunt undo-abile.
 */
import { pipeRoute } from "./hydraulics";
import { usedPorts } from "./connect";
import { getSymbol } from "./symbols";
import type { State } from "./store";

export interface CommandCtx {
  get: () => State;
  notify: (msg: string, kind?: "success" | "error" | "info") => void;
}

export interface Command {
  id: string;
  label: string;
  group: "Vizualizare" | "Selecție" | "Editare" | "Hidraulică" | "Moduri" | "CAD";
  keywords?: string;
  shortcut?: string;
  /** poate fi repetată cu Space (nu distruge date) */
  repeatable?: boolean;
  enabled?: (c: CommandCtx) => boolean;
  run: (c: CommandCtx) => void;
}

const sel = (st: State) => ({
  nodes: st.multi.length ? st.multi : st.selected?.kind === "node" ? [st.selected.id] : [],
  pipes: st.multiPipes.length ? st.multiPipes : st.selected?.kind === "pipe" ? [st.selected.id] : [],
});
const hasSel = (c: CommandCtx) => { const s = sel(c.get()); return s.nodes.length + s.pipes.length > 0; };

export const COMMANDS: Command[] = [
  { id: "zoom-fit", label: "Zoom Fit (tot desenul)", group: "Vizualizare", shortcut: "Home", repeatable: true, run: (c) => c.get().requestView({ kind: "fit" }) },
  { id: "zoom-selection", label: "Zoom la selecție", group: "Vizualizare", shortcut: "G", repeatable: true,
    run: (c) => (hasSel(c) ? c.get().requestView({ kind: "selection" }) : c.get().requestView({ kind: "fit" })) },
  { id: "zoom-equipment", label: "Zoom la echipamente", group: "Vizualizare", repeatable: true,
    run: (c) => {
      const s = c.get().scheme;
      const ids = s.nodes.filter((n) => ["Echipamente", "Pompe"].includes(getSymbol(n.type).category)).map((n) => n.id);
      c.get().requestView(ids.length ? { kind: "ids", ids } : { kind: "fit" });
    } },
  { id: "find", label: "Caută obiect (tag, tip, DN…)", group: "Selecție", shortcut: "Mod+F", run: (c) => c.get().setFindOpen(true) },
  { id: "select-all", label: "Selectează tot", group: "Selecție", shortcut: "Mod+A", run: (c) => c.get().selectAll("all") },
  { id: "select-pipes", label: "Selectează toate conductele", group: "Selecție", keywords: "pipes", run: (c) => c.get().selectAll("pipes") },
  { id: "select-equipment", label: "Selectează toate echipamentele", group: "Selecție", keywords: "equipment", run: (c) => c.get().selectAll("equipment") },
  { id: "select-valves", label: "Selectează toate vanele / fitingurile", group: "Selecție", keywords: "valves", run: (c) => c.get().selectAll("valves") },
  { id: "cancel", label: "Golește selecția", group: "Selecție", shortcut: "Esc", run: (c) => { c.get().select(null); c.get().setFindOpen(false); } },
  { id: "undo", label: "Undo", group: "Editare", shortcut: "Mod+Z", enabled: (c) => c.get().history.past.length > 0,
    run: (c) => { if (!c.get().undo()) c.notify("Nimic de anulat", "info"); } },
  { id: "redo", label: "Redo", group: "Editare", shortcut: "Mod+Y", enabled: (c) => c.get().history.future.length > 0,
    run: (c) => { if (!c.get().redo()) c.notify("Nimic de refăcut", "info"); } },
  { id: "copy", label: "Copiază selecția", group: "Editare", shortcut: "Mod+C", enabled: hasSel,
    run: (c) => { c.get().copySelection(); c.notify("Selecție copiată", "info"); } },
  { id: "paste", label: "Lipește", group: "Editare", shortcut: "Mod+V", repeatable: true, enabled: (c) => !!c.get().clip, run: (c) => c.get().pasteClipboard() },
  { id: "duplicate", label: "Duplică selecția", group: "Editare", shortcut: "Mod+D", repeatable: true, enabled: (c) => sel(c.get()).nodes.length > 0,
    run: (c) => c.get().duplicateNodes(sel(c.get()).nodes) },
  { id: "delete", label: "Șterge selecția", group: "Editare", shortcut: "Delete", enabled: hasSel, run: (c) => c.get().removeSelected() },
  { id: "retag-selected", label: "Re-numerotează selecția", group: "Editare", enabled: hasSel, run: (c) => c.get().retagSelected() },
  { id: "reroute", label: "Smart routing pentru selecție", group: "Editare", keywords: "route rerutare", repeatable: true, enabled: hasSel,
    run: (c) => { const n = c.get().rerouteSelected(); c.notify(n ? `${n} conducte rerutate` : "Traseele actuale sunt deja optime", n ? "success" : "info"); } },
  { id: "add-valve", label: "Adaugă vană (pe conducta selectată)", group: "Editare", keywords: "valve",
    run: (c) => {
      const st = c.get();
      const pid = sel(st).pipes[0];
      const p = pid ? st.scheme.pipes.find((x) => x.id === pid) : undefined;
      if (p && !p.direct) {
        const pts = pipeRoute(p, st.scheme);
        const a = pts[0]!, b = pts[pts.length - 1]!;
        if (st.insertOnPipe(p.id, "v_butterfly", (a.x + b.x) / 2, (a.y + b.y) / 2)) { c.notify("Vană inserată pe conductă", "success"); return; }
      }
      st.addNode("v_butterfly", 400, 300);
      c.notify("Vană adăugată – trage-o pe o conductă pentru inserare", "info");
    } },
  { id: "add-pipe", label: "Adaugă conductă între 2 elemente selectate", group: "Editare", keywords: "pipe connect",
    run: (c) => {
      const st = c.get();
      const ns = sel(st).nodes;
      if (ns.length !== 2) { c.notify("Selectează exact 2 elemente (Ctrl+click) sau click pe un port pentru a trasa", "info"); return; }
      const used = usedPorts(st.scheme);
      const free = (id: string) => getSymbol(st.scheme.nodes.find((n) => n.id === id)!.type).ports.find((p) => !used.has(`${id}:${p.id}`));
      const a = free(ns[0]!), b = free(ns[1]!);
      if (!a || !b) { c.notify("Unul dintre elemente nu are porturi libere", "error"); return; }
      const r = st.connectPorts({ node: ns[0]!, port: a.id }, { node: ns[1]!, port: b.id });
      c.notify(r.ok ? "Conductă creată" : `Conexiune invalidă: ${r.reason}`, r.ok ? "success" : "error");
    } },
  { id: "auto-size-selected", label: "Auto-size selecție (recalculează)", group: "Hidraulică", keywords: "dimensionare",
    run: (c) => { const r = c.get().autoSizeSelected("legacy"); c.notify(`${r.pipes} conducte redimensionate`, "success"); } },
  { id: "auto-flows", label: "Calculează debitele automat", group: "Hidraulică", run: (c) => { const r = c.get().applyAutoFlows(); c.notify(`${r.updated} tronsoane actualizate`, "success"); } },
  { id: "mode-design", label: "Mod Design", group: "Moduri", run: (c) => c.get().setVisualMode("design") },
  { id: "mode-hydraulic", label: "Mod Hydraulic (viteze / debite)", group: "Moduri", run: (c) => c.get().setVisualMode("hydraulic") },
  { id: "show-critical", label: "Arată traseul critic", group: "Moduri", keywords: "critical path", run: (c) => c.get().setVisualMode("critical") },
  { id: "show-warnings", label: "Arată avertizările Engineering Check", group: "Moduri", keywords: "engineering warnings", run: (c) => c.get().setVisualMode("check") },
  { id: "mode-mto", label: "Mod MTO (DN / lungimi)", group: "Moduri", run: (c) => c.get().setVisualMode("mto") },
  { id: "toggle-grid", label: "Comută GRID", group: "CAD", shortcut: "F7", run: (c) => c.get().setCad({ showGrid: !c.get().cad.showGrid }) },
  { id: "toggle-osnap", label: "Comută OSNAP", group: "CAD", shortcut: "F3", run: (c) => c.get().setCad({ osnap: !c.get().cad.osnap }) },
  { id: "toggle-ortho", label: "Comută ORTHO", group: "CAD", shortcut: "F8", run: (c) => c.get().setCad({ ortho: !c.get().cad.ortho }) },
  { id: "command-bar", label: "Command bar", group: "CAD", shortcut: "Mod+K", run: (c) => c.get().setCommandOpen(true) },
];

export const getCommand = (id: string) => COMMANDS.find((c) => c.id === id);

/** Execută o comandă (cu verificarea `enabled`) și o adaugă în istoricul de comenzi recente. */
export function runCommand(id: string, ctx: CommandCtx): boolean {
  if (id === "repeat") {
    const last = ctx.get().lastCommand;
    if (!last) return false;
    return runCommand(last, ctx);
  }
  const cmd = getCommand(id);
  if (!cmd) return false;
  if (cmd.enabled && !cmd.enabled(ctx)) return false;
  cmd.run(ctx);
  if (!["command-bar", "find", "cancel", "repeat"].includes(id)) ctx.get().pushRecentCommand(id, !!cmd.repeatable);
  return true;
}
