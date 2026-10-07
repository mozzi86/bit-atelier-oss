// Alert dialog building blocks (shadcn pattern) over the installed
// @radix-ui/react-alert-dialog (80-01, D-P80-14; no new dependency). Same look as
// ./dialog.jsx. Radix brings what a confirmation needs: role=alertdialog with the
// title as accessible name, focus trapped inside, the initial focus on "Cancel",
// Escape = cancel, no close on a click outside, the rest of the page hidden from
// screen readers.
//
// In:  the Radix props of each part. Out: the parts, rendered in a portal on
//      document.body. The only consumer so far is @core/lib/useBestaetigung.jsx.

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from "@core/lib/utils";

/** Root (Radix): holds the open state; `open` + `onOpenChange` make it controlled. */
const AlertDialog = AlertDialogPrimitive.Root;

/** Portal on document.body (Radix Portal). */
const AlertDialogPortal = AlertDialogPrimitive.Portal;

/**
 * Dimmed backdrop (z-50, like DialogOverlay). A click on it does NOT close an alert dialog.
 * @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay> & React.RefAttributes<HTMLDivElement>>}
 */
const AlertDialogOverlay = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>} props
   * @param {React.ForwardedRef<HTMLDivElement>} ref
   */
  ({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Overlay
      ref={ref}
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
);
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

/**
 * The dialog panel with overlay and portal: centred, at most 28 rem wide by default,
 * 1 rem margin to the viewport edges, dark-mode aware.
 * @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & React.RefAttributes<HTMLDivElement>>}
 */
const AlertDialogContent = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>} props
   * @param {React.ForwardedRef<HTMLDivElement>} ref
   */
  ({ className, children, ...props }, ref) => (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        data-slot="alert-dialog-content"
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-2rem)] max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-slate-800 shadow-2xl outline-none duration-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  )
);
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

/**
 * Heading; Radix links it via aria-labelledby, so it is the dialog's accessible name.
 * @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title> & React.RefAttributes<HTMLHeadingElement>>}
 */
const AlertDialogTitle = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>} props
   * @param {React.ForwardedRef<HTMLHeadingElement>} ref
   */
  ({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Title
      ref={ref}
      className={cn("text-base font-semibold text-slate-800 dark:text-slate-100", className)}
      {...props}
    />
  )
);
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

/**
 * Description; Radix links it via aria-describedby.
 * @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description> & React.RefAttributes<HTMLParagraphElement>>}
 */
const AlertDialogDescription = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>} props
   * @param {React.ForwardedRef<HTMLParagraphElement>} ref
   */
  ({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Description
      ref={ref}
      className={cn("text-sm text-slate-600 dark:text-slate-300", className)}
      {...props}
    />
  )
);
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

/** Class string shared by both buttons: size, focus ring, disabled state. */
const KNOPF = "inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 disabled:pointer-events-none disabled:opacity-50";

/**
 * Confirming button; closes the dialog after its onClick. Default look: emerald;
 * pass a className (e.g. red for a dangerous action) to override.
 * @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & React.RefAttributes<HTMLButtonElement>>}
 */
const AlertDialogAction = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>} props
   * @param {React.ForwardedRef<HTMLButtonElement>} ref
   */
  ({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Action
      ref={ref}
      className={cn(KNOPF, "bg-emerald-700 text-white hover:bg-emerald-800", className)}
      {...props}
    />
  )
);
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

/**
 * Cancelling button; gets the initial focus (Radix) and closes the dialog.
 * @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel> & React.RefAttributes<HTMLButtonElement>>}
 */
const AlertDialogCancel = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>} props
   * @param {React.ForwardedRef<HTMLButtonElement>} ref
   */
  ({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Cancel
      ref={ref}
      className={cn(KNOPF, "border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800", className)}
      {...props}
    />
  )
);
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
