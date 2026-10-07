// Route /impressum (57-06 Task 1c). Reachable without a session in all three
// build modes - the duty under § 5 DDG attaches to the offering, not to a form.

import React from 'react';
import RechtsSeite from './RechtsSeite.jsx';
import { ImpressumText } from '../lib/rechtstexte.jsx';

export default function Impressum() {
  return (
    <RechtsSeite titel="Impressum">
      <ImpressumText />
    </RechtsSeite>
  );
}
