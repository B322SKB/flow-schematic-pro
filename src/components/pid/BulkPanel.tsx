import { useState } from "react";
import { Copy, Route, Save, Tags, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CIRCUITS, CIRCUIT_IDS, DN_LIST, JOINT_LABEL, MATERIALS, type CircuitId, type JointType, type MaterialId } from "@/lib/pid/catalog";
import { commonValue, MIXED, type NodeBulkPatch, type PipeBulkPatch } from "@/lib/pid/bulk";
import { LAYERS, nodeLayer, pipeLayer, type LayerId } from "@/lib/pid/layers";
import { usePid } from "@/lib/pid/store";
import { Field, Sel } from "./fields";

const KEEP = "__keep__";
/** Confirmare pentru operații cu impact mare. */
const BIG = 20;

function MixedSel<T extends string | number>({ label, current, options, value, onChange }: {
  label: string; current: unknown; options: { value: T; label: string }[]; value: T | typeof KEEP; onChange: (v: T | typeof KEEP) => void;
}) {
  const mixed = current === MIXED;
  const curLabel = mixed ? "mixed" : options.find((o) => o.value === current)?.label ?? (current === undefined ? "—" : String(current));
  return (
    <Field label={`${label} · actual: ${curLabel}`}>
      <Sel<T | typeof KEEP> value={value} onChange={onChange}
        options={[{ value: KEEP as T | typeof KEEP, label: mixed ? "— mixed (nu se modifică) —" : "— nu se modifică —" }, ...options]} />
    </Field>
  );
}

