import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown, ChevronUp, Eye, EyeOff, History, Keyboard, Layers, Lock, Redo2, Search, Undo2, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { COMMANDS, getCommand, runCommand, type CommandCtx } from "@/lib/pid/commands";
import { applyProposal, localProvider, type Proposal } from "@/lib/pid/copilot";
import { describeSummary, sessionSummary } from "@/lib/pid/history";
import { LAYERS, layerState } from "@/lib/pid/layers";
import { searchObjects } from "@/lib/pid/search";
import { ALLOWED_IN_INPUT, isEditableTarget, matchShortcut, SHORTCUTS } from "@/lib/pid/shortcuts";
import { usePid, type VisualMode } from "@/lib/pid/store";
import { fluidProps } from "@/lib/pid/fluids";
import { evaluateNetwork } from "@/lib/pid/network";
import { engineeringCheck } from "@/lib/pid/checks";

export const commandCtx: CommandCtx = {
  get: () => usePid.getState(),
  notify: (m, k = "info") => (k === "error" ? toast.error(m) : k === "success" ? toast.success(m) : toast(m)),
};

/** Scurtături globale; ignorate în câmpuri editabile (cu excepția Ctrl+K / Ctrl+F). */
export function useGlobalShortcuts(onEditorNeeded?: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = matchShortcut(e);
      if (!id) return;
      const editable = isEditableTarget(e.target as HTMLElement);
      if (editable && !ALLOWED_IN_INPUT.has(id)) return;
      // în dialoguri deschise (command bar / find) tastele de editare nu se aplică pe schemă
      const st = usePid.getState();
      if ((st.commandOpen || st.findOpen) && !["command-bar", "find", "cancel"].includes(id)) return;
      if (id === "repeat" && !st.lastCommand) return;
      e.preventDefault();
      if (id === "find") onEditorNeeded?.();
      runCommand(id, commandCtx);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEditorNeeded]);
}

export function UndoRedo() {
  const past = usePid((s) => s.history.past);
  const future = usePid((s) => s.history.future);
  const undo = usePid((s) => s.undo);
  const redo = usePid((s) => s.redo);
  return (
    <div className="flex">
      <Button size="sm" variant="ghost" disabled={!past.length} onClick={undo} title={`Undo${past.length ? `: ${past[past.length - 1]!.label}` : ""} (Ctrl+Z)`} aria-label="Undo"><Undo2 className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" disabled={!future.length} onClick={redo} title={`Redo${future.length ? `: ${future[future.length - 1]!.label}` : ""} (Ctrl+Y / Ctrl+Shift+Z)`} aria-label="Redo"><Redo2 className="h-4 w-4" /></Button>
    </div>
  );
}

