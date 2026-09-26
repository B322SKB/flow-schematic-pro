import { Trash2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CIRCUITS, DN_LIST, FITTINGS, JOINT_LABEL, MATERIALS, getMaterial, innerDiameterMm, jointAllowed, sizeLabel,
  type CircuitId, type FittingId, type JointType, type MaterialId,
} from "@/lib/pid/catalog";
import { autoBends, computePipe, fmtP } from "@/lib/pid/hydraulics";
import { fluidProps } from "@/lib/pid/fluids";
import { usePid } from "@/lib/pid/store";
import { SYMBOLS } from "@/lib/pid/symbols";
import type { Pipe } from "@/lib/pid/types";
import { Field, Sel } from "./fields";

export function dnOptions(mat: MaterialId) {
  const m = getMaterial(mat);
  return DN_LIST.filter((d) => d >= m.dnRange[0] && d <= m.dnRange[1]).map((d) => ({ value: d, label: sizeLabel(mat, d) }));
}

export function normalizePipe(p: Pipe, patch: Partial<Pipe>): Partial<Pipe> {
  const next = { ...p, ...patch };
  const m = getMaterial(next.material);
  if (next.dn < m.dnRange[0]) next.dn = m.dnRange[0];
  if (next.dn > m.dnRange[1]) next.dn = m.dnRange[1];
  if (!m.joints.includes(next.joint) || !jointAllowed(next.joint, next.dn)) {
    next.joint = m.joints.find((j) => jointAllowed(j, next.dn)) ?? m.joints[0];
  }
  return { ...patch, dn: next.dn, joint: next.joint };
}

