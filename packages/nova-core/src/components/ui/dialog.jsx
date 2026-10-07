// Dialog building blocks (shadcn pattern) over the installed @radix-ui/react-dialog
// (72-11, N-07). Radix brings what a hand-made modal lacks: role=dialog with the
// title as accessible name, focus trapped inside, Escape, focus return, the rest
// of the page hidden from screen readers (aria-hidden) and scroll locked.
//
// In:  the Radix props of each part, plus `showCloseButton` on DialogContent.
// Out: the parts, styled like the app's form dialogs (rounded, white, dark-mode
//      aware), rendered in a portal on document.body.
//
// The overlay and the content carry data-slot attributes (shadcn v4 convention);
// FormModal uses data-slot="dialog-overlay" to tell a click on the backdrop from a
// click on some other layer outside the content.

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@core/lib/utils";
import { useI18n } from "@core/lib/i18n";

/** Dialog root (Radix Root): holds the open state; `open` + `onOpenChange` make it controlled. */
const Dialog = DialogPrimitive.Root;

/** Button that opens the dialog and gets the focus back when it closes (Radix Trigger). */
const DialogTrigger = DialogPrimitive.Trigger;

/** Portal on document.body (Radix Portal); keeps the dialog above every page stacking context. */
const DialogPortal = DialogPrimitive.Portal;

/** Closes the dialog on click (Radix Close); an onClick that calls preventDefault keeps it open. */
const DialogClose = DialogPrimitive.Close;

/**
 * Dimmed, blurred backdrop behind the dialog (z-50, like the former FormModal backdrop).
 * @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & React.RefAttributes<HTMLDivElement>>}
 */
const DialogOverlay = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>} props
   * @param {React.ForwardedRef<HTMLDivElement>} ref
   */
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
);
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * The dialog panel with overlay and portal. Centred, at most 32 rem wide by default
 * (override with className, e.g. max-w-2xl), 1 rem margin to the viewport edges.
 * `showCloseButton` (default true) adds an X in the top right corner that closes
 * through Radix; set it to false when the caller renders its own close control.
 * @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { showCloseButton?: boolean } & React.RefAttributes<HTMLDivElement>>}
 */
const DialogContent = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }} props
   * @param {React.ForwardedRef<HTMLDivElement>} ref
   */
  ({ className, children, showCloseButton = true, ...props }, ref) => {
    const { t } = useI18n();
    return (
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          data-slot="dialog-content"
          className={cn(
            "fixed left-[50%] top-[50%] z-50 w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl outline-none duration-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
            className
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              aria-label={t("Dialog schließen")}
              className="absolute right-4 top-4 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  }
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

/**
 * Dialog heading; Radix links it to the content via aria-labelledby, so it is the
 * dialog's accessible name. Every DialogContent needs one (Radix warns otherwise).
 * @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> & React.RefAttributes<HTMLHeadingElement>>}
 */
const DialogTitle = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>} props
   * @param {React.ForwardedRef<HTMLHeadingElement>} ref
   */
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-lg font-semibold text-slate-800 dark:text-slate-100", className)}
      {...props}
    />
  )
);
DialogTitle.displayName = DialogPrimitive.Title.displayName;

/**
 * Optional description; Radix links it via aria-describedby. Without one, pass
 * aria-describedby={undefined} to DialogContent to silence the Radix warning.
 * @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description> & React.RefAttributes<HTMLParagraphElement>>}
 */
const DialogDescription = React.forwardRef(
  /**
   * @param {React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>} props
   * @param {React.ForwardedRef<HTMLParagraphElement>} ref
   */
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-sm text-slate-500 dark:text-slate-400", className)}
      {...props}
    />
  )
);
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
};
