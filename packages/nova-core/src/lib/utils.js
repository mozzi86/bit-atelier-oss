import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


export const isIframe = window.self !== window.top;

// Einheitliche Wurzel aller Modul-Seiten. Bewusst eine Konstante und KEINE
// @apply-Klasse: die Dark-Mode-Overrides in index.css haengen an den
// Utility-KLASSEN (.dark .from-slate-50 ...) — einkompilierte Deklarationen
// wuerden sie verfehlen und Dark Mode auf allen Seiten brechen.
export const seitenWurzel =
  "min-h-full bg-gradient-to-br from-slate-50 via-emerald-50/20 to-blue-50/30 p-6";
