// 70-06 (register Nr. 50): is this device online? navigator.onLine plus the online/offline events. A true
// value only means "a network is connected", not "the internet answers" — good enough to mark the modules
// that need it; the modules themselves keep their own error handling.
//
// In:  nothing. Out: boolean (re-renders on change). Server render / tests without window: true.
import { useSyncExternalStore } from "react";

const abonnieren = (f) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", f);
  window.addEventListener("offline", f);
  return () => { window.removeEventListener("online", f); window.removeEventListener("offline", f); };
};
const lesen = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/** @returns {boolean} */
export function useOnline() {
  return useSyncExternalStore(abonnieren, lesen, () => true);
}

/**
 * Hint text for a module's network need while offline (null when nothing to say).
 * @param {"teilweise"|"noetig"|undefined} netz nav entry field
 * @param {boolean} online
 * @returns {string|null} German UI string (callers pass it through t())
 */
export function netzHinweis(netz, online) {
  if (online || !netz) return null;
  return netz === "noetig" ? "Braucht eine Internetverbindung" : "Teilweise offline nutzbar";
}
