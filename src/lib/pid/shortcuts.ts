// Scurtături de tastatură: mapare tastă → comandă și protecția câmpurilor editabile.

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** True dacă focusul este într-un câmp editabil (input, textarea, select, contenteditable, combobox). */
export function isEditableTarget(t: { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null | undefined) {
  if (!t) return false;
  const tag = (t.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  const role = t.getAttribute?.("role");
  return role === "combobox" || role === "textbox" || role === "searchbox";
}

export const SHORTCUTS: { keys: string; command: string; label: string }[] = [
  { keys: "Mod+Z", command: "undo", label: "Undo" },
  { keys: "Mod+Y / Mod+Shift+Z", command: "redo", label: "Redo" },
  { keys: "Mod+C", command: "copy", label: "Copiază" },
  { keys: "Mod+V", command: "paste", label: "Lipește" },
  { keys: "Mod+D", command: "duplicate", label: "Duplică" },
  { keys: "Mod+A", command: "select-all", label: "Selectează tot" },
  { keys: "Mod+F", command: "find", label: "Caută" },
  { keys: "Mod+K", command: "command-bar", label: "Command bar" },
  { keys: "Delete", command: "delete", label: "Șterge selecția" },
  { keys: "Esc", command: "cancel", label: "Anulează / golește selecția" },
  { keys: "Space", command: "repeat", label: "Repetă ultima comandă" },
  { keys: "Home", command: "zoom-fit", label: "Zoom Fit" },
  { keys: "G", command: "zoom-selection", label: "Zoom la selecție (sau Fit)" },
  { keys: "F3", command: "toggle-osnap", label: "OSNAP" },
  { keys: "F7", command: "toggle-grid", label: "GRID" },
  { keys: "F8", command: "toggle-ortho", label: "ORTHO" },
];

/** Mapare eveniment → id comandă (null dacă nu e scurtătură globală). */
export function matchShortcut(e: KeyLike): string | null {
  const mod = !!(e.ctrlKey || e.metaKey);
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod) {
    if (k === "z") return e.shiftKey ? "redo" : "undo";
    if (k === "y") return "redo";
    if (k === "c") return "copy";
    if (k === "v") return "paste";
    if (k === "d") return "duplicate";
    if (k === "a") return "select-all";
    if (k === "f") return "find";
    if (k === "k") return "command-bar";
    return null;
  }
  if (e.altKey) return null;
  switch (k) {
    case "Delete": case "Backspace": return "delete";
    case "Escape": return "cancel";
    case " ": return "repeat";
    case "Home": return "zoom-fit";
    case "g": return "zoom-selection";
    case "F3": return "toggle-osnap";
    case "F7": return "toggle-grid";
    case "F8": return "toggle-ortho";
    default: return null;
  }
}

/** Scurtăturile care funcționează și cu focus într-un câmp (doar cele care nu afectează textul). */
export const ALLOWED_IN_INPUT = new Set(["command-bar", "find"]);
