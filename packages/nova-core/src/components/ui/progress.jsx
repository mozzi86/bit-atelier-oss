import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@core/lib/utils";

/**
 * Progress bar (Radix Progress). `value` in percent, 0–100.
 * @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & React.RefAttributes<HTMLDivElement>>}
 */
const Progress = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>} props
   * @param {React.ForwardedRef<HTMLDivElement>} ref
   */
  ({ className, value, ...props }, ref) => {
    // The value used to stop here, so Radix rendered every bar as "indeterminate"
    // without aria-valuenow (A11Y-I18N-14). Radix drops (and logs) any value outside
    // 0…max, so clamp; numeric strings from the data count as numbers, as they did
    // for the bar width before. No number at all → indeterminate, drawn empty.
    const roh = /** @type {unknown} */ (value);
    const zahl = roh === null || roh === undefined || roh === "" ? NaN : Number(roh);
    const prozent = Number.isFinite(zahl) ? Math.min(100, Math.max(0, zahl)) : null;
    return (
      <ProgressPrimitive.Root
        ref={ref}
        value={prozent}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
          className
        )}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className="h-full w-full flex-1 bg-primary transition-all"
          style={{ transform: `translateX(-${100 - (prozent ?? 0)}%)` }}
        />
      </ProgressPrimitive.Root>
    );
  }
);
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
