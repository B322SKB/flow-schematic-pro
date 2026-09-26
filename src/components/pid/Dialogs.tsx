import { useRef, useState } from "react";
import { toast } from "sonner";
import { Droplets, Palette as PaletteIcon, PlusCircle, RotateCcw, Trash2, FolderOpen, Upload, Download, Copy, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CIRCUIT_IDS, CIRCUITS, circuitColor, DEFAULT_CIRCUIT_COLORS } from "@/lib/pid/catalog";
import { FLUID_LABEL, fluidProps, type FluidId } from "@/lib/pid/fluids";
import { usePid } from "@/lib/pid/store";
import type { CustomSymbol } from "@/lib/pid/symbols";
import { exportProjectFile } from "@/lib/pid/export";
import { Field, Sel } from "./fields";

/** Fluid de lucru, concentrație, temperatură și ΔT implicit. */
export function SystemDialog() {
  const { scheme, setScheme } = usePid();
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);
  const freezeRisk = scheme.temperature < fp.freeze + 3;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="gap-1.5">
          <Droplets className="h-4 w-4" />
          <span className="hidden font-mono text-xs sm:inline">
            {FLUID_LABEL[scheme.fluid]}{scheme.fluid !== "water" && ` ${scheme.concentration}%`} · {scheme.temperature}°C
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Parametri sistem / fluid</DialogTitle>
          <DialogDescription>Se aplică întregului proiect și tuturor calculelor hidraulice.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Fluid">
            <Sel<FluidId> value={scheme.fluid} onChange={(v) => setScheme({ fluid: v })}
              options={(Object.keys(FLUID_LABEL) as FluidId[]).map((f) => ({ value: f, label: FLUID_LABEL[f] }))} />
          </Field>
          {scheme.fluid !== "water" && (
            <Field label={`Concentrație: ${scheme.concentration}%`}>
              <Slider min={0} max={60} step={1} value={[scheme.concentration]} onValueChange={([v]) => setScheme({ concentration: v ?? 0 })} />
            </Field>
          )}
          <Field label={`Temperatură fluid: ${scheme.temperature} °C`}>
            <Slider min={-20} max={90} step={1} value={[scheme.temperature]} onValueChange={([v]) => setScheme({ temperature: v ?? 0 })} />
          </Field>
          <Field label="ΔT implicit pentru calculul debitului din kW (K)">
            <Input type="number" step="0.5" className="h-8" value={scheme.deltaT} onChange={(e) => setScheme({ deltaT: +e.target.value || 5 })} />
          </Field>
          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <Prop k="ρ densitate" v={`${fp.rho.toFixed(1)} kg/m³`} />
            <Prop k="μ vâscozitate" v={`${(fp.mu * 1000).toFixed(3)} mPa·s`} />
            <Prop k="ν cinematică" v={`${(fp.nu * 1e6).toFixed(3)} mm²/s`} />
            <Prop k="cp" v={`${(fp.cp / 1000).toFixed(3)} kJ/kg·K`} />
            <Prop k="T îngheț" v={`${fp.freeze.toFixed(1)} °C`} />
          </div>
          {freezeRisk && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              Temperatura este aproape de punctul de îngheț — mărește concentrația de glicol.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Prop({ k, v }: { k: string; v: string }) {
  return <div className="rounded border bg-muted/40 px-2 py-1.5"><div className="text-muted-foreground">{k}</div><div className="text-foreground">{v}</div></div>;
}

/** Cod de culoare pe circuite, editabil la nivel de proiect. */
export function ColorsDialog() {
  const { scheme, setCircuitColor, resetCircuitColors } = usePid();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title="Cod de culori circuite"><PaletteIcon className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cod de culori circuite</DialogTitle>
          <DialogDescription>Culorile se aplică pe schemă, în tabele și în legenda exportului.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {CIRCUIT_IDS.map((c) => (
            <div key={c} className="flex items-center gap-3 rounded-md border p-2">
              <input type="color" value={circuitColor(scheme, c)} onChange={(e) => setCircuitColor(c, e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border bg-transparent" />
              <span className="flex-1 text-sm">{CIRCUITS[c].name}</span>
              <span className="font-mono text-xs text-muted-foreground">{circuitColor(scheme, c)}</span>
              {circuitColor(scheme, c).toLowerCase() !== DEFAULT_CIRCUIT_COLORS[c].toLowerCase() && <Badge variant="secondary">modificat</Badge>}
            </div>
          ))}
          <Button variant="secondary" size="sm" className="w-full" onClick={resetCircuitColors}>
            <RotateCcw className="mr-1.5 h-4 w-4" />Revino la culorile implicite
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Adăugare de echipamente/simboluri proprii în bibliotecă. */
export function CustomSymbolDialog() {
  const { scheme, addCustomSymbol, removeCustomSymbol } = usePid();
  const [f, setF] = useState<Omit<CustomSymbol, "id">>({ name: "", code: "", prefix: "", ports: 2, category: "Echipamente", dpDefault: 0, kw: 0 });
  const save = () => {
    if (!f.name.trim()) { toast.error("Completează denumirea."); return; }
    addCustomSymbol({ ...f, code: (f.code || f.name.slice(0, 3)).toUpperCase(), prefix: (f.prefix || f.code || "X").toUpperCase() });
    toast.success(`„${f.name}” a fost adăugat în bibliotecă`);
    setF({ name: "", code: "", prefix: "", ports: 2, category: "Echipamente", dpDefault: 0, kw: 0 });
  };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="w-full gap-1.5"><PlusCircle className="h-4 w-4" />Adaugă element propriu</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Element personalizat</DialogTitle>
          <DialogDescription>Apare în bibliotecă, pe schemă și în lista de cantități.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Denumire"><Input className="h-8" value={f.name} placeholder="ex. Unitate liquid cooling 300 kW" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Cod pe schemă"><Input className="h-8 font-mono" value={f.code} placeholder="LCU" onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
            <Field label="Prefix tag"><Input className="h-8 font-mono" value={f.prefix} placeholder="LCU" onChange={(e) => setF({ ...f, prefix: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Categorie">
              <Sel<CustomSymbol["category"]> value={f.category} onChange={(v) => setF({ ...f, category: v })}
                options={[{ value: "Echipamente", label: "Echipament" }, { value: "Vane", label: "Vană" }, { value: "Fitinguri", label: "Fiting" }]} />
            </Field>
            <Field label="Număr racorduri">
              <Sel<number> value={f.ports} onChange={(v) => setF({ ...f, ports: v })} options={[1, 2, 3, 4].map((n) => ({ value: n, label: `${n}` }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Cădere presiune (kPa)"><Input type="number" className="h-8" value={f.dpDefault ?? 0} onChange={(e) => setF({ ...f, dpDefault: +e.target.value })} /></Field>
            <Field label="Putere (kW)"><Input type="number" className="h-8" value={f.kw ?? 0} onChange={(e) => setF({ ...f, kw: +e.target.value })} /></Field>
          </div>
          <Button className="w-full" onClick={save}>Adaugă în bibliotecă</Button>
          {scheme.customSymbols.length > 0 && (
            <div className="space-y-1.5 border-t pt-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Elemente proprii</div>
              {scheme.customSymbols.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded border px-2 py-1 text-sm">
                  <span className="font-mono text-xs text-primary">{c.code}</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <Button size="icon" variant="ghost" onClick={() => removeCustomSymbol(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Proiecte salvate local, cu import/export fișier. */
export function ProjectsDialog() {
  const { projects, activeId, scheme, switchProject, newProject, duplicateProject, deleteProject, importProject } = usePid();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1.5"><FolderOpen className="h-4 w-4" /><span className="hidden text-xs md:inline">Proiecte ({projects.length})</span></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Proiectele mele</DialogTitle>
          <DialogDescription>Salvate în acest browser. Folosește export/import pentru copii de siguranță.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => newProject("Proiect nou")}><FilePlus2 className="mr-1.5 h-4 w-4" />Proiect nou</Button>
          <Button size="sm" variant="secondary" onClick={() => duplicateProject(activeId)}><Copy className="mr-1.5 h-4 w-4" />Duplică</Button>
          <Button size="sm" variant="secondary" onClick={() => exportProjectFile(scheme)}><Download className="mr-1.5 h-4 w-4" />Export fișier</Button>
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><Upload className="mr-1.5 h-4 w-4" />Import fișier</Button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const err = importProject(await file.text());
              if (err) toast.error(err); else toast.success("Proiect importat");
              e.target.value = "";
            }} />
        </div>
        <ScrollArea className="max-h-72">
          <div className="space-y-1.5 pr-2">
            {projects.map((p) => (
              <div key={p.id} className={`flex items-center gap-2 rounded-md border p-2 ${p.id === activeId ? "border-primary bg-primary/5" : ""}`}>
                <button className="min-w-0 flex-1 text-left" onClick={() => switchProject(p.id)}>
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {p.nodes.length} elemente · {p.pipes.length} segmente · {new Date(p.updatedAt).toLocaleString("ro-RO")}
                  </div>
                </button>
                {p.id === activeId && <Badge>activ</Badge>}
                <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Ștergi proiectul „${p.name}”?`)) deleteProject(p.id); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
