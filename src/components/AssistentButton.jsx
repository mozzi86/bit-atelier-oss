import React from "react";
import { Bot } from "lucide-react";

/**
 * Floating button that opens the AI assistant (Redesign 2026-11: flat, 44 px,
 * primary colour — replaces the ornate "Alhambra" brooch).
 *
 * @param {{ label?: string, onClick?: () => void }} props
 *   label: accessible name and tooltip; onClick: opens the assistant.
 */
export default function AssistentButton({ label = "KI-Assistent", onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid="assistent-fab"
      className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Bot aria-hidden="true" className="h-5 w-5" />
    </button>
  );
}
