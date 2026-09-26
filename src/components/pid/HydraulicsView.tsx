import { useState } from "react";
import { AlertTriangle, Snowflake } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CIRCUITS, circuitColor, getMaterial, sizeLabel, type CircuitId } from "@/lib/pid/catalog";
import { FLUID_LABEL, fluidProps, type FluidId } from "@/lib/pid/fluids";
import { computePipe, fmtP, type PUnit } from "@/lib/pid/hydraulics";
import { usePid } from "@/lib/pid/store";
import { Field, Sel } from "./fields";

export function FluidCard() {
  const { scheme, setScheme } = usePid();
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);
  const freezeRisk = scheme.temperature < fp.freeze + 3;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm">Fluid de lucru</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Field label="Fluid">
          <Sel<FluidId> value={scheme.fluid} onChange={(v) => setScheme({ fluid: v })}
            options={(Object.keys(FLUID_LABEL) as FluidId[]).map((f) => ({ value: f, label: FLUID_LABEL[f] }))} />
        </Field>
        {scheme.fluid !== "water" && (
          <Field label={`Concentrație: ${scheme.concentration}%`}>
            <Slider min={0} max={60} step={1} value={[scheme.concentration]} onValueChange={([v]) => setScheme({ concentration: v ?? 0 })} />
          </Field>
        )}
        <Field label={`Temperatură: ${scheme.temperature} °C`}>
          <Slider min={-20} max={90} step={1} value={[scheme.temperature]} onValueChange={([v]) => setScheme({ temperature: v ?? 0 })} />
        </Field>
        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          <Prop k="ρ" v={`${fp.rho.toFixed(1)} kg/m³`} />
          <Prop k="μ" v={`${(fp.mu * 1000).toFixed(3)} mPa·s`} />
          <Prop k="ν" v={`${(fp.nu * 1e6).toFixed(3)} mm²/s`} />
          <Prop k="cp" v={`${(fp.cp / 1000).toFixed(3)} kJ/kg·K`} />
          <Prop k="T îngheț" v={`${fp.freeze.toFixed(1)} °C`} />
        </div>
        {freezeRisk && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            <Snowflake className="mt-0.5 h-4 w-4 shrink-0" /> Temperatura este sub/aproape de punctul de îngheț. Măriți concentrația de glicol.
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">Proprietăți calculate prin corelații inginerești (precizie ±5%).</p>
      </CardContent>
    </Card>
  );
}

function Prop({ k, v }: { k: string; v: string }) {
  return <div className="rounded border bg-muted/40 px-2 py-1.5"><div className="text-muted-foreground">{k}</div><div className="text-foreground">{v}</div></div>;
}

