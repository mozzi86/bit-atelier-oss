// 106-05: hands the harness functions to the speech field of the viewers (packages may not import the app).
// Imported once from src/main.jsx; the viewers read the service through @core/lib/zeigen/sprechDienst.js.
// 106-06: plus the image rules of the app's store (bild-freigabe, consent) for the "mit Bild" button.
// In:  src/lib/harnessClient.js. Out: the registered service (side effect on import).
import { sprechDienstSetzen } from '@core/lib/zeigen/sprechDienst.js';
import { stt, sprechBereitschaft, agentFrage, bildFreigabeLesen, bildZustimmen, bildZustimmungZuruecknehmen } from '@/lib/harnessClient.js';

sprechDienstSetzen({
  stt: (blob) => stt(blob), bereit: sprechBereitschaft, agent: agentFrage,
  bildFreigabe: bildFreigabeLesen, bildZustimmen, bildZuruecknehmen: bildZustimmungZuruecknehmen,
});
