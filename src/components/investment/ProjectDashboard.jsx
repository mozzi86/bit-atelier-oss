import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@core/components/ui/card';
import { Badge } from '@core/components/ui/badge';
import { Progress } from '@core/components/ui/progress';
import { FileSignature, User, Users } from 'lucide-react';
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
              <div>
                <h4 className="font-semibold text-sm mb-2">Beteiligte</h4>
                <div className="flex items-center gap-4 text-xs text-slate-600">
                  <div className="flex items-center gap-1"><User className="w-3 h-3"/>Grundstückseigentümer</div>
                  <div className="flex items-center gap-1"><Users className="w-3 h-3"/>Projektentwickler</div>
                  <div className="flex items-center gap-1"><User className="w-3 h-3"/>Architekt</div>
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-sm mb-2">Gesamtprojektwert</h4>
                <p className="text-xl font-bold">{contract.contract_value.toLocaleString("de-DE")} €</p>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Projektfortschritt</span>
                  <span className="font-semibold">30%</span>
                </div>
                <Progress value={30} className="h-2" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}