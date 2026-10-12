// Besitzer: 93-03 — nur diese Datei ändern.
//
// English dictionary part of the office mode (lever 158): pairing page of a LAN device, header marker,
// "changed meanwhile" note and the card "Büro-Modus (Mehrplatz)" in Settings › System & Info.
// Existing keys ("Wird geladen …", "Widerrufen") are not repeated (duplicate guard in
// tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // header marker
  "Gerät: {name}": "Device: {name}",
  "Gekoppeltes Gerät im Büro-Modus": "Paired device in office mode",
  "Gekoppelte Geräte im Büro-Netz können diese Installation nutzen.": "Paired devices in the office network can use this installation.",
  "Büro-Modus an": "Office mode on",
  // pairing page on the device
  "Dieses Gerät koppeln": "Pair this device",
  "Am Büro-Rechner unter Einstellungen › System & Info › Büro-Modus einen Koppel-Code erzeugen und hier eingeben.": "On the office computer, create a pairing code under Settings › System & Info › Office mode and enter it here.",
  "Koppel-Code": "Pairing code",
  "Wird gekoppelt …": "Pairing …",
  "Koppeln": "Pair",
  "Die Verbindung im Büro-Netz ist nicht verschlüsselt. Nur in einem vertrauenswürdigen Netz verwenden, nie im Gäste-WLAN.": "The connection in the office network is not encrypted. Use it only in a trusted network, never on guest Wi-Fi.",
  // concurrency note
  "Dieser Eintrag wurde inzwischen an einem anderen Gerät oder Fenster geändert. Ihre Fassung ist gespeichert und hat die andere ersetzt.": "This record was changed meanwhile on another device or window. Your version was saved and replaced the other one.",
  // settings card — device view
  "Dieses Gerät abmelden? Für einen neuen Zugang braucht es einen neuen Koppel-Code vom Büro-Rechner.": "Sign this device out? Access again needs a new pairing code from the office computer.",
  "Dieses Gerät ist gekoppelt als „{name}“, gültig bis {datum}.": "This device is paired as “{name}”, valid until {datum}.",
  "Dieses Gerät abmelden": "Sign this device out",
  // settings card — host view
  "Büro-Modus (Mehrplatz)": "Office mode (multi-workstation)",
  "Büro-Modus ausschalten? Gekoppelte Geräte verlieren sofort den Zugang, bleiben aber gespeichert.": "Switch office mode off? Paired devices lose access at once but stay registered.",
  "„{name}“ widerrufen? Das Gerät verliert sofort den Zugang.": "Revoke “{name}”? The device loses access at once.",
  "Der Büro-Modus ist an. Gekoppelte Geräte im Büro-Netz können diese Installation nutzen.": "Office mode is on. Paired devices in the office network can use this installation.",
  "Der Büro-Modus ist aus. Die App ist nur auf diesem Rechner erreichbar.": "Office mode is off. The app can only be reached on this computer.",
  "Eingeschaltet erreichen ein zweiter Arbeitsplatz oder ein Tablet im selben Büro-Netz diese Installation — nur nach Kopplung mit einem Code von diesem Rechner. Personaldaten, Einstellungen des Systems, KI-Zugänge und Updates bleiben diesem Rechner vorbehalten.": "When on, a second workstation or a tablet in the same office network can reach this installation — only after pairing with a code from this computer. Personnel data, system settings, AI access keys and updates stay reserved to this computer.",
  "Die Verbindung im Netz ist nicht verschlüsselt (kein HTTPS). Wer im selben Netz mitliest, kann Projektdaten sehen. Nur in einem vertrauenswürdigen Büro-Netz einschalten, nie im Gäste- oder öffentlichen WLAN.": "The connection in the network is not encrypted (no HTTPS). Anyone listening in the same network can see project data. Switch it on only in a trusted office network, never on guest or public Wi-Fi.",
  "Ich habe verstanden: nur im vertrauenswürdigen Büro-Netz.": "Understood: trusted office network only.",
  "Büro-Modus einschalten": "Switch office mode on",
  "Adresse für das andere Gerät": "Address for the other device",
  "Keine Netzwerkadresse gebunden.": "No network address bound.",
  "Entwicklungsmodus: dieser Port liefert nur die Schnittstelle. Die Oberfläche für das Tablet gibt es nur in der installierten App (ein Port für App und Schnittstelle).": "Development mode: this port serves the API only. The interface for the tablet exists only in the installed app (one port for app and API).",
  "Die Windows-Firewall fragt beim ersten Mal, ob Node.js im privaten Netz erreichbar sein darf — nur „Private Netzwerke“ erlauben.": "The first time, Windows Firewall asks whether Node.js may be reached in the private network — allow “Private networks” only.",
  "Gerät koppeln": "Pair a device",
  "z. B. Tablet Baustelle": "e.g. site tablet",
  "Code erzeugen": "Create code",
  "Für „{name}“, gültig bis {zeit}, einmal verwendbar. Auf dem Gerät die Adresse oben öffnen und den Code eingeben.": "For “{name}”, valid until {zeit}, single use. Open the address above on the device and enter the code.",
  "Gekoppelte Geräte": "Paired devices",
  "noch keine": "none yet",
  "zuletzt {zuletzt} · gültig bis {bis}": "last seen {zuletzt} · valid until {bis}",
  "Büro-Modus ausschalten": "Switch office mode off",
};
