import { useCallback, useState } from "react";

// Session-Cache für Panel-Eingaben (HI-01): Radix-TabsContent unmountet
// inaktive Tabs — lokaler useState geht dabei verloren. usePanelState ist ein
// useState-Drop-in, das den letzten Wert zusätzlich in einer modulweiten Map
// (keyed "panelName:field") hält. Eingaben überleben so den Tab-Wechsel
// innerhalb der Session; KEIN DB-Write, kein Persistieren über Reloads.
const panelCache = new Map();

export function usePanelState(key, initialValue) {
  const [value, setValue] = useState(() =>
    panelCache.has(key)
      ? panelCache.get(key)
      : typeof initialValue === "function"
        ? initialValue()
        : initialValue,
  );

  const set = useCallback(
    (next) => {
      setValue((prev) => {
        const v = typeof next === "function" ? next(prev) : next;
        panelCache.set(key, v);
        return v;
      });
    },
    [key],
  );

  return [value, set];
}

// Nur für Tests/Projektwechsel-Szenarien gedacht.
export function clearPanelState(prefix) {
  for (const k of panelCache.keys()) {
    if (!prefix || k.startsWith(prefix)) panelCache.delete(k);
  }
}