export function Inspector() {
  const { scheme, selected, updateNode, updatePipe, removeSelected, recalcLengths, pipeDefaults, setPipeDefaults } = usePid();
  const node = selected?.kind === "node" ? scheme.nodes.find((n) => n.id === selected.id) : undefined;
  const pipe = selected?.kind === "pipe" ? scheme.pipes.find((p) => p.id === selected.id) : undefined;
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);

  return (
    <ScrollArea className="h-full border-l bg-sidebar">
      <div className="space-y-4 p-4">
        {!node && !pipe && (
          <>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Setări conductă nouă</div>
            <p className="text-xs text-muted-foreground">Aceste valori se aplică următoarelor conducte trasate.</p>
            <PipeFields value={pipeDefaults as Pipe} onChange={(p) => setPipeDefaults(normalizePipe(pipeDefaults as Pipe, p) as never)} />
            <Field label="Debit implicit (m³/h)">
              <Input type="number" className="h-8" value={pipeDefaults.flow} onChange={(e) => setPipeDefaults({ flow: +e.target.value })} />
            </Field>
          </>
        )}

        {node && (() => {
          const s = SYMBOLS[node.type];
          return (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.category}</div>
                  <div className="font-semibold">{s.name}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="secondary" onClick={() => { updateNode(node.id, { rotation: (node.rotation + 90) % 360 }); recalcLengths(); }}><RotateCw className="h-4 w-4" /></Button>
                  <Button size="icon" variant="destructive" onClick={removeSelected}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <Field label="Tag"><Input className="h-8 font-mono" value={node.tag} onChange={(e) => updateNode(node.id, { tag: e.target.value })} /></Field>
              {s.bomGroup !== "Echipamente" && (
                <Field label="DN (gol = după conductă)">
                  <Sel value={node.dn ?? 0} onChange={(v) => updateNode(node.id, { dn: v || undefined })}
                    options={[{ value: 0, label: "Auto" }, ...DN_LIST.map((d) => ({ value: d, label: `DN${d}` }))]} />
                </Field>
              )}
              {s.K !== undefined && (
                <Field label={`Coeficient K (implicit ${s.K})`}>
                  <Input type="number" step="0.1" className="h-8" value={node.kOverride ?? s.K}
                    onChange={(e) => updateNode(node.id, { kOverride: +e.target.value })} />
                </Field>
              )}
              {s.bomGroup === "Echipamente" && (
                <>
                  <Field label="Cădere presiune echipament (kPa)">
                    <Input type="number" className="h-8" value={node.dpFixed ?? 0} onChange={(e) => updateNode(node.id, { dpFixed: +e.target.value })} />
                  </Field>
                  <Field label="Specificație (BOM)">
                    <Input className="h-8" value={node.note ?? ""} placeholder="ex. 350 kW, 60 m³/h @ 20 mCA"
                      onChange={(e) => updateNode(node.id, { note: e.target.value })} />
                  </Field>
                </>
              )}
              <p className="text-xs text-muted-foreground">Pierderea locală a elementului se atribuie conductei care intră în el.</p>
            </>
          );
        })()}

        {pipe && (() => {
          const r = computePipe(pipe, scheme, fp);
          const bends = autoBends(pipe, scheme);
          const upd = (p: Partial<Pipe>) => updatePipe(pipe.id, normalizePipe(pipe, p));
          return (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Segment conductă</div>
                  <Input className="mt-1 h-8 font-mono" value={pipe.tag} onChange={(e) => updatePipe(pipe.id, { tag: e.target.value })} />
                </div>
                <Button size="icon" variant="destructive" onClick={removeSelected}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <PipeFields value={pipe} onChange={upd} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Lungime (m)"><Input type="number" step="0.1" className="h-8" value={pipe.length} onChange={(e) => updatePipe(pipe.id, { length: +e.target.value })} /></Field>
                <Field label="Debit (m³/h)"><Input type="number" step="0.1" className="h-8" value={pipe.flow} onChange={(e) => updatePipe(pipe.id, { flow: +e.target.value })} /></Field>
              </div>
              <Field label="Traseu">
                <Sel value={pipe.routing} onChange={(v) => { updatePipe(pipe.id, { routing: v }); recalcLengths(); }}
                  options={[{ value: "auto", label: "Automat (Z)" }, { value: "hv", label: "Orizontal → vertical" }, { value: "vh", label: "Vertical → orizontal" }]} />
              </Field>
              <div>
                <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Fitinguri suplimentare</div>
                <div className="mb-2 text-xs text-muted-foreground">+ {bends} cot(uri) 90° deduse din traseu</div>
                <div className="space-y-1.5">
                  {(Object.keys(FITTINGS) as FittingId[]).map((k) => (
                    <div key={k} className="flex items-center justify-between gap-2 text-sm">
                      <span>{FITTINGS[k].name} <span className="text-xs text-muted-foreground">K={FITTINGS[k].K}</span></span>
                      <Input type="number" min={0} className="h-7 w-16" value={pipe.fittings[k] ?? 0}
                        onChange={(e) => updatePipe(pipe.id, { fittings: { ...pipe.fittings, [k]: Math.max(0, +e.target.value) } })} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-md border bg-card p-3 font-mono text-xs">
                <div className="mb-2 flex items-center justify-between font-sans text-[11px] uppercase tracking-wider text-muted-foreground">
                  Rezultat hidraulic
                  {r.velWarn && <Badge variant={r.velWarn === "high" ? "destructive" : "secondary"}>{r.velWarn === "high" ? "viteză mare" : "viteză mică"}</Badge>}
                </div>
                <Row k="Di" v={`${innerDiameterMm(pipe.material, pipe.dn).toFixed(1)} mm`} />
                <Row k="v" v={`${r.v.toFixed(2)} m/s`} />
                <Row k="Re" v={`${Math.round(r.Re).toLocaleString("ro-RO")} (${r.regime})`} />
                <Row k="λ" v={r.f.toFixed(4)} />
                <Row k="R" v={`${r.R.toFixed(0)} Pa/m`} />
                <Row k="Δp liniar" v={`${fmtP(r.dpLin, "kPa")} kPa`} />
                <Row k="ΣK / Δp local" v={`${r.Ksum.toFixed(2)} / ${fmtP(r.dpLoc, "kPa")} kPa`} />
                <Row k="Δp elemente" v={`${fmtP(r.dpComp, "kPa")} kPa`} />
                <Row k="Δp total" v={`${fmtP(r.dpTotal, "kPa")} kPa`} strong />
              </div>
            </>
          );
        })()}
      </div>
    </ScrollArea>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className={`flex justify-between py-0.5 ${strong ? "border-t pt-1 font-semibold text-primary" : ""}`}><span className="text-muted-foreground">{k}</span><span>{v}</span></div>;
}

function PipeFields({ value, onChange }: { value: Pipe; onChange: (p: Partial<Pipe>) => void }) {
  const m = getMaterial(value.material);
  return (
    <>
      <Field label="Circuit / mediu">
        <Sel<CircuitId> value={value.circuit} onChange={(v) => onChange({ circuit: v })}
          options={(Object.keys(CIRCUITS) as CircuitId[]).map((c) => ({ value: c, label: CIRCUITS[c].name }))} />
      </Field>
      <Field label="Material">
        <Sel<MaterialId> value={value.material} onChange={(v) => onChange({ material: v })}
          options={MATERIALS.map((x) => ({ value: x.id, label: x.name }))} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Diametru">
          <Sel<number> value={value.dn} onChange={(v) => onChange({ dn: v })} options={dnOptions(value.material)} />
        </Field>
        <Field label="Îmbinare">
          <Sel<JointType> value={value.joint} onChange={(v) => onChange({ joint: v })}
            options={m.joints.filter((j) => jointAllowed(j, value.dn)).map((j) => ({ value: j, label: JOINT_LABEL[j] }))} />
        </Field>
      </div>
    </>
  );
}
