<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- P&ID domain logic lives in src/lib/pid (catalog, fluids, hydraulics, bom, symbols, zustand store persisted to localStorage) — keeps calculations UI-independent and testable.
- Editor route renders client-only after mount — the persisted store and SVG canvas depend on browser state.
- Power totals (sensible/required/supplied) live in src/lib/pid/power.ts — one source for header, PDF and inspector.
