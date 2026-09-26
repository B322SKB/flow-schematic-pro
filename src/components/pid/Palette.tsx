import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SYMBOL_LIST } from "@/lib/pid/symbols";
import { usePid } from "@/lib/pid/store";

const CATS = ["Echipamente", "Pompe", "Vane", "Instrumentație", "Fitinguri"] as const;

export function Palette() {
  const [q, setQ] = useState("");
  const addNode = usePid((s) => s.addNode);
  const list = SYMBOL_LIST.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex h-full flex-col border-r bg-sidebar">
      <div className="border-b p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bibliotecă ISA-5.1</div>
        <Input placeholder="Caută simbol…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          {CATS.map((c) => {
            const items = list.filter((s) => s.category === c);
            if (!items.length) return null;
            return (
              <div key={c}>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-primary">{c}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map((s) => {
                    const scale = Math.min(40 / s.w, 40 / s.h, 1);
                    return (
                      <button
                        key={s.type}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("application/pid-symbol", s.type)}
                        onDoubleClick={() => addNode(s.type as never, 500, 200)}
                        title={`${s.name} – trage pe planșă`}
                        className="flex cursor-grab flex-col items-center gap-1 rounded-md border bg-card p-2 text-center transition-colors hover:border-primary active:cursor-grabbing"
                      >
                        <svg width={44} height={44} viewBox="0 0 44 44" style={{ color: "var(--canvas-ink)" }}>
                          <g transform={`translate(${22 - (s.w * scale) / 2},${22 - (s.h * scale) / 2}) scale(${scale})`}>{s.render()}</g>
                        </svg>
                        <span className="text-[10px] leading-tight text-muted-foreground">{s.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
