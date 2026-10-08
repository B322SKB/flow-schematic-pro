// Căutare obiecte după tag, tip, circuit, material, DN și alte proprietăți. Termenii se combină (AND).
import { CIRCUITS, getMaterial } from "./catalog";
import { getSymbol } from "./symbols";
import type { Scheme } from "./types";

export interface SearchHit { kind: "node" | "pipe"; id: string; tag: string; label: string; score: number }

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Termeni acceptați: text liber (tag, nume tip, cod), `dn100` / `dn:100`, `material:inox`,
 * `circuit:tur`, `type:valve`, `pipes`, `equipment`, `valves`. Rezultatele sunt sortate după relevanță.
 */
export function searchObjects(s: Scheme, query: string): SearchHit[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out: SearchHit[] = [];
  const matchTerm = (t: string, f: { tag: string; text: string; dn?: number | undefined; kind: "node" | "pipe"; cat: string; circuit?: string; material?: string }) => {
    const m = /^dn:?(\d+)$/.exec(t);
    if (m) return f.dn === Number(m[1]) ? 3 : 0;
    const [k, v] = t.includes(":") ? t.split(":", 2) as [string, string] : ["", t];
    if (k === "material") return f.material && norm(f.material).includes(v) ? 2 : 0;
    if (k === "circuit") return f.circuit && norm(f.circuit).includes(v) ? 2 : 0;
    if (k === "type" || k === "tip") return norm(f.text).includes(v) || norm(f.cat).includes(v) ? 2 : 0;
    if (["pipes", "pipe", "conducte", "conducta"].includes(t)) return f.kind === "pipe" ? 1 : 0;
    if (["equipment", "echipamente"].includes(t)) return f.cat === "Echipamente" || f.cat === "Pompe" ? 1 : 0;
    if (["valves", "vane"].includes(t)) return f.cat === "Vane" ? 1 : 0;
    const tag = norm(f.tag);
    if (tag === t) return 10;
    if (tag.startsWith(t)) return 6;
    if (tag.includes(t)) return 4;
    return norm(f.text).includes(t) ? 2 : 0;
  };
  for (const n of s.nodes) {
    const sym = getSymbol(n.type);
    const f = { tag: n.tag, text: `${sym.name} ${sym.code ?? ""} ${n.type} ${n.note ?? ""}`, dn: n.dn, kind: "node" as const, cat: sym.category };
    let sc = 0, ok = true;
    for (const t of terms) { const v = matchTerm(t, f); if (!v) { ok = false; break; } sc += v; }
    if (ok) out.push({ kind: "node", id: n.id, tag: n.tag, label: `${n.tag} · ${sym.name}`, score: sc });
  }
  for (const p of s.pipes) {
    const mat = getMaterial(p.material);
    const f = { tag: p.tag, text: `conducta pipe ${CIRCUITS[p.circuit].name} ${mat.short}`, dn: p.dn, kind: "pipe" as const, cat: "Conducte",
      circuit: `${p.circuit} ${CIRCUITS[p.circuit].name}`, material: `${p.material} ${mat.name}` };
    let sc = 0, ok = true;
    for (const t of terms) { const v = matchTerm(t, f); if (!v) { ok = false; break; } sc += v; }
    if (ok) out.push({ kind: "pipe", id: p.id, tag: p.tag, label: `${p.tag} · DN${p.dn} · ${CIRCUITS[p.circuit].name}`, score: sc });
  }
  return out.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
}
