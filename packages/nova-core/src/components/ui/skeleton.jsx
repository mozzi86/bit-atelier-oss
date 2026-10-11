import { cn } from "@core/lib/utils";

/** @param {React.HTMLAttributes<HTMLDivElement>} props */
function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
      {...props}
    />
  );
}

export { Skeleton };
