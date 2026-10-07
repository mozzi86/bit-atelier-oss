// Route /cookies. The app sets no cookies; the page lists every browser
// storage key instead, so a visitor can verify the claim in DevTools.

import React from 'react';
import RechtsSeite from './RechtsSeite.jsx';
import { CookieRichtlinieText } from '../lib/rechtstexte.jsx';

export default function Cookies() {
  return (
    <RechtsSeite titel="Cookie-Richtlinie">
      <CookieRichtlinieText />
    </RechtsSeite>
  );
}
