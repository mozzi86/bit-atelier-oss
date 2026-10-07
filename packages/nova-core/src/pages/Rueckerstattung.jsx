// Route /rueckerstattung. The refund rules are § 9 of the terms; this page
// repeats them under their own heading so "Rückerstattung" is findable
// without reading the whole contract.

import React from 'react';
import RechtsSeite from './RechtsSeite.jsx';
import { RueckerstattungText } from '../lib/rechtstexte.jsx';

export default function Rueckerstattung() {
  return (
    <RechtsSeite titel="Kündigung und Rückerstattung">
      <RueckerstattungText />
    </RechtsSeite>
  );
}
