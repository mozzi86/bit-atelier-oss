import { Toaster as Sonner } from "sonner";
import { useTheme } from "@core/components/theme/ThemeProvider";
import { useI18n } from "@core/lib/i18n";

// Thin wrapper around sonner so existing `import { Toaster } from "@core/components/ui/toaster"`
// keeps working. Call `toast(...)` from "sonner" anywhere to show notifications.
//
// 72-12 (N-09): sonner's own texts are English ("Notifications", "Close toast")
// and its theme defaults to light, so toasts stayed white in dark mode.
// Theme is the RESOLVED one from the app's ThemeProvider (src/main.jsx): the
// stored choice may be "system", which sonner does not understand, so
// resolvedTheme (OS preference already folded in) is what must be passed —
// the raw `theme` left toasts light on a dark system. The Toaster sits in
// App.jsx, outside the I18nProvider of the Layout, so t() yields the German
// key for now; once the provider moves up, the labels follow the language.
// sonner appends its hotkey to the region label ("Benachrichtigungen alt+T").
// 6 s instead of sonner's 4 s: several save messages are a full sentence.
/** Default display time of a toast in milliseconds. */
const DAUER_MS = 6000;

/**
 * App-wide toast region.
 * @param {import("sonner").ToasterProps} props passed through to sonner, they win over the defaults
 */
export function Toaster(props) {
  const { resolvedTheme } = useTheme();
  const { t } = useI18n();
  return (
    <Sonner
      richColors
      position="top-right"
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      duration={DAUER_MS}
      containerAriaLabel={t("Benachrichtigungen")}
      toastOptions={{ closeButtonAriaLabel: t("Meldung schließen") }}
      {...props}
    />
  );
}
