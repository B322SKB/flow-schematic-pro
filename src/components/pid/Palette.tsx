import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { customSymbolDef, SYMBOL_LIST, type SymbolCategory, type SymbolDef } from "@/lib/pid/symbols";
import { usePid } from "@/lib/pid/store";
import { CustomSymbolDialog } from "./Dialogs";

const CATS: SymbolCategory[] = ["Echipamente", "Pompe", "Vane", "Instrumentație", "Fitinguri", "Traseu", "Personalizate"];

export function Palette() {
  const [q, setQ] = useState("");
  const addNode = usePid((s) => s.addNode);
  const customs = usePid((s) => s.scheme.customSymbols);
  const modules = usePid((s) => s.modules);
  const removeModule = usePid((s) => s.removeModule);
  const all: SymbolDef[] = [...SYMBOL_LIST, ...customs.map(customSymbolDef)];
  const list = all.filter((s) => `${s.name} ${s.code ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex h-full flex-col border-r bg-sidebar">
      <div className="space-y-2 border-b p-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bibliotecă ISA-5.1</div>
        <Input placeholder="Caută simbol sau cod…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
        <CustomSymbolDialog />
      </div>
      {modules.length > 0 && (
        <div className="space-y-1.5 border-b p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Module salvate</div>
          {modules.map((m) => (
            <div key={m.id} draggable
              onDragStart={(e) => e.dataTransfer.setData("application/pid-module", m.id)}
              onDoubleClick={() => addNode("port_open", 500, 200)}
              title={`${m.name} – ${m.nodes.length} elemente · trage pe planșă`}
              className="group flex cursor-grab items-center justify-between rounded-md border bg-card px-2 py-1.5 text-xs transition-colors hover:border-primary">
              <span className="truncate">{m.name} <span className="font-mono text-muted-foreground">({m.nodes.length})</span></span>
              <button className="ml-2 text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => removeModule(m.id)} title="Șterge modulul">×</button>
            </div>
          ))}
          <p className="text-[10px] leading-snug text-muted-foreground">
            Trage modulul pe planșă · se re-tagulează automat. Selectezi elemente → „Salvează ca modul reutilizabil" în inspector.
          </p>
        </div>
      )}
      <ScrollArea className="flex-1">
        <Accordion type="multiple" key={q ? "q" : "n"} defaultValue={q ? CATS : ["Echipamente"]} className="px-3 pb-3">
          {CATS.map((c) => {
            const items = list.filter((s) => s.category === c);
            if (!items.length) return null;
            return (
              <AccordionItem key={c} value={c}>
                <AccordionTrigger className="py-2.5 text-[11px] font-medium uppercase tracking-wider text-primary hover:no-underline">
                  {c} <span className="ml-auto mr-2 font-mono text-muted-foreground">{items.length}</span>
                </AccordionTrigger>
                <AccordionContent>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map((s) => {
                    const scale = Math.min(40 / s.w, 40 / s.h, 1);
                    return (
                      <button
                        key={s.type}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("application/pid-symbol", s.type)}
                        onDoubleClick={() => addNode(s.type, 500, 200)}
                        title={`${s.name}${s.code ? ` (${s.code})` : ""} – trage pe planșă`}
                        className="flex cursor-grab flex-col items-center gap-1 rounded-md border bg-card p-2 text-center transition-colors hover:border-primary active:cursor-grabbing"
                      >
                        <svg width={44} height={44} viewBox="0 0 44 44" style={{ color: "var(--canvas-ink)" }}>
                          <g transform={`translate(${22 - (s.w * scale) / 2},${22 - (s.h * scale) / 2}) scale(${scale})`}>{s.render()}</g>
                        </svg>
                        <span className="text-[10px] leading-tight text-muted-foreground">
                          {s.code && <span className="mr-1 font-mono text-primary">{s.code}</span>}{s.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </ScrollArea>
    </div>
  );
}
