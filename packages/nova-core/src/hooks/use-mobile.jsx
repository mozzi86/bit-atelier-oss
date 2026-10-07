import * as React from "react"

const MOBILE_BREAKPOINT = 768

const istSchmal = () =>
  typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT

/*
 * Entscheidet, ob die Seitenleiste als Schublade (mobil) oder angedockt
 * (Desktop) laeuft. Drei Dinge, die hier schon schiefgegangen sind:
 *
 * 1. Startwert synchron. Mit useState(undefined) war die erste Darstellung
 *    IMMER Desktop und wurde erst im Effekt korrigiert — auf dem Handy also
 *    ein Aufblitzen der 256-px-Leiste vor der Schublade.
 * 2. Auf resize UND auf den Media-Query hoeren. Verlaesst man sich allein auf
 *    das change-Ereignis der MediaQueryList, bleibt der Modus in Umgebungen
 *    stehen, die es nicht feuern (Geraeteemulation ueber die Entwicklerwerkzeuge,
 *    eingebettete WebViews). Gemessen: Fenster von 1440 auf 390 px verkleinert,
 *    matchMedia meldete bereits true, die Leiste blieb angedockt und quetschte
 *    den Inhalt auf 134 px. resize feuert jede Umgebung.
 * 3. Aeltere Safari (< 14) kennen addEventListener an der MediaQueryList nicht,
 *    nur addListener — dieselbe Browsergeneration, fuer die auch der
 *    dvh-Rueckfall in index.css noetig ist.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(istSchmal)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(istSchmal())

    window.addEventListener("resize", onChange)
    if (mql.addEventListener) mql.addEventListener("change", onChange)
    else mql.addListener(onChange)

    onChange()   // Stand nachziehen, falls sich die Breite vor dem Effekt geaendert hat

    return () => {
      window.removeEventListener("resize", onChange)
      if (mql.removeEventListener) mql.removeEventListener("change", onChange)
      else mql.removeListener(onChange)
    }
  }, [])

  return isMobile
}
