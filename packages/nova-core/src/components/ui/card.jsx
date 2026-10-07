import * as React from "react";
import { cn } from "@core/lib/utils";

const Card = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-xl border bg-card text-card-foreground shadow",
      className
    )}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

/**
 * @typedef {React.HTMLAttributes<HTMLElement> & { as?: string }} CardTitleProps
 */

/**
 * Title of a card. Renders an h3 by default (72-15, N-16), so card titles show up
 * in the heading outline of screen readers; as a div, no card title was
 * reachable by heading navigation. Tailwind's preflight resets h3 to
 * inherited size and weight, so the look is unchanged.
 * Use `as` where a heading is not allowed, e.g. `as="span"` inside a button
 * (phrasing content only).
 * Props: every HTML attribute plus optional `as` (element name, default "h3").
 */
const CardTitle = React.forwardRef(
  /**
   * @param {CardTitleProps} props
   * @param {React.ForwardedRef<HTMLElement>} ref
   */
  ({ className, as = "h3", ...props }, ref) =>
    // createElement instead of JSX: with a string-typed tag variable in JSX, tsc
    // rejects every prop ("not assignable to IntrinsicAttributes").
    React.createElement(as, {
      ref,
      className: cn("font-semibold leading-none tracking-tight", className),
      ...props,
    })
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
