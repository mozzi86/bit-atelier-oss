// Route /datenschutz (57-06 Task 1c). Reachable without a session, like the
// imprint: Art. 13 GDPR wants the information at the time of collection, and
// collection starts with the first request for the page.

import React from 'react';
import RechtsSeite from './RechtsSeite.jsx';
import { DatenschutzText } from '../lib/rechtstexte.jsx';

export default function Datenschutz() {
  return (
    <RechtsSeite titel="Datenschutzerklärung">
      <DatenschutzText />
    </RechtsSeite>
  );
}
