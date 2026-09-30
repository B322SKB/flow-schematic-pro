import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FilePlus2, RefreshCcw, Sigma, Tags, Workflow, Gauge, ClipboardList, FileText, Image as ImageIcon, FileCode2, ChevronLeft, ChevronRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PidCanvas } from "@/components/pid/Canvas";
import { Palette } from "@/components/pid/Palette";
import { Inspector } from "@/components/pid/Inspector";
import { HydraulicsView } from "@/components/pid/HydraulicsView";
import { BomView } from "@/components/pid/BomView";
import { ColorsDialog, ProjectsDialog, SystemDialog } from "@/components/pid/Dialogs";
import { usePid } from "@/lib/pid/store";
import { CIRCUITS, CIRCUIT_IDS, circuitColor } from "@/lib/pid/catalog";
import { fluidProps } from "@/lib/pid/fluids";
import { computePipe } from "@/lib/pid/hydraulics";
import { powerTotals } from "@/lib/pid/power";
import { exportSchemeDxf, exportSchemePdf, exportSchemePng, exportSchemeSvg, schemeSvgString } from "@/lib/pid/export";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "P&ID Studio — Editor scheme, hidraulică și BOM" },
      { name: "description", content: "Editor P&ID ISA-5.1 cu calcul căderi de presiune Darcy-Weisbach și listă de cantități BOM/MTO exportabilă." },
      { property: "og:title", content: "P&ID Studio — Editor scheme, hidraulică și BOM" },
      { property: "og:description", content: "Scheme P&ID, calcul hidraulic pentru apă și glicol, liste de cantități Excel/PDF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <div className="flex h-screen items-center justify-center font-mono text-sm text-muted-foreground">Se încarcă P&ID Studio…</div>;
  return <App />;
}

