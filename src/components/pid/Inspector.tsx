import { useState } from "react";
import { Trash2, RotateCw, ArrowLeftRight, Zap, Copy, Move, Lightbulb, Save } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { pipePower } from "@/lib/pid/power";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  CIRCUITS, CIRCUIT_IDS, DN_LIST, FITTINGS, JOINT_LABEL, MATERIALS, circuitColor, getMaterial,
  innerDiameterMm, jointAllowed, sizeLabel,
  type CircuitId, type FittingId, type JointType, type MaterialId,
} from "@/lib/pid/catalog";
import { autoBends, colebrook, computePipe, fmtP, velocityLimits } from "@/lib/pid/hydraulics";
import { flowFromKw, fluidProps } from "@/lib/pid/fluids";
import { usePid } from "@/lib/pid/store";
import { getSymbol } from "@/lib/pid/symbols";
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
    next.joint = m.joints.find((j) => jointAllowed(j, next.dn)) ?? m.joints[0]!;
  }
  return { ...patch, dn: next.dn, joint: next.joint };
}

export function Inspector() {
  const { scheme, selected, multi, multiPipes, grid, setGrid, updateNode, updatePipe, removeSelected, flipPipe, pipeDefaults, setPipeDefaults, duplicateNodes, saveModule } = usePid();
  const node = selected?.kind === "node" ? scheme.nodes.find((n) => n.id === selected.id) : undefined;
  const pipe = selected?.kind === "pipe" ? scheme.pipes.find((p) => p.id === selected.id) : undefined;
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);

  return (
    <ScrollArea className="h-full border-l bg-sidebar">
      <div className="space-y-4 p-4">
        {multi.length > 1 && (
          <div className="space-y-2 rounded-md border border-primary/50 bg-primary/5 p-3">
            <div className="text-sm font-semibold">{multi.length} elemente selectate</div>
            <p className="text-xs text-muted-foreground">Trage oricare element pentru a muta grupul; săgețile mută fin (Shift = 10 px).</p>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 gap-1.5" onClick={() => duplicateNodes(multi)}><Copy className="h-4 w-4" />Duplică grupul</Button>
              <Button size="sm" variant="destructive" onClick={removeSelected}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <Button size="sm" variant="secondary" className="w-full gap-1.5"
              onClick={() => { const nm = prompt("Numele modulului (reutilizabil în orice proiect):", "Modul nou"); if (nm) saveModule(nm, multi); }}>
              <Save className="h-4 w-4" />Salvează ca modul reutilizabil
            </Button>
          </div>
        )}
        {multiPipes.length > 0 && <MultiPipePanel />}
        {!node && !pipe && (
          <>
            <Field label="Pas grilă desen">
              <Sel<number> value={grid} onChange={setGrid} options={[1, 5, 10, 20].map((g) => ({ value: g, label: `${g} px` }))} />
            </Field>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Setări conductă nouă</div>
            <p className="text-xs text-muted-foreground">Aceste valori se aplică următoarelor conducte trasate.</p>
            <PipeFields value={pipeDefaults as Pipe} onChange={(p) => setPipeDefaults(normalizePipe(pipeDefaults as Pipe, p) as never)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Lungime implicită (m)">
                <Input type="number" step="0.1" className="h-8" value={pipeDefaults.length} onChange={(e) => setPipeDefaults({ length: +e.target.value })} />
              </Field>
              <Field label="Debit implicit (m³/h)">
                <Input type="number" className="h-8" value={pipeDefaults.flow} onChange={(e) => setPipeDefaults({ flow: +e.target.value })} />
              </Field>
            </div>
            <DnAdvisor flow={pipeDefaults.flow} material={pipeDefaults.material} dn={pipeDefaults.dn} onPick={(dn) => setPipeDefaults({ dn })} />
          </>
        )}

        {node && multi.length <= 1 && (() => {
          const s = getSymbol(node.type);
          return (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.category}{s.code ? ` · ${s.code}` : ""}</div>
                  <div className="font-semibold">{s.name}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="secondary" title="Duplică (Ctrl+D)" onClick={() => duplicateNodes([node.id])}><Copy className="h-4 w-4" /></Button>
                  <Button size="icon" variant="secondary" onClick={() => updateNode(node.id, { rotation: (node.rotation + 90) % 360 })}><RotateCw className="h-4 w-4" /></Button>
                  <Button size="icon" variant="destructive" onClick={removeSelected}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <Field label="Tag"><Input className="h-8 font-mono" value={node.tag} onChange={(e) => updateNode(node.id, { tag: e.target.value })} /></Field>
              {(node.codeDx || node.codeDy) ? (
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={() => updateNode(node.id, { codeDx: 0, codeDy: 0 })}>
                  <Move className="h-3.5 w-3.5" />Readu eticheta de cod la poziția inițială
                </Button>
              ) : s.code ? <p className="text-[11px] text-muted-foreground">Eticheta „{s.code}” poate fi trasă pe desen dacă se suprapune.</p> : null}
              {(s.terminal || s.source) && (
                <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                  <span className="text-sm">{node.redundant ? "Redundant" : "Activ"}</span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    Activ <Switch checked={!!node.redundant} onCheckedChange={(v) => updateNode(node.id, { redundant: v })} /> Redundant
                  </div>
                </div>
              )}
              {s.hasVolume && (
                <Field label="Volum (litri)">
                  <Input type="number" min={0} className="h-8" value={node.volume ?? 0} onChange={(e) => updateNode(node.id, { volume: +e.target.value })} />
                </Field>
              )}
              {s.riser && (
                <Field label={`Cotă ${s.riser === "up" ? "urcare (+)" : "coborâre (−)"} — m`}>
                  <Input type="number" step="0.1" min={0} className="h-8" value={node.z ?? 0} onChange={(e) => updateNode(node.id, { z: Math.abs(+e.target.value) })} />
                </Field>
              )}
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
                  {s.terminal && (
                    <Field label="Putere sensibilă (kW)">
                      <Input type="number" className="h-8" value={node.kwSens ?? 0} onChange={(e) => updateNode(node.id, { kwSens: +e.target.value })} />
                    </Field>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={s.terminal ? "Putere totală (kW)" : "Putere (kW)"}>
                      <Input type="number" className="h-8" value={node.kw ?? 0} onChange={(e) => updateNode(node.id, { kw: +e.target.value })} />
                    </Field>
                    <Field label="ΔT (K)">
                      <Input type="number" step="0.5" className="h-8" value={node.deltaT ?? scheme.deltaT}
                        onChange={(e) => updateNode(node.id, { deltaT: +e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Debit (m³/h)">
                    <Input type="number" step="0.1" className="h-8" value={node.flow ?? 0} onChange={(e) => updateNode(node.id, { flow: +e.target.value })} />
                  </Field>
                  {!!node.kw && (
                    <p className="flex items-center gap-1.5 text-xs text-primary">
                      <Zap className="h-3.5 w-3.5" />
                      Debit calculat din {node.kw} kW și ΔT {node.deltaT ?? scheme.deltaT} K: {flowFromKw(node.kw, node.deltaT ?? scheme.deltaT, fp).toFixed(2)} m³/h
                    </p>
                  )}
                  {s.source && (
                    <div className="space-y-2 rounded-md border bg-card p-3">
                      <Field label="Modul hidraulic integrat">
                        <Sel value={node.intPump ?? "none"}
                          onChange={(v) => updateNode(node.id, { intPump: v === "none" ? undefined : (v as "single" | "twin") })}
                          options={[
                            { value: "none", label: "Fără pompă integrată" },
                            { value: "single", label: "Pompă simplă integrată" },
                            { value: "twin", label: "Pompă dublă integrată (1A+1R)" },
                          ]} />
                      </Field>
                      {node.intPump && (
                        <>
                          <Field label="Presiune utilă la flanșe (kPa)">
                            <Input type="number" step="5" min={0} className="h-8" value={node.pumpHead ?? 0}
                              onChange={(e) => updateNode(node.id, { pumpHead: +e.target.value })} />
                          </Field>
                          <p className="text-[11px] text-muted-foreground">
                            Presiunea utilă se scade din sarcina cerută pompelor exterioare, pe traseul critic.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                  <Field label="Specificație suplimentară (BOM)">
                    <Input className="h-8" value={node.note ?? ""} placeholder="ex. R513A, 2 circuite, 400V"
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
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: circuitColor(scheme, pipe.circuit) }} />
                    Conductă DN{pipe.dn}
                  </div>
                  <Input className="mt-1 h-8 font-mono" value={pipe.tag} onChange={(e) => updatePipe(pipe.id, { tag: e.target.value })} />
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="secondary" title="Inversează sensul de curgere" onClick={() => flipPipe(pipe.id)}><ArrowLeftRight className="h-4 w-4" /></Button>
                  <Button size="icon" variant="destructive" onClick={removeSelected}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm">
                <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-primary" />Putere transportată</span>
                <span className="font-mono font-semibold text-primary">{pipePower(pipe, scheme, fp).toFixed(1)} kW</span>
              </div>
              <div className="space-y-2 rounded-md border bg-card px-3 py-2 text-sm">
                <label className="flex items-center justify-between gap-2">
                  <span>Legătură directă (fără țeavă)</span>
                  <Switch checked={!!pipe.direct} onCheckedChange={(v) => updatePipe(pipe.id, { direct: v, ...(v ? { length: 0 } : {}) })} />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span>Tronson scos din funcțiune <span className="block text-[11px] text-muted-foreground">scenariu inel / redundanță</span></span>
                  <Switch checked={!!pipe.disabled} onCheckedChange={(v) => updatePipe(pipe.id, { disabled: v })} />
                </label>
              </div>
              <PipeFields value={pipe} onChange={upd} />
              <DnAdvisor flow={pipe.flow} material={pipe.material} dn={pipe.dn} onPick={(dn) => upd({ dn })} />
              {!pipe.direct && <Field label="Lungime reală (m) — introdusă manual">
                <Input type="number" step="0.1" min={0} className="h-8" value={pipe.length} onChange={(e) => updatePipe(pipe.id, { length: +e.target.value })} />
              </Field>}
              <Field label="Debit">
                <ToggleGroup type="single" variant="outline" size="sm" className="mb-2" value={pipe.flowMode}
                  onValueChange={(v) => v && updatePipe(pipe.id, { flowMode: v as Pipe["flowMode"] })}>
                  <ToggleGroupItem value="manual">Manual</ToggleGroupItem>
                  <ToggleGroupItem value="kw">Din kW și ΔT</ToggleGroupItem>
                </ToggleGroup>
                {pipe.flowMode === "manual" ? (
                  <Input type="number" step="0.1" className="h-8" value={pipe.flow} onChange={(e) => updatePipe(pipe.id, { flow: +e.target.value })} />
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="number" className="h-8" placeholder="kW" value={pipe.kw ?? 0} onChange={(e) => updatePipe(pipe.id, { kw: +e.target.value })} />
                      <Input type="number" step="0.5" className="h-8" placeholder="ΔT" value={pipe.deltaT ?? scheme.deltaT} onChange={(e) => updatePipe(pipe.id, { deltaT: +e.target.value })} />
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-xs text-primary"><Zap className="h-3.5 w-3.5" />{pipe.flow.toFixed(2)} m³/h</div>
                  </div>
                )}
              </Field>
              <Field label="Traseu pe desen">
                <Sel value={pipe.routing} onChange={(v) => updatePipe(pipe.id, { routing: v, points: undefined })}
                  options={[{ value: "auto", label: "Automat (Z)" }, { value: "hv", label: "Orizontal → vertical" }, { value: "vh", label: "Vertical → orizontal" }]} />
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>{pipe.points?.length ? "Traseu modificat manual" : "Trage de pătratele de pe conductă pentru a o rearanja"}</span>
                  {!!pipe.points?.length && <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => updatePipe(pipe.id, { points: undefined })}>Resetează</Button>}
                </div>
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
                <Row k="L calcul" v={`${r.L.toFixed(1)} m`} />
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
          options={CIRCUIT_IDS.map((c) => ({ value: c, label: CIRCUITS[c].name }))} />
      </Field>
      <Field label="Material">
        <Sel<MaterialId> value={value.material} onChange={(v) => onChange({ material: v })}
          options={MATERIALS.map((x) => ({ value: x.id, label: x.name }))} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Diametru / secțiune">
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


/** Fereastră de asistență: secțiunea recomandată pentru debitul dat. */
function DnAdvisor({ flow, material, dn, onPick }: { flow: number; material: MaterialId; dn: number; onPick: (dn: number) => void }) {
  const scheme = usePid((s) => s.scheme);
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);
  const m = getMaterial(material);
  if (!flow || flow <= 0) return null;
  const rows = dnOptions(material).map(({ value: d, label }) => {
    const di = innerDiameterMm(material, d) / 1000;
    const v = flow / 3600 / ((Math.PI * di * di) / 4);
    const Re = (v * di) / fp.nu;
    const f = colebrook(Re, m.roughness / 1000 / di);
    const R = (f / di) * (fp.rho * v * v) / 2;
    const [lo, hi] = velocityLimits(d);
    return { d, label, v, R, ok: v >= lo && v <= hi && R <= 300 };
  });
  const rec = rows.find((r) => r.ok) ?? rows.find((r) => r.R <= 300);
  const show = rows.filter((r) => r.v <= 4 && r.v >= 0.15);
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Lightbulb className="h-3.5 w-3.5 text-primary" />Secțiune recomandată · {flow.toFixed(1)} m³/h
      </div>
      <div className="space-y-0.5 font-mono text-[11px]">
        <div className="grid grid-cols-[1fr_52px_60px] px-1.5 text-muted-foreground"><span>DN</span><span className="text-right">v m/s</span><span className="text-right">R Pa/m</span></div>
        {show.map((r) => (
          <button key={r.d} onClick={() => onPick(r.d)}
            className={`grid w-full grid-cols-[1fr_52px_60px] rounded px-1.5 py-0.5 text-left hover:bg-muted ${r.d === rec?.d ? "bg-primary/15 text-primary" : ""} ${r.d === dn ? "ring-1 ring-primary" : ""} ${!r.ok ? "opacity-60" : ""}`}>
            <span>DN{r.d}{r.d === rec?.d ? " ★" : ""}</span><span className="text-right">{r.v.toFixed(2)}</span><span className="text-right">{r.R.toFixed(0)}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">★ = cel mai mic DN cu viteză în limite și R ≤ 300 Pa/m. Click pentru a aplica.</p>
    </div>
  );
}


function MultiPipePanel() {
  const { scheme, multiPipes, updatePipe, removeSelected } = usePid();
  const [dn, setDn] = useState<number | "">("");
  const [circuit, setCircuit] = useState<CircuitId | "">("");
  const mats = [...new Set(multiPipes.map((id) => scheme.pipes.find((p) => p.id === id)?.material).filter(Boolean))] as MaterialId[];
  const dnOpts = mats.length === 1 ? dnOptions(mats[0]!) : DN_LIST.map((d) => ({ value: d, label: `DN${d}` }));
  const apply = () => {
    for (const id of multiPipes) {
      const patch: Partial<Pipe> = {};
      if (dn !== "") patch.dn = dn as number;
      if (circuit !== "") patch.circuit = circuit as CircuitId;
      if (Object.keys(patch).length) updatePipe(id, patch);
    }
  };
  return (
    <div className="space-y-2 rounded-md border border-primary/50 bg-primary/5 p-3">
      <div className="text-sm font-semibold">{multiPipes.length} conducte selectate</div>
      <p className="text-xs text-muted-foreground">Se aplică tuturor conductelor selectate; reducțiile la joncțiuni apar automat în deviz.</p>
      <Field label="DN comun">
        <Sel<number | ""> value={dn} onChange={(v) => setDn(v as number | "")} options={[{ value: "" as never, label: "— nu se modifică —" }, ...dnOpts]} />
      </Field>
      <Field label="Tip circuit">
        <Sel<CircuitId | ""> value={circuit} onChange={(v) => setCircuit(v as CircuitId | "")}
          options={[{ value: "" as never, label: "— nu se modifică —" }, ...CIRCUIT_IDS.map((c) => ({ value: c, label: CIRCUITS[c].name }))]} />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={apply}>Aplică</Button>
        <Button size="sm" variant="destructive" onClick={removeSelected}><Trash2 className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
