import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Skeleton } from "@core/components/ui/skeleton";
import { Mail, Phone, Building, Pencil, Users } from "lucide-react";
import { CATEGORY_LABELS, labelFor } from "./labels";

const categoryColors = {
  client: "bg-emerald-100 text-emerald-800",
  engineer: "bg-blue-100 text-blue-800",
  consultant: "bg-purple-100 text-purple-800",
  manufacturer: "bg-amber-100 text-amber-800",
  contractor: "bg-orange-100 text-orange-800",
  internal: "bg-slate-100 text-slate-800",
};

const initials = (name = "") =>
  name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

export default function ContactList({ contacts = [], isLoading, onEdit }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-16 text-center text-slate-500">
          <Users className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          Keine Kontakte gefunden.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {contacts.map((contact, i) => (
        <motion.div
          key={contact.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03 }}
        >
          <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow h-full">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-sm">
                    {initials(contact.name)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800 leading-tight">
                      {contact.name}
                    </h3>
                    {contact.role && (
                      <p className="text-xs text-slate-500">{contact.role}</p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit?.(contact)}
                  aria-label={`Kontakt ${contact.name} bearbeiten`}
                  className="text-slate-400 hover:text-blue-600"
                >
                  <Pencil className="w-4 h-4" />
                </Button>
              </div>

              {contact.category && (
                <Badge className={categoryColors[contact.category] || categoryColors.internal}>
                  {labelFor(CATEGORY_LABELS, contact.category)}
                </Badge>
              )}

              <div className="space-y-1.5 text-sm text-slate-600">
                {contact.company && (
                  <div className="flex items-center gap-2">
                    <Building className="w-4 h-4 text-slate-400" />
                    <span className="truncate">{contact.company}</span>
                  </div>
                )}
                {contact.email && (
                  <a
                    href={`mailto:${contact.email}`}
                    className="flex items-center gap-2 hover:text-blue-600"
                  >
                    <Mail className="w-4 h-4 text-slate-400" />
                    <span className="truncate">{contact.email}</span>
                  </a>
                )}
                {contact.phone && (
                  <a
                    href={`tel:${contact.phone}`}
                    className="flex items-center gap-2 hover:text-blue-600"
                  >
                    <Phone className="w-4 h-4 text-slate-400" />
                    <span>{contact.phone}</span>
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
