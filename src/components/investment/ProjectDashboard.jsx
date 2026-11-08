import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@core/components/ui/card';
import { Badge } from '@core/components/ui/badge';
import { FileSignature } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const CONTRACT_STATUS_LABELS = {
  draft: 'Entwurf',
  pending: 'Ausstehend',
  signed: 'Unterzeichnet',
  active: 'Aktiv',
  in_negotiation: 'In Verhandlung',
  completed: 'Abgeschlossen',
  terminated: 'Beendet',
  cancelled: 'Storniert'
};

export default function ProjectDashboard({ contracts, user }) {
  if (!contracts || contracts.length === 0) {
    return (
      <div className="text-center py-16">
        <FileSignature className="w-16 h-16 text-slate-300 mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-slate-600">Keine aktiven Projekte</h3>
        <p className="text-slate-500 mt-2">Ihre unterzeichneten Projektverträge erscheinen hier.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CardHeader className="px-0">
        <CardTitle>Meine aktiven Projekte</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {contracts.map(contract => (
          <Card key={contract.id} className="border-0 shadow-lg">
            <CardHeader>
              <div className="flex justify-between items-start">
                <CardTitle className="text-lg">Projektvertrag #{contract.id.slice(0, 6)}</CardTitle>
                <Badge>{CONTRACT_STATUS_LABELS[contract.status] || contract.status}</Badge>
              </div>
              <p className="text-sm text-slate-500">
                Startdatum: {format(new Date(contract.start_date), 'PPP', { locale: de })}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 112-01 review (rule 8): the fixed "Beteiligte" row (landowner, developer, architect on every card) is gone
                  for the same reason as the 30 % bar - the record names no parties, so the row stated roles nobody entered. */}
              <div>
                <h4 className="font-semibold text-sm mb-2">Gesamtprojektwert</h4>
                <p className="text-xl font-bold">{contract.contract_value.toLocaleString("de-DE")} €</p>
              </div>
              {/* 112-01: the fixed "Projektfortschritt 30 %" bar is gone — a ProjectContract record has no progress
                  field and nothing computes one; a made-up bar on a contract card reads like a reported figure. */}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}