export function CommandBar({ onEditorNeeded }: { onEditorNeeded?: () => void }) {
  const open = usePid((s) => s.commandOpen);
  const setOpen = usePid((s) => s.setCommandOpen);
  const recent = usePid((s) => s.recentCommands);
  const scheme = usePid((s) => s.scheme);
  const [q, setQ] = useState("");
  const hits = useMemo(() => (q.trim().length >= 2 ? searchObjects(scheme, q).slice(0, 12) : []), [q, scheme]);
  const exec = (id: string) => { setOpen(false); setQ(""); onEditorNeeded?.(); setTimeout(() => runCommand(id, commandCtx), 0); };
  const groups = [...new Set(COMMANDS.map((c) => c.group))];
  return (
    <CommandDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQ(""); }}>
      <CommandInput placeholder="Comandă sau obiect (ex. Zoom Fit, CCU-01, DN100)…" value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>Nicio comandă sau obiect.</CommandEmpty>
        {hits.length > 0 && (
          <CommandGroup heading="Obiecte">
            {hits.map((h) => (
              <CommandItem key={h.id} value={`obj ${h.label} ${h.id}`} onSelect={() => {
                setOpen(false); setQ(""); onEditorNeeded?.();
                const st = usePid.getState();
                st.select({ kind: h.kind, id: h.id });
                st.requestView({ kind: "ids", ids: [h.id] });
              }}>{h.label}</CommandItem>
            ))}
          </CommandGroup>
        )}
        {!q && recent.length > 0 && (
          <CommandGroup heading="Recente">
            {recent.map((id) => { const c = getCommand(id); return c ? <CommandItem key={`r${id}`} value={`recent ${c.label}`} onSelect={() => exec(id)}>{c.label}</CommandItem> : null; })}
          </CommandGroup>
        )}
        {groups.map((g) => (
          <CommandGroup key={g} heading={g}>
            {COMMANDS.filter((c) => c.group === g).map((c) => {
              const disabled = c.enabled ? !c.enabled(commandCtx) : false;
              return (
                <CommandItem key={c.id} value={`${c.label} ${c.keywords ?? ""} ${c.id}`} disabled={disabled} onSelect={() => exec(c.id)}>
                  {c.label}{c.shortcut && <CommandShortcut>{c.shortcut.replace("Mod", "Ctrl")}</CommandShortcut>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/** Find: Ctrl+F – căutare după tag, tip, circuit, material, DN; next/prev; selectare multiplă. */
export function FindPanel() {
  const open = usePid((s) => s.findOpen);
  const setOpen = usePid((s) => s.setFindOpen);
  const scheme = usePid((s) => s.scheme);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const hits = useMemo(() => searchObjects(scheme, q), [scheme, q]);
  const go = (k: number) => {
    if (!hits.length) return;
    const idx = ((k % hits.length) + hits.length) % hits.length;
    setI(idx);
    const h = hits[idx]!;
    const st = usePid.getState();
    st.select({ kind: h.kind, id: h.id });
    st.requestView({ kind: "ids", ids: [h.id] });
  };
  if (!open) return null;
  return (
    <div className="absolute left-1/2 top-3 z-20 w-[420px] -translate-x-1/2 rounded-md border bg-card/95 p-2 shadow-lg backdrop-blur">
      <div className="flex items-center gap-1">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder="Tag, tip, dn100, material:inox, circuit:tur…" className="h-7"
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? i - 1 : (hits[i] && usePid.getState().selected?.id === hits[i]!.id ? i + 1 : i)); }
            if (e.key === "Escape") setOpen(false);
          }} />
        <span className="w-14 text-center font-mono text-[11px] text-muted-foreground">{hits.length ? `${i + 1}/${hits.length}` : "0/0"}</span>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => go(i - 1)} title="Anterior (Shift+Enter)" aria-label="Rezultat anterior"><ChevronUp className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => go(i + 1)} title="Următor (Enter)" aria-label="Rezultat următor"><ChevronDown className="h-4 w-4" /></Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={!hits.length} title="Selectează toate rezultatele"
          onClick={() => {
            const st = usePid.getState();
            st.setSelection(hits.filter((h) => h.kind === "node").map((h) => h.id), hits.filter((h) => h.kind === "pipe").map((h) => h.id));
            st.requestView({ kind: "selection" });
          }}>Toate</Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Închide">×</Button>
      </div>
      {q && (
        <ul className="mt-1 max-h-48 overflow-auto text-xs">
          {hits.slice(0, 50).map((h, k) => (
            <li key={h.id}><button className={`w-full rounded px-2 py-0.5 text-left hover:bg-muted ${k === i ? "bg-primary/10" : ""}`} onClick={() => go(k)}>{h.label}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LayersPopover() {
  const scheme = usePid((s) => s.scheme);
  const current = usePid((s) => s.currentLayer);
  const setCurrent = usePid((s) => s.setCurrentLayer);
  const setLayer = usePid((s) => s.setLayerState);
  return (
    <Popover>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" title="Straturi (vizibilitate, blocare, strat curent)" aria-label="Straturi"><Layers className="h-4 w-4" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 text-xs">
        <div className="mb-1 font-semibold">Straturi</div>
        {LAYERS.map((l) => {
          const st = layerState(scheme, l.id);
          return (
            <div key={l.id} className={`flex items-center gap-1 rounded px-1 py-0.5 ${current === l.id ? "bg-primary/10" : ""}`}>
              <button className="flex-1 text-left" onClick={() => setCurrent(l.id)} title="Setează ca strat curent">{current === l.id ? "● " : "○ "}{l.name}</button>
              <Button size="icon" variant="ghost" className="h-6 w-6" title={st.visible ? "Ascunde" : "Arată"} onClick={() => setLayer(l.id, { visible: !st.visible })}>
                {st.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" title={st.locked ? "Deblochează" : "Blochează (doar vizualizare)"} onClick={() => setLayer(l.id, { locked: !st.locked })}>
                {st.locked ? <Lock className="h-3.5 w-3.5 text-warning" /> : <Unlock className="h-3.5 w-3.5 text-muted-foreground" />}
              </Button>
            </div>
          );
        })}
        <p className="mt-1 text-[10px] text-muted-foreground">Obiectele noi intră în stratul curent dacă îl acceptă; altfel în stratul categoriei lor.</p>
      </PopoverContent>
    </Popover>
  );
}

export function ChangesPopover() {
  const history = usePid((s) => s.history);
  const sum = sessionSummary(history);
  return (
    <Popover>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" title="Modificări în această sesiune" aria-label="Modificări"><History className="h-4 w-4" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2 text-xs">
        <div className="mb-1 font-semibold">Change Summary (sesiune)</div>
        <div className="grid grid-cols-5 gap-1 text-center font-mono">
          {([["create", sum.created], ["modif.", sum.modified], ["DN", sum.resized], ["rerut.", sum.rerouted], ["șterse", sum.deleted]] as const).map(([k, v]) => (
            <div key={k} className="rounded border p-1"><div className="text-sm font-semibold">{v.length}</div><div className="text-[10px] text-muted-foreground">{k}</div></div>
          ))}
        </div>
        <div className="mt-2 font-medium">Ultimele modificări</div>
        <ul className="max-h-60 overflow-auto">
          {[...history.log].reverse().slice(0, 30).map((l) => (
            <li key={l.id} className="border-b py-0.5 last:border-0">
              <span className="font-mono text-[10px] text-muted-foreground">{new Date(l.at).toLocaleTimeString("ro-RO")}</span> {l.label}
              <div className="text-[10px] text-muted-foreground">{describeSummary(l.summary)}</div>
            </li>
          ))}
          {!history.log.length && <li className="text-muted-foreground">Nicio modificare în această sesiune.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function ShortcutsPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" title="Scurtături de tastatură" aria-label="Scurtături"><Keyboard className="h-4 w-4" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 text-xs">
        <div className="mb-1 font-semibold">Scurtături</div>
        {SHORTCUTS.map((s) => (
          <div key={s.command} className="flex justify-between py-0.5"><span>{s.label}</span><kbd className="font-mono text-muted-foreground">{s.keys.replaceAll("Mod", "Ctrl/⌘")}</kbd></div>
        ))}
        <div className="flex justify-between py-0.5"><span>Rotire / mutare fină</span><kbd className="font-mono text-muted-foreground">R · săgeți</kbd></div>
        <div className="flex justify-between py-0.5"><span>Selecție multiplă</span><kbd className="font-mono text-muted-foreground">Ctrl/Shift+click</kbd></div>
      </PopoverContent>
    </Popover>
  );
}

/** Copilot: intenție → propunere → preview → Apply / Reject. Nu modifică schema fără aprobare. */
export function CopilotPopover() {
  const [text, setText] = useState("");
  const [prop, setProp] = useState<Proposal | null>(null);
  return (
    <Popover onOpenChange={(v) => { if (!v) setProp(null); }}>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" title="Copilot (propuneri cu previzualizare)" aria-label="Copilot"><Bot className="h-4 w-4" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-96 space-y-2 p-3 text-xs">
        <div className="font-semibold">Copilot <span className="font-normal text-muted-foreground">· local, determinist</span></div>
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="ex. Select all pipes DN100 · Show critical path · Auto-size selected · Find CCU"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void Promise.resolve(localProvider.propose(text, usePid.getState())).then(setProp); } }} />
        <Button size="sm" className="w-full" onClick={() => void Promise.resolve(localProvider.propose(text, usePid.getState())).then(setProp)}>Propune</Button>
        {prop && (
          <div className="space-y-1 rounded border p-2">
            <div className="font-medium">{prop.summary}</div>
            {prop.mutates && <div className="text-[10px] text-warning">Modifică schema – se aplică doar după confirmare (un singur pas de Undo).</div>}
            {prop.preview.length > 0 && <ul className="max-h-36 overflow-auto font-mono text-[10px]">{prop.preview.map((x, k) => <li key={k}>• {x}</li>)}</ul>}
            {prop.action && (
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="flex-1" onClick={() => { applyProposal(prop, usePid.getState()); toast.success(prop.summary); setProp(null); }}>Apply</Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => setProp(null)}>Reject</Button>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

const MODES: [VisualMode, string][] = [["design", "Design"], ["hydraulic", "Hydraulic"], ["check", "Check"], ["critical", "Critical"], ["mto", "MTO"]];

export function ModeSwitch() {
  const mode = usePid((s) => s.visualMode);
  const set = usePid((s) => s.setVisualMode);
  return (
    <div className="flex rounded-md border p-0.5" role="group" aria-label="Mod vizual">
      {MODES.map(([m, l]) => (
        <button key={m} type="button" onClick={() => set(m)} title={`Mod vizual ${l} (nu modifică modelul)`}
          className={`rounded px-1.5 py-0.5 text-[11px] ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{l}</button>
      ))}
    </div>
  );
}

/** Dashboard compact: obiecte, conducte, avertizări, status hidraulic / ingineresc, ultima acțiune. */
export function Dashboard() {
  const scheme = usePid((s) => s.scheme);
  const last = usePid((s) => s.lastAction);
  const fp = useMemo(() => fluidProps(scheme.fluid, scheme.concentration, scheme.temperature), [scheme.fluid, scheme.concentration, scheme.temperature]);
  const ev = useMemo(() => evaluateNetwork(scheme, fp), [scheme, fp]);
  const chk = useMemo(() => engineeringCheck(scheme, fp, ev.solution), [scheme, fp, ev]);
  const errors = ev.warnings.filter((w) => w.severity === "error").length;
  const cls = (ok: boolean) => (ok ? "text-success" : "text-warning");
  return (
    <div className="flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-muted-foreground">
      <span>{scheme.nodes.length} obiecte · {scheme.pipes.length} conducte</span>
      <span title="Statusul solverului de rețea">HYD <b className={cls(ev.networkSolved)}>{ev.status}</b></span>
      <span title="Engineering Check">ENG <b className={cls(chk.status === "ok")}>{chk.status}</b></span>
      <span title="Erori blocante / probleme Engineering Check">⚠ {errors} / {chk.issues.length}</span>
      <span className="text-primary" title="Δp sistem pe traseul critic (nu suma ramurilor)">Δp sist. {(ev.systemDp / 1000).toFixed(1)} kPa</span>
      {last && <span className="max-w-48 truncate" title={`Ultima acțiune: ${last}`}>↳ {last}</span>}
    </div>
  );
}