export function HydraulicsView() {
  const { scheme, updatePipe, select } = usePid();
  const [pu, setPu] = useState<PUnit>("kPa");
  const [qu, setQu] = useState<"m3h" | "ls">("m3h");
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);
  const results = scheme.pipes.map((p) => ({ p, r: computePipe(p, scheme, fp) }));
  const byCircuit = new Map<CircuitId, { L: number; dp: number; n: number }>();
  for (const { p, r } of results) {
    const c = byCircuit.get(p.circuit) ?? { L: 0, dp: 0, n: 0 };
    c.L += r.L; c.dp += r.dpTotal; c.n++;
    byCircuit.set(p.circuit, c);
  }
  const total = results.reduce((s, x) => s + x.r.dpTotal, 0);
  const warns = results.filter((x) => x.r.velWarn).length;

  return (
    <div className="grid h-full grid-cols-[320px_1fr] gap-4 overflow-auto p-4">
      <div className="space-y-4">
        <FluidCard />
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Unități</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ToggleGroup type="single" variant="outline" size="sm" value={pu} onValueChange={(v) => v && setPu(v as PUnit)}>
              <ToggleGroupItem value="kPa">kPa</ToggleGroupItem><ToggleGroupItem value="bar">bar</ToggleGroupItem><ToggleGroupItem value="mCA">mCA</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup type="single" variant="outline" size="sm" value={qu} onValueChange={(v) => v && setQu(v as "m3h" | "ls")}>
              <ToggleGroupItem value="m3h">m³/h</ToggleGroupItem><ToggleGroupItem value="ls">l/s</ToggleGroupItem>
            </ToggleGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Totaluri pe circuit</CardTitle></CardHeader>
          <CardContent className="space-y-2 font-mono text-xs">
            {[...byCircuit.entries()].map(([c, v]) => (
              <div key={c} className="flex items-center justify-between rounded border px-2 py-1.5">
                <span className="flex items-center gap-2 font-sans"><span className="h-2.5 w-2.5 rounded-full" style={{ background: circuitColor(scheme, c) }} />{CIRCUITS[c].name}</span>
                <span>{v.L.toFixed(1)} m · <b className="text-primary">{fmtP(v.dp, pu, fp.rho)} {pu}</b></span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 text-sm font-semibold"><span className="font-sans">Circuit complet</span><span className="text-primary">{fmtP(total, pu, fp.rho)} {pu}</span></div>
            <p className="font-sans text-[11px] text-muted-foreground">Include pierderile liniare, fitingurile, vanele și căderile de presiune ale echipamentelor.</p>
          </CardContent>
        </Card>
      </div>
      <Card className="min-w-0">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm">Calcul pe segmente · Darcy-Weisbach + Colebrook-White</CardTitle>
          {warns > 0 && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />{warns} avertizări viteză</Badge>}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="font-mono text-xs">
            <TableHeader>
              <TableRow>
                {["Tag", "Material / DN", "L [m]", `Q [${qu === "m3h" ? "m³/h" : "l/s"}]`, "v [m/s]", "Re", "λ", "R [Pa/m]", "ΣK", `Δp lin`, `Δp loc`, `Δp elem`, `Δp total [${pu}]`].map((h) => <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map(({ p, r }) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => select({ kind: "pipe", id: p.id })}>
                  <TableCell className="whitespace-nowrap"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: circuitColor(scheme, p.circuit) }} />{p.tag}</TableCell>
                  <TableCell className="whitespace-nowrap font-sans">{getMaterial(p.material).short} {sizeLabel(p.material, p.dn)}</TableCell>
                  <TableCell>{computePipe(p, scheme, fp).L.toFixed(1)}</TableCell>
                  <TableCell>
                    <Input type="number" step="0.1" className="h-7 w-20 font-mono text-xs"
                      value={qu === "m3h" ? p.flow : +(p.flow / 3.6).toFixed(3)}
                      onChange={(e) => updatePipe(p.id, { flow: qu === "m3h" ? +e.target.value : +e.target.value * 3.6 })} />
                  </TableCell>
                  <TableCell className={r.velWarn === "high" ? "text-destructive" : r.velWarn === "low" ? "text-warning" : ""}>
                    {r.v.toFixed(2)}{r.velWarn && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{Math.round(r.Re)} <span className="text-muted-foreground">{r.regime.charAt(0).toUpperCase()}</span></TableCell>
                  <TableCell>{r.f.toFixed(4)}</TableCell>
                  <TableCell>{r.R.toFixed(0)}</TableCell>
                  <TableCell>{r.Ksum.toFixed(2)}</TableCell>
                  <TableCell>{fmtP(r.dpLin, pu, fp.rho)}</TableCell>
                  <TableCell>{fmtP(r.dpLoc, pu, fp.rho)}</TableCell>
                  <TableCell>{fmtP(r.dpComp, pu, fp.rho)}</TableCell>
                  <TableCell className="font-semibold text-primary">{fmtP(r.dpTotal, pu, fp.rho)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-[11px] text-muted-foreground">Limite viteză recomandate: ≤DN25 0,3–1,0 m/s · ≤DN50 0,4–1,5 · ≤DN100 0,5–2,0 · &gt;DN100 0,6–2,8 m/s. L = laminar (Re&lt;2300), T = turbulent.</p>
        </CardContent>
      </Card>
    </div>
  );
}
