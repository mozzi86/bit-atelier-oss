import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { PanelLeft } from "lucide-react";
import { cn } from "@core/lib/utils";
import { useIsMobile } from "@core/hooks/use-mobile";
import { useI18n } from "@core/lib/i18n";

// Lightweight, self-contained sidebar. Provides the subset of the shadcn
// sidebar API used by Layout.jsx. On desktop the sidebar is a static column;
// on mobile it becomes an overlay drawer toggled by SidebarTrigger.
//
// 72-10 (N-06): the closed drawer is inert (its links used to stay in the tab
// order while pushed off screen), Escape closes it and returns focus to the
// trigger, opening focuses its first link, and a click on any link inside
// closes it. The trigger reports aria-expanded/aria-controls.

/** id of the mobile drawer, referenced by the trigger's aria-controls. */
export const SIDEBAR_MOBIL_ID = "hauptnavigation-mobil";

const SidebarContext = React.createContext(null);

export function useSidebar() {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within a SidebarProvider");
  return ctx;
}

export function SidebarProvider({ children }) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);
  // Where focus returns when Escape closes the drawer.
  const triggerRef = React.useRef(/** @type {HTMLButtonElement|null} */ (null));
  const [collapsed, setCollapsedState] = React.useState(() => {
    try { return localStorage.getItem("sidebar:collapsed") === "1"; } catch { return false; }
  });
  const setCollapsed = React.useCallback((v) => {
    setCollapsedState(v);
    try { localStorage.setItem("sidebar:collapsed", v ? "1" : "0"); } catch { /* ignore */ }
  }, []);
  const value = React.useMemo(
    () => ({
      isMobile,
      openMobile,
      setOpenMobile,
      collapsed: !isMobile && collapsed, // collapse only applies on desktop
      setCollapsed,
      triggerRef,
      // On mobile the trigger opens/closes the drawer; on desktop it collapses.
      toggle: () => (isMobile ? setOpenMobile((o) => !o) : setCollapsed(!collapsed)),
    }),
    [isMobile, openMobile, collapsed, setCollapsed]
  );
  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export const Sidebar = React.forwardRef(
  ({ className, children, style, ...props }, ref) => {
    const { isMobile, openMobile, setOpenMobile, collapsed, triggerRef } = useSidebar();
    const eigenerRef = React.useRef(/** @type {HTMLElement|null} */ (null));
    const setzeRef = React.useCallback((knoten) => {
      eigenerRef.current = knoten;
      if (typeof ref === "function") ref(knoten);
      else if (ref) ref.current = knoten;
    }, [ref]);

    // Open drawer: focus its first link, Escape closes and hands focus back to
    // the trigger (the element that opened it).
    React.useEffect(() => {
      if (!isMobile || !openMobile) return undefined;
      /** @type {HTMLElement|null|undefined} */ (eigenerRef.current?.querySelector("a[href]"))?.focus();
      const beiTaste = (ereignis) => {
        if (ereignis.key !== "Escape") return;
        setOpenMobile(false);
        triggerRef.current?.focus();
      };
      document.addEventListener("keydown", beiTaste);
      return () => document.removeEventListener("keydown", beiTaste);
    }, [isMobile, openMobile, setOpenMobile, triggerRef]);

    if (isMobile) {
      // React 18 does not know "inert": passed as a string attribute, through
      // a spread typed as a plain object because the React 18 types lack it.
      const inert = /** @type {object} */ (openMobile ? {} : { inert: "" });
      return (
        <>
          {openMobile && (
            <div
              aria-hidden="true"
              className="fixed inset-0 z-40 bg-black/50"
              onClick={() => setOpenMobile(false)}
            />
          )}
          <aside
            ref={setzeRef}
            id={SIDEBAR_MOBIL_ID}
            aria-hidden={openMobile ? undefined : true}
            {...inert}
            onClickCapture={(ereignis) => {
              // Any link, not only menu entries (e.g. the logo): the page
              // changes, so the drawer must not stay over it.
              if (/** @type {HTMLElement} */ (ereignis.target).closest?.("a[href]")) setOpenMobile(false);
            }}
            style={style}
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex h-full w-72 flex-col transition-transform duration-300",
              openMobile ? "translate-x-0" : "-translate-x-full",
              className
            )}
            {...props}
          >
            {children}
          </aside>
        </>
      );
    }

    return (
      <aside
        ref={ref}
        style={style}
        data-collapsed={collapsed}
        className={cn(
          "flex h-full flex-col transition-[width] duration-300",
          collapsed ? "w-16" : "w-64",
          className
        )}
        {...props}
      >
        {children}
      </aside>
    );
  }
);
Sidebar.displayName = "Sidebar";

export function SidebarTrigger({ className, ...props }) {
  const { toggle, isMobile, openMobile, collapsed, triggerRef } = useSidebar();
  const { t } = useI18n();
  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={toggle}
      aria-expanded={isMobile ? openMobile : !collapsed}
      aria-controls={isMobile ? SIDEBAR_MOBIL_ID : undefined}
      className={cn("inline-flex items-center justify-center", className)}
      {...props}
    >
      <PanelLeft aria-hidden="true" className="w-5 h-5" />
      <span className="sr-only">{t("Navigation umschalten")}</span>
    </button>
  );
}

export const SidebarHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col gap-2", className)} {...props} />
));
SidebarHeader.displayName = "SidebarHeader";

export const SidebarFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col gap-2 mt-auto", className)} {...props} />
));
SidebarFooter.displayName = "SidebarFooter";

export const SidebarContent = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-auto", className)}
    {...props}
  />
));
SidebarContent.displayName = "SidebarContent";

export const SidebarGroup = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("relative flex w-full min-w-0 flex-col", className)} {...props} />
));
SidebarGroup.displayName = "SidebarGroup";

export const SidebarGroupLabel = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex shrink-0 items-center", className)} {...props} />
));
SidebarGroupLabel.displayName = "SidebarGroupLabel";

export const SidebarGroupContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("w-full text-sm", className)} {...props} />
));
SidebarGroupContent.displayName = "SidebarGroupContent";

export const SidebarMenu = React.forwardRef(({ className, ...props }, ref) => (
  <ul ref={ref} className={cn("flex w-full min-w-0 flex-col gap-1", className)} {...props} />
));
SidebarMenu.displayName = "SidebarMenu";

export const SidebarMenuItem = React.forwardRef(({ className, ...props }, ref) => (
  <li ref={ref} className={cn("group/menu-item relative", className)} {...props} />
));
SidebarMenuItem.displayName = "SidebarMenuItem";

export const SidebarMenuButton = React.forwardRef(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const { isMobile, setOpenMobile } = useSidebar();
    return (
      <Comp
        ref={ref}
        onClick={() => {
          if (isMobile) setOpenMobile(false);
        }}
        className={cn(
          "flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none transition-colors",
          className
        )}
        {...props}
      />
    );
  }
);
SidebarMenuButton.displayName = "SidebarMenuButton";
