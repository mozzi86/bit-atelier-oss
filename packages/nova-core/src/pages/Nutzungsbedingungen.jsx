// Route /nutzungsbedingungen. Reachable without a session in all three build
// modes, like the imprint: terms that only a logged-in user can read cannot
// have been accepted before the login.

import React from 'react';
import RechtsSeite from './RechtsSeite.jsx';
import { NutzungsbedingungenText } from '../lib/rechtstexte.jsx';

export default function Nutzungsbedingungen() {
  return (
    <RechtsSeite titel="Nutzungsbedingungen">
      <NutzungsbedingungenText />
    </RechtsSeite>
  );
}
