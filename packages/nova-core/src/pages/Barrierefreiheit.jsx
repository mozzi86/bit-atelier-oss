// Route /barrierefreiheit (93-02): the accessibility statement. Public like the other
// legal pages (@core/lib/oeffentlicheWege.js), same shell, text from rechtstexte.jsx.

import React from 'react';
import RechtsSeite from './RechtsSeite.jsx';
import { BarrierefreiheitText } from '../lib/rechtstexte.jsx';

export default function Barrierefreiheit() {
  return (
    <RechtsSeite titel="Erklärung zur Barrierefreiheit">
      <BarrierefreiheitText />
    </RechtsSeite>
  );
}