function App() {
  const { scheme, setScheme, reset, retag, applyAutoFlows } = usePid();
  const svgRef = useRef<SVGSVGElement>(null);
  const fp = fluidProps(scheme.fluid, scheme.concentration, scheme.temperature);
  const results = scheme.pipes.map((p) => computePipe(p, scheme, fp));
  const total = results.reduce((s, r) => s + r.dpTotal, 0);
  const stats = {
    dpTotal: total / 1000,
    flowMax: scheme.pipes.reduce((m, p) => Math.max(m, p.flow), 0),
    lengthTotal: results.reduce((s, r) => s + r.L, 0),
  };
  const pw = powerTotals(scheme);
  const [mode, setMode] = useState<"normal" | "clean" | "coded">("normal");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const wait = () => new Promise((r) => setTimeout(r, 120));
  const run = async (fn: () => unknown, label: string, m: "clean" | "coded" = "coded") => {
    usePid.getState().select(null);
    setMode(m);
    await wait();
    try { await fn(); toast.success(`${label} generat`); } catch (e) { console.error(e); toast.error(`${label} nu a putut fi generat`); }
    finally { setMode("normal"); }
  };
  const pdf = async () => {
    const svg = svgRef.current!;
    const clean = schemeSvgString(svg);
    setMode("coded");
    await wait();
    const coded = schemeSvgString(svg);
    if (clean && coded) await exportSchemePdf(clean, coded, scheme, stats);
  };

  return (
    <Tabs defaultValue="editor" className="flex h-screen flex-col gap-0">
      <header className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary font-mono text-xs font-bold text-primary-foreground">P&ID</div>
          <Input value={scheme.name} onChange={(e) => setScheme({ name: e.target.value })} className="h-8 w-52 border-transparent bg-transparent font-semibold hover:border-input" />
          <Input value={scheme.revision} onChange={(e) => setScheme({ revision: e.target.value })} className="h-8 w-16 font-mono text-xs" title="Revizie" />
        </div>
        <TabsList>
          <TabsTrigger value="editor"><Workflow className="mr-1.5 h-4 w-4" />Editor</TabsTrigger>
          <TabsTrigger value="hydro"><Gauge className="mr-1.5 h-4 w-4" />Hidraulică</TabsTrigger>
          <TabsTrigger value="bom"><ClipboardList className="mr-1.5 h-4 w-4" />BOM / MTO</TabsTrigger>
        </TabsList>
        <SystemDialog />
        <div className="ml-auto hidden flex-col items-end gap-0.5 font-mono text-[11px] text-muted-foreground xl:flex">
          <div className="flex gap-4">
            <span>{scheme.nodes.length} elemente · {scheme.pipes.length} segmente · {stats.lengthTotal.toFixed(1)} m</span>
            <span title="Proiectul se salvează automat în acest browser la fiecare modificare">salvat {new Date(scheme.updatedAt).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="text-primary">Δp total {stats.dpTotal.toFixed(1)} kPa</span>
          </div>
          <div className="flex gap-3">
            <span title="Suma puterilor sensibile ale echipamentelor terminale active și redundante">P sens. instalată <b className="text-foreground">{pw.sensInstalled.toFixed(1)} kW</b></span>
            <span title="Suma puterilor sensibile ale echipamentelor terminale active">P sens. <b className="text-foreground">{pw.sensActive.toFixed(1)} kW</b></span>
            <span title="Suma puterilor echipamentelor terminale active">P necesară <b className="text-foreground">{pw.required.toFixed(1)} kW</b></span>
            <span title="Suma puterilor chillerelor active" className={pw.deficit ? "rounded bg-destructive/15 px-1 text-destructive" : ""}>
              P furnizată <b className={pw.deficit ? "text-destructive" : "text-foreground"}>{pw.supplied.toFixed(1)} kW</b>
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          <ProjectsDialog />
          <ColorsDialog />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" className="gap-1.5"><FileText className="h-4 w-4" />Export schemă</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => svgRef.current && run(pdf, "PDF cu cartuș și legendă", "clean")}>
                <FileText className="mr-2 h-4 w-4" />PDF A3 cu legendă și cartuș
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => svgRef.current && run(() => exportSchemePng(svgRef.current!, scheme.name), "PNG")}>
                <ImageIcon className="mr-2 h-4 w-4" />Imagine PNG (înaltă rezoluție)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => svgRef.current && run(() => exportSchemeSvg(svgRef.current!, scheme.name), "SVG")}>
                <FileCode2 className="mr-2 h-4 w-4" />Desen vectorial SVG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => svgRef.current && run(() => exportSchemeDxf(svgRef.current!, scheme.name), "DXF")}>
                <FileCode2 className="mr-2 h-4 w-4" />Desen DXF (AutoCAD)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" title="Însumează automat debitele de la consumatori spre sursă"
            onClick={() => {
              const r = applyAutoFlows();
              const extra = [
                r.ambiguous ? `${r.ambiguous} de inel rămân manuale` : "",
                r.unresolved ? `${r.unresolved} fără legătură la sursă` : "",
              ].filter(Boolean).join(" · ");
              toast.success(`${r.updated} tronson(e) actualizate · cerere totală ${r.demand} m³/h${extra ? ` · ${extra}` : ""}`);

            }}><Sigma className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={retag} title="Re-numerotează tag-urile"><Tags className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => confirm("Reîncarci schema demo în acest proiect?") && reset()} title="Schemă demo"><RefreshCcw className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => confirm("Golești schema din acest proiect?") && reset(true)} title="Golește schema"><FilePlus2 className="h-4 w-4" /></Button>
        </div>
      </header>
      <TabsContent value="editor" className="mt-0 min-h-0 flex-1">
        <div className="grid h-full" style={{ gridTemplateColumns: `${leftOpen ? "230px" : "0px"} 1fr ${rightOpen ? "310px" : "0px"}` }}>
          <div className={leftOpen ? "min-w-0 overflow-hidden" : "hidden"}><Palette /></div>
          <div className="relative min-w-0">
            <PidCanvas svgRef={svgRef} showTags={mode === "coded"} hideCodes={mode === "clean"} />
            <div className="pointer-events-none absolute left-3 top-3 flex max-w-[60%] flex-wrap gap-2 rounded-md border bg-card/90 px-3 py-1.5 text-[11px] backdrop-blur">
              {CIRCUIT_IDS.map((c) => (
                <span key={c} className="flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: circuitColor(scheme, c) }} />{CIRCUITS[c].name}</span>
              ))}
            </div>
            <Button size="icon" variant="secondary" className="absolute left-0 top-1/2 h-10 w-5 -translate-y-1/2 rounded-l-none"
              title={leftOpen ? "Ascunde paleta de elemente" : "Arată paleta de elemente"} onClick={() => setLeftOpen((v) => !v)}>
              {leftOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
            <Button size="icon" variant="secondary" className="absolute right-0 top-1/2 h-10 w-5 -translate-y-1/2 rounded-r-none"
              title={rightOpen ? "Ascunde panoul de proprietăți" : "Arată panoul de proprietăți"} onClick={() => setRightOpen((v) => !v)}>
              {rightOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>
          <div className={rightOpen ? "min-w-0 overflow-hidden" : "hidden"}><Inspector /></div>
        </div>
      </TabsContent>
      <TabsContent value="hydro" className="mt-0 min-h-0 flex-1"><HydraulicsView /></TabsContent>
      <TabsContent value="bom" className="mt-0 min-h-0 flex-1"><BomView /></TabsContent>
    </Tabs>
  );
}
