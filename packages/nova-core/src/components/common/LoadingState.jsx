import React from "react";
import { Skeleton } from "@core/components/ui/skeleton";
import { useI18n } from "@core/lib/i18n";

/**
 * Einheitlicher Ladezustand mit Skeletons (rounded-xl), passend zum Layout.
 * variant "cards" → Karten-Raster; variant "list" → Zeilen.
 * 72-12 (N-09): the grey blocks alone told a screen reader nothing. The
 * container is a named status region, busy while it is shown; the markup and
 * the props stay as they were, so no caller's layout moves.
 * @param {{ rows?: number, variant?: "cards" | "list", className?: string }} props
 *   rows: number of skeleton blocks; className: extra classes on the container
 */
export default function LoadingState({ rows = 6, variant = "cards", className = "" }) {
  const { t } = useI18n();
  const status = { role: "status", "aria-busy": true, "aria-label": t("Wird geladen") };
  if (variant === "list") {
    return (
      <div {...status} className={`space-y-2 ${className}`}>
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  return (
    <div {...status} className={`grid md:grid-cols-2 xl:grid-cols-3 gap-4 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-64 rounded-xl" />
      ))}
    </div>
  );
}
