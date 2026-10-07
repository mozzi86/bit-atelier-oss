import React from "react";
import { Card, CardContent } from "@core/components/ui/card";
import { Inbox } from "lucide-react";

/**
 * Einheitlicher Leerzustand (DESIGN-SPEC): zentrierter Block, getöntes Icon-Feld,
 * freundlicher Text, optionale Aktion. Dark-fähig.
 */
export default function EmptyState({ icon: Icon = Inbox, title, description, action, className = "" }) {
  return (
    <Card className={`border-0 shadow-sm ${className}`}>
      <CardContent className="p-10 flex flex-col items-center text-center">
        <div className="p-3 rounded-xl bg-slate-100 text-slate-400 mb-3">
          <Icon className="w-8 h-8" />
        </div>
        {title && <h3 className="font-semibold text-slate-800 mb-1">{title}</h3>}
        {description && <p className="text-sm text-slate-400 max-w-md">{description}</p>}
        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  );
}
