// Stocare în memorie pentru testele store-ului (persist Zustand) în mediul Node.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return mem.size; },
  clear: () => mem.clear(),
  getItem: (k: string) => mem.get(k) ?? null,
  key: (i: number) => [...mem.keys()][i] ?? null,
  removeItem: (k: string) => void mem.delete(k),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
};