/** Inspector pentru selecție multiplă: editare în masă (un singur pas de Undo), valori mixed. */
export function BulkPanel() {
  const st = usePid();
  const { scheme, multi, multiPipes, transact, bulkPipes, bulkNodes, removeSelected, duplicateNodes, saveModule, autoSizeSelected, retagSelected, rerouteSelected } = st;
  const nodes = scheme.nodes.filter((n) => multi.includes(n.id));
  const pipes = scheme.pipes.filter((p) => multiPipes.includes(p.id));
  const [pp, setPp] = useState<Record<string, string | number>>({});
  const [np, setNp] = useState<Record<string, string | number>>({});
  const [insulation, setInsulation] = useState("");
  const total = nodes.length + pipes.length;
  if (total < 2) return null;
  const pv = <K extends string>(k: K) => (pp[k] ?? KEEP) as never;
  const nv = <K extends string>(k: K) => (np[k] ?? KEEP) as never;
  const layersOf = (arr: string[]) => (arr.every((x) => x === arr[0]) ? arr[0] : MIXED);

  const apply = () => {
    if (total > BIG && !confirm(`Aplici modificarea pe ${total} obiecte?`)) return;
    const pPatch: PipeBulkPatch = {};
    if (pp.circuit !== undefined && pp.circuit !== KEEP) pPatch.circuit = pp.circuit as CircuitId;
    if (pp.material !== undefined && pp.material !== KEEP) pPatch.material = pp.material as MaterialId;
    if (pp.joint !== undefined && pp.joint !== KEEP) pPatch.joint = pp.joint as JointType;
    if (pp.dn !== undefined && pp.dn !== KEEP) pPatch.dn = Number(pp.dn);
    if (pp.disabled !== undefined && pp.disabled !== KEEP) pPatch.disabled = pp.disabled === "yes";
    if (pp.layer !== undefined && pp.layer !== KEEP) pPatch.layer = pp.layer as LayerId;
    if (insulation.trim()) pPatch.insulation = insulation.trim();
    const nPatch: NodeBulkPatch = {};
    if (np.redundant !== undefined && np.redundant !== KEEP) nPatch.redundant = np.redundant === "yes";
    if (np.layer !== undefined && np.layer !== KEEP) nPatch.layer = np.layer as LayerId;
    if (np.dn !== undefined && np.dn !== KEEP) nPatch.dn = Number(np.dn);
    const msgs: string[] = [];
    let changed = 0;
    transact(`Bulk edit (${total} obiecte)`, () => {
      if (pipes.length && Object.keys(pPatch).length) {
        const r = bulkPipes(pPatch, pipes.map((p) => p.id));
        changed += r.changed.length;
        msgs.push(...r.warnings, ...r.skipped.slice(0, 5).map((s) => `${s.tag}: ${s.reason}`));
      }
      if (nodes.length && Object.keys(nPatch).length) {
        const r = bulkNodes(nPatch, nodes.map((n) => n.id));
        changed += r.changed.length;
        msgs.push(...r.skipped.slice(0, 5).map((s) => `${s.tag}: ${s.reason}`));
      }
    });
    if (msgs.length) toast.warning(`${changed} obiecte modificate · ${msgs.join(" · ")}`);
    else toast.success(`${changed} obiecte modificate (un singur pas de Undo)`);
    setPp({}); setNp({}); setInsulation("");
  };

  return (
    <div className="space-y-2 rounded-md border border-primary/50 bg-primary/5 p-3">
      <div className="text-sm font-semibold">{total} obiecte selectate <span className="font-normal text-muted-foreground">({nodes.length} elemente · {pipes.length} conducte)</span></div>
      {pipes.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Conducte</div>
          <MixedSel label="Circuit" current={commonValue(pipes, "circuit")} value={pv("circuit")} onChange={(v) => setPp({ ...pp, circuit: v })}
            options={CIRCUIT_IDS.map((c) => ({ value: c, label: CIRCUITS[c].name }))} />
          <MixedSel label="Material" current={commonValue(pipes, "material")} value={pv("material")} onChange={(v) => setPp({ ...pp, material: v })}
            options={MATERIALS.map((m) => ({ value: m.id, label: m.short }))} />
          <MixedSel label="Îmbinare" current={commonValue(pipes, "joint")} value={pv("joint")} onChange={(v) => setPp({ ...pp, joint: v })}
            options={(Object.keys(JOINT_LABEL) as JointType[]).map((j) => ({ value: j, label: JOINT_LABEL[j] }))} />
          <MixedSel label="DN" current={commonValue(pipes, "dn")} value={pv("dn")} onChange={(v) => setPp({ ...pp, dn: v })}
            options={DN_LIST.map((d) => ({ value: d, label: `DN${d}` }))} />
          <MixedSel label="În funcțiune" current={(() => { const v = commonValue(pipes, "disabled"); return v === MIXED ? MIXED : v ? "yes" : "no"; })()}
            value={pv("disabled")} onChange={(v) => setPp({ ...pp, disabled: v })} options={[{ value: "no", label: "Activ" }, { value: "yes", label: "Scos din funcțiune" }]} />
          <MixedSel label="Strat" current={layersOf(pipes.map(pipeLayer))} value={pv("layer")} onChange={(v) => setPp({ ...pp, layer: v })}
            options={LAYERS.filter((l) => l.accepts.includes("pipe")).map((l) => ({ value: l.id, label: l.name }))} />
          <Field label={`Izolație · actual: ${(() => { const v = commonValue(pipes, "insulation"); return v === MIXED ? "mixed" : v ?? "—"; })()}`}>
            <Input className="h-8" value={insulation} placeholder="ex. elastomer 19 mm (gol = nu se modifică)" onChange={(e) => setInsulation(e.target.value)} />
          </Field>
        </div>
      )}
      {nodes.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Elemente</div>
          <MixedSel label="Stare (terminale/surse)" current={(() => { const v = commonValue(nodes, "redundant"); return v === MIXED ? MIXED : v ? "yes" : "no"; })()}
            value={nv("redundant")} onChange={(v) => setNp({ ...np, redundant: v })} options={[{ value: "no", label: "Activ" }, { value: "yes", label: "Redundant" }]} />
          <MixedSel label="DN (vane/fitinguri)" current={commonValue(nodes, "dn")} value={nv("dn")} onChange={(v) => setNp({ ...np, dn: v })}
            options={DN_LIST.map((d) => ({ value: d, label: `DN${d}` }))} />
          <MixedSel label="Strat" current={layersOf(nodes.map(nodeLayer))} value={nv("layer")} onChange={(v) => setNp({ ...np, layer: v })}
            options={LAYERS.filter((l) => l.accepts.includes("node")).map((l) => ({ value: l.id, label: l.name }))} />
        </div>
      )}
      <Button size="sm" className="w-full" onClick={apply}>Aplică pe selecție (1 Undo)</Button>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" className="gap-1.5" disabled={!pipes.length}
          onClick={() => { const r = autoSizeSelected("legacy"); toast.success(`Auto-size: ${r.pipes} conducte redimensionate · rețea recalculată`); }}>
          <Wand2 className="h-3.5 w-3.5" />Auto-size</Button>
        <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => { const n = rerouteSelected(); toast(n ? `${n} conducte rerutate (Undo disponibil)` : "Traseele actuale sunt deja optime"); }}>
          <Route className="h-3.5 w-3.5" />Smart route</Button>
        <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => {
          const prefix = prompt("Prefix tag (gol = prefixul tipului):", "") ?? null;
          if (prefix === null) return;
          const start = Number(prompt("Număr de start:", "1") ?? "1") || 1;
          retagSelected(prefix || undefined, start);
        }}><Tags className="h-3.5 w-3.5" />Retag</Button>
        <Button size="sm" variant="secondary" className="gap-1.5" disabled={!nodes.length} onClick={() => duplicateNodes(nodes.map((n) => n.id))}>
          <Copy className="h-3.5 w-3.5" />Duplică</Button>
        <Button size="sm" variant="secondary" className="gap-1.5" disabled={!nodes.length}
          onClick={() => { const nm = prompt("Numele modulului (reutilizabil în orice proiect):", "Modul nou"); if (nm) saveModule(nm, nodes.map((n) => n.id)); }}>
          <Save className="h-3.5 w-3.5" />Modul</Button>
        <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => { if (total <= BIG || confirm(`Ștergi ${total} obiecte?`)) removeSelected(); }}>
          <Trash2 className="h-3.5 w-3.5" />Șterge</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Câmpurile incompatibile (ex. DN în afara gamei materialului, Activ/Redundant pe vane) sunt sărite cu avertizare. Obiectele din straturi blocate nu se modifică.</p>
    </div>
  );
}
