// The single source for the imprint and the privacy notice (57-06 Task 1b).
//
// Pure presentation on purpose: no react-router import, no umgebung.js, no
// network call, no state. That is what lets the very same text render inside a
// route and inside a unit test without a DOM shell (the demo gate, which also
// rendered it outside the router, went with the demo in 83-02).
//
// 83-02 (open source): the software is MIT-licensed; the terms say so in § 10
// and no longer forbid reverse engineering or passing the software on. Imprint
// and privacy notice stay — they are the mandatory notices of the hosted cloud.
//
// All provider values come from anbieter.js - nothing here carries a literal
// name, address or number of its own.
//
// Every legal classification in here is [ASSUMED]. A lawyer has to read this
// before the first paying customer (57-06 Task 9). The markers stay in these
// comments and never in the text a visitor reads - a privacy notice hedging
// itself in front of the reader is worthless.
//
// The eleven processings below are each backed by a place in the code. When a
// service is added or dropped, this list moves with it; there is no automatic
// check that the two still agree (57-06 G-4).
//
// Since 22.09.2026 this file also holds the terms of use, the refund rules
// and the cookie policy (storage inventory) - same rule, same [ASSUMED]
// status, same single source for every route page.

import React from 'react';
import { ANBIETER, angabe } from './anbieter.js';
import { richtlinienZeilen } from './browserSpeicher.js';
import { REPO_URL } from './projektInfo.js';

/** Last editorial change. Shown to the reader, bumped by hand. */
export const RECHT_STAND = '6. Oktober 2026';

/**
 * Where the delivered licence file lives. Vite copies the repo root file into
 * every build output (vite.config.js plugin `lizenzdateien`), so the link
 * below is true in the local build, the server build and the cloud build alike. In a
 * Node unit test import.meta.env is undefined - then a root-relative link.
 */
const LIZENZ_DATEI = `${import.meta.env?.BASE_URL || '/'}THIRD-PARTY-LICENSES.md`;

/** Section heading, same rhythm in both texts. */
function Abschnitt({ titel, children }) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="text-sm font-semibold text-slate-800">{titel}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

/** One processing activity: what leaves the browser, to whom, and why. */
function Verarbeitung({ nummer, titel, empfaenger, drittland, children }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-xs font-semibold text-slate-700">
        {nummer}. {titel}
      </p>
      <div className="mt-1 space-y-1 text-[13px] leading-relaxed text-slate-600">{children}</div>
      <p className="mt-2 text-[11px] text-slate-500">
        <span className="font-medium">Empfänger:</span> {empfaenger}
        {' · '}
        <span className="font-medium">Drittland:</span> {drittland}
      </p>
    </div>
  );
}

/**
 * Imprint under § 5 DDG.
 *
 * Its § 5 DDG heading below is also the uniqueness marker for the acceptance
 * check in 57-06 Task 8 - that sentence appears exactly once in the tree, so
 * it must not be repeated in this comment.
 *
 * No chamber, no professional title, no code of conduct: the decision of
 * 19.09.2026 is that this is offered as software, not as an architect's
 * service (anbieter.js `artDesAngebots`). Should that ever flip, those three
 * become mandatory and § 2 DL-InfoV additionally demands the indemnity
 * insurer with name AND address. [ASSUMED]
 */
export function ImpressumText() {
  const firmiert =
    ANBIETER.geschaeftsbezeichnung && ANBIETER.geschaeftsbezeichnung !== ANBIETER.name;

  return (
    <div>
      <Abschnitt titel="Angaben gemäß § 5 DDG">
        <p>
          {angabe('name')}
          {firmiert ? <>, handelnd unter „{ANBIETER.geschaeftsbezeichnung}“</> : null}
          <br />
          {angabe('rechtsform')}
          <br />
          {angabe('strasse')}
          <br />
          {angabe('plz')} {angabe('ort')}
          <br />
          {ANBIETER.land}
        </p>
      </Abschnitt>

      <Abschnitt titel="Vertreten durch">
        <p>{angabe('vertretungsberechtigt')}</p>
      </Abschnitt>

      <Abschnitt titel="Kontakt">
        <p>
          Telefon: {angabe('telefon')}
          <br />
          E-Mail: {angabe('email')}
        </p>
      </Abschnitt>

      <Abschnitt titel="Umsatzsteuer-Identifikationsnummer">
        <p>Gemäß § 27 a Umsatzsteuergesetz: {angabe('ustIdNr')}</p>
      </Abschnitt>

      <Abschnitt titel="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
        <p>
          {angabe('verantwortlichMstv')}
          <br />
          Anschrift wie oben.
        </p>
      </Abschnitt>

      <Abschnitt titel="Art des Angebots">
        <p>
          BIT-Atelier wird als Softwareleistung angeboten, nicht als
          Architektenleistung. Es handelt sich um eine Plattform für private
          Bieterverfahren, GU-Vergaben und modellbasierte Preisspiegel. Sie ist{' '}
          <strong>nicht</strong> für förmliche öffentliche Vergabeverfahren nach
          VgV/UVgO geeignet und dafür nicht zertifiziert; ein Verschluss der
          Angebote gegenüber dem Betreiber der Instanz findet technisch nicht
          statt.
        </p>
      </Abschnitt>

      {ANBIETER.nurUnternehmer && (
        <Abschnitt titel="Zielgruppe und Streitbeilegung">
          <p>
            Das Angebot richtet sich ausschließlich an Unternehmer im Sinne des
            § 14 BGB und nicht an Verbraucher.
          </p>
          <p>
            Wir sind nicht bereit und nicht verpflichtet, an
            Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
            teilzunehmen (§ 36 VSBG).
          </p>
        </Abschnitt>
      )}

      <Abschnitt titel="Urheberrecht und fremde Inhalte">
        <p>
          BIT-Atelier ist freie Software unter der MIT-Lizenz; der Quellcode
          steht unter{' '}
          <a href={REPO_URL} className="underline" target="_blank" rel="noreferrer">
            {REPO_URL}
          </a>
          . Verwendete Open-Source-Komponenten mit Hinweispflichten sind in der
          Datei{' '}
          <a href={LIZENZ_DATEI} className="underline" target="_blank" rel="noreferrer">
            THIRD-PARTY-LICENSES.md
          </a>{' '}
          aufgeführt; der 2D-Constraint-Solver „planegcs“ steht unter der LGPL
          (Version 2.0 oder später, Lizenztext 2.1) und wird als eigenständige,
          austauschbare Datei ausgeliefert, der IFC-Kern „web-ifc“ unter der
          MPL 2.0.
        </p>
        <p>
          Kartendaten: © OpenStreetMap-Mitwirkende (ODbL), © Esri,
          © OpenFreeMap, © MapLibre. Höhendaten über den Dienst
          „elevation-tiles-prod“.
        </p>
        <p>
          Genannte Produkt- und Markennamen (z. B. IFC, BCF, buildingSMART,
          Archicad, Revit, Excel, DIN, STLB-Bau, GAEB) sind Marken ihrer
          jeweiligen Inhaber und werden nur zur Beschreibung von
          Kompatibilität und Schnittstellen verwendet. Es besteht keine
          Verbindung zu und keine Zertifizierung durch diese Inhaber.
        </p>
      </Abschnitt>

      <p className="mt-6 text-xs text-slate-400">Stand: {RECHT_STAND}</p>
    </div>
  );
}

/**
 * Privacy notice under Art. 13 GDPR.
 *
 * Split into "applies to every visitor" and "applies additionally once signed
 * in", because the build modes differ: the local build has neither Supabase
 * nor the edge functions, so listing them as active processing would be
 * inaccurate there.
 */
export function DatenschutzText() {
  return (
    <div>
      <Abschnitt titel="Verantwortlicher">
        <p>
          Verantwortlich für die Verarbeitung personenbezogener Daten im Sinne
          der Datenschutz-Grundverordnung ist:
        </p>
        <p>
          {angabe('name')}
          <br />
          {angabe('strasse')}, {angabe('plz')} {angabe('ort')}
          <br />
          Telefon: {angabe('telefon')} · E-Mail: {angabe('email')}
        </p>
      </Abschnitt>

      <Abschnitt titel="Datenschutzbeauftragter">
        <p>
          {ANBIETER.datenschutzbeauftragter
            ? ANBIETER.datenschutzbeauftragter
            : 'Ein Datenschutzbeauftragter ist nicht bestellt. Die gesetzlichen Voraussetzungen für eine Benennungspflicht liegen nach unserer Einschätzung nicht vor.'}
        </p>
      </Abschnitt>

      <Abschnitt titel="Welche Dienste beim Aufruf beteiligt sind">
        <p>
          Die folgende Aufstellung nennt jede Stelle, an der beim Betrieb dieser
          Anwendung Daten den Browser verlassen. Sie ist bewusst vollständig und
          nicht auf das Übliche gekürzt.
        </p>

        <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Gilt für jeden Besucher
        </p>

        <Verarbeitung
          nummer={1}
          titel="Auslieferung der Anwendung (Hosting)"
          empfaenger="Cloudflare, Inc. (USA) mit europäischen Rechenzentren; die Website bit-atelier.de: GitHub, Inc. (GitHub Pages)"
          drittland="möglich — beide Anbieter sind unter dem EU-US Data Privacy Framework zertifiziert"
        >
          <p>
            Beim Abruf der Seite werden technisch notwendige Verbindungsdaten
            verarbeitet, insbesondere IP-Adresse, Zeitpunkt, abgerufene Adresse,
            übertragene Datenmenge und Browserkennung. Ohne sie ist eine
            Auslieferung nicht möglich.
          </p>
          <p>
            Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO — berechtigtes Interesse
            am sicheren und störungsfreien Betrieb.
          </p>
        </Verarbeitung>

        <Verarbeitung
          nummer={2}
          titel="Kartendarstellung"
          empfaenger="OpenStreetMap-Stiftung, Esri, OpenFreeMap, MapLibre, Amazon Web Services"
          drittland="teilweise USA"
        >
          <p>
            Sobald eine Karte geöffnet wird, lädt Ihr Browser Kartenkacheln
            unmittelbar von fremden Servern. Dabei werden Ihre IP-Adresse und der
            ausgewählte Kartenausschnitt an diese Anbieter übertragen. Betroffen
            sind die Dienste unter <em>demotiles.maplibre.org</em>,{' '}
            <em>tile.openstreetmap.org</em>, <em>server.arcgisonline.com</em>,{' '}
            <em>tiles.openfreemap.org</em> und <em>s3.amazonaws.com</em>{' '}
            (Höhendaten).
          </p>
          <p>
            Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO — die Standortanalyse ist
            Kernfunktion der Anwendung und ohne Kartenmaterial nicht darstellbar.
            Wer das vermeiden möchte, ruft die betreffenden Bereiche nicht auf.
          </p>
        </Verarbeitung>

        <Verarbeitung
          nummer={3}
          titel="Speicherung im Browser"
          empfaenger="niemand — die Daten verbleiben auf Ihrem Gerät"
          drittland="entfällt"
        >
          <p>
            Die Anwendung legt Daten in der lokalen Datenbank Ihres Browsers
            (IndexedDB) und im lokalen Speicher (localStorage) ab: in der lokalen
            Fassung sämtliche Eingaben, im angemeldeten Betrieb Einstellungen wie
            gewählte Sprache und zuletzt geöffnetes Projekt. Ein
            Nutzungsprotokoll wird nicht geführt.
          </p>
          <p>
            Rechtsgrundlage: § 25 Abs. 2 Nr. 2 TDDDG — technisch notwendig für
            die von Ihnen genutzte Funktion.
          </p>
          <p>
            <strong>Cookies setzen wir nicht</strong> — weder eigene noch fremde,
            in keinem Betriebsmodus. Deshalb gibt es auch kein Cookie-Banner.
            Jeden einzelnen Speicherschlüssel nennt die Cookie-Richtlinie.
          </p>
        </Verarbeitung>

        <Verarbeitung
          nummer={4}
          titel="Kamera und Mikrofon (nur auf Ihre Anforderung)"
          empfaenger="niemand außerhalb Ihres Geräts bzw. Ihres eigenen Servers"
          drittland="entfällt"
        >
          <p>
            Die AR-Baustellenansicht greift erst nach Ihrer Freigabe im Browser
            auf die Kamera zu; das Bild wird nur auf Ihrem Gerät angezeigt,
            nicht gespeichert und nicht übertragen. Die Diktierfunktion des
            KI-Assistenten nimmt nach Ihrer Freigabe Audio auf und sendet es an
            den Spracherkennungsdienst der eigenen Installation (lokaler
            Harness-Server); ohne einen solchen Server ist die Funktion
            abgeschaltet. An fremde Anbieter geht kein Ton.
          </p>
          <p>Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO; Zugriff nur nach Freigabe.</p>
        </Verarbeitung>

        <Verarbeitung
          nummer={5}
          titel="Feedback und Kontakt per E-Mail oder GitHub"
          empfaenger="wir selbst (Postfach bei unserem E-Mail-Anbieter); bei „Auf GitHub melden“: GitHub, Inc. (USA)"
          drittland="E-Mail: nein · GitHub: ja — USA, unter dem EU-US Data Privacy Framework zertifiziert"
        >
          <p>
            Der Feedback-Knopf öffnet Ihr eigenes E-Mail-Programm mit einem
            vorbereiteten Text oder die Seite „Neue Meldung“ auf GitHub; die
            Anwendung selbst sendet nichts. Technische Angaben (Version, Seite,
            Browser, Betriebssystem) hängen wir nur an, wenn Sie das Häkchen
            setzen — Sie sehen sie vor dem Senden. Meldungen auf GitHub sind
            öffentlich sichtbar und unterliegen den Bedingungen von GitHub.
          </p>
          <p>
            Die Angaben verwenden wir nur zur Bearbeitung Ihrer Nachricht.
            Anfragen, aus denen kein Vertrag wird, löschen wir nach{' '}
            {ANBIETER.loeschfristAnfragenMonate} Monaten; wird ein Angebot
            daraus, gelten die handels- und steuerrechtlichen
            Aufbewahrungsfristen.
          </p>
          <p>Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO, sonst lit. f.</p>
        </Verarbeitung>

        <p className="pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Gilt zusätzlich im angemeldeten Betrieb
        </p>

        <Verarbeitung
          nummer={6}
          titel="Konten, Projektdaten und Dateien"
          empfaenger="Supabase, Inc. (USA) als Auftragsverarbeiter; Speicherung im Rechenzentrum Frankfurt am Main (AWS eu-central-1)"
          drittland="Speicherort EU; ein Zugriff des Anbieters zu Support- und Betriebszwecken aus den USA ist möglich — Standardvertragsklauseln nach Art. 46 Abs. 2 lit. c DSGVO"
        >
          <p>
            Anmeldedaten (E-Mail-Adresse, gehashtes Passwort, Anmeldezeitpunkte),
            Projekt- und Bürodaten sowie hochgeladene Dateien werden in einer
            Datenbank in Frankfurt am Main gespeichert. Der Zugriff ist auf
            Datenbankebene je Büro getrennt. Anmelde- und
            Passwort-Zurücksetzen-E-Mails versendet der Anbieter in unserem
            Auftrag. Die Sitzung wird im lokalen Speicher Ihres Browsers
            gehalten, nicht in einem Cookie.
          </p>
          <p>
            Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO — Erfüllung des
            Nutzungsvertrags. Mit dem Nutzungsvertrag schließen wir einen
            Auftragsverarbeitungsvertrag nach Art. 28 DSGVO, soweit Sie als
            Büro personenbezogene Daten Dritter (etwa Bieter oder Beteiligte)
            einstellen.
          </p>
        </Verarbeitung>

        <Verarbeitung
          nummer={7}
          titel="Sprachmodelle (KI-Funktionen)"
          empfaenger="Anthropic, OpenAI"
          drittland="ja — Vereinigte Staaten"
        >
          <p>
            Wird eine KI-Funktion benutzt, werden die dafür nötigen{' '}
            <strong>Projektdaten an den gewählten Anbieter übertragen</strong>.
            Je nach Funktion umfasst das auch Freitexte und Kontaktdaten
            beteiligter Personen, etwa von Bietern. Wer diese Funktionen nicht
            benutzt, löst keine Übertragung aus.
          </p>
          <p>
            Rechtsgrundlage: Art. 6 Abs. 1 lit. b und lit. f DSGVO. Grundlage der
            Übermittlung in die Vereinigten Staaten sind Standardvertragsklauseln
            nach Art. 46 Abs. 2 lit. c DSGVO beziehungsweise ein
            Angemessenheitsbeschluss nach Art. 45 DSGVO, soweit der Anbieter
            zertifiziert ist. Eine Kopie der Garantien ist unter der oben
            genannten Adresse erhältlich.
          </p>
          <p>
            Eine Verwendung der übermittelten Inhalte zum Training der Modelle
            findet nach den Geschäftsbedingungen der Anbieter im geschäftlichen
            Zugang nicht statt. Wir empfehlen dennoch, personenbezogene Angaben
            nur einzugeben, soweit sie für die Auswertung erforderlich sind.
            Hinterlegen Sie eigene API-Schlüssel, sind Sie selbst
            Vertragspartner des jeweiligen Anbieters.
          </p>
        </Verarbeitung>

        <Verarbeitung
          nummer={8}
          titel="Kostengruppen-Vorschläge (Urteilsmodell)"
          empfaenger="TypeSafe AI (api.typesafe.ai)"
          drittland="möglich — Standardvertragsklauseln nach Art. 46 Abs. 2 lit. c DSGVO"
        >
          <p>
            Auf Knopfdruck „KG vorschlagen“ werden Kurz- und Langtexte von
            Leistungspositionen sowie Titel- und Gewerkbezeichnungen an ein
            Urteilsmodell übertragen, das eine Kostengruppe nach DIN 276
            vorschlägt. Personenbezogene Daten sind dafür nicht erforderlich
            und werden nur übertragen, wenn sie im Positionstext stehen. Ohne
            Klick findet keine Übertragung statt.
          </p>
          <p>Rechtsgrundlage: Art. 6 Abs. 1 lit. b und lit. f DSGVO.</p>
        </Verarbeitung>

        <Verarbeitung
          nummer={9}
          titel="Wetter-, Klima- und Höhendaten"
          empfaenger="Open-Meteo"
          drittland="nach Angaben des Anbieters nein"
        >
          <p>
            Für Standortauswertungen werden Koordinaten des betrachteten
            Grundstücks an einen Wetterdienst übermittelt. Ein Personenbezug
            entsteht nur mittelbar über die IP-Adresse der abrufenden Stelle.
          </p>
          <p>Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.</p>
        </Verarbeitung>

        <Verarbeitung
          nummer={10}
          titel="Geodaten zur Umgebung"
          empfaenger="Overpass-API der OpenStreetMap-Gemeinschaft"
          drittland="nach Angaben des Anbieters nein"
        >
          <p>
            Zur Ermittlung von Nachbarbebauung und Infrastruktur werden
            Koordinaten des betrachteten Bereichs abgefragt.
          </p>
          <p>Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.</p>
        </Verarbeitung>

        <Verarbeitung
          nummer={11}
          titel="Vergabe- und Preisdaten"
          empfaenger="TED (Amt für Veröffentlichungen der Europäischen Union)"
          drittland="nein"
        >
          <p>
            Für Preisvergleiche werden Suchbegriffe an das europäische
            Vergabeportal übermittelt. Personenbezogene
            Daten werden dabei nicht übertragen, es sei denn, sie stehen im
            Suchbegriff.
          </p>
          <p>Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.</p>
        </Verarbeitung>
      </Abschnitt>

      <Abschnitt titel="Wie lange wir speichern">
        <p>
          Konto- und Projektdaten werden für die Dauer des Nutzungsvertrags
          gespeichert. Nach Vertragsende können Sie Ihre Daten 30 Tage lang
          exportieren; danach löschen wir sie auf Ihr Verlangen, spätestens
          aber nach 90 Tagen, soweit keine handels- oder steuerrechtlichen
          Aufbewahrungsfristen entgegenstehen (§§ 257 HGB, 147 AO — in der Regel
          sechs beziehungsweise zehn Jahre für Rechnungen und Geschäftsbriefe).
        </p>
        <p>
          Verbindungsdaten des Hostings werden von unserem Dienstleister nach
          dessen Fristen gelöscht. Lokal im Browser gespeicherte Daten löschen
          Sie selbst, indem Sie die Websitedaten in Ihrem Browser entfernen.
        </p>
      </Abschnitt>

      <Abschnitt titel="Ihre Rechte">
        <p>
          Sie haben das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16),
          Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und
          Datenübertragbarkeit (Art. 20). Eine erteilte Einwilligung können Sie
          jederzeit mit Wirkung für die Zukunft widerrufen (Art. 7 Abs. 3).
        </p>
        <p>
          Wenden Sie sich dafür an die oben genannte Adresse. Wir antworten ohne
          schuldhaftes Zögern, spätestens innerhalb eines Monats.
        </p>
      </Abschnitt>

      <div className="mt-6 rounded-md border-2 border-slate-300 bg-white p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-800">
          Widerspruchsrecht nach Art. 21 DSGVO
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          Soweit wir Daten auf Grundlage eines berechtigten Interesses
          verarbeiten (Art. 6 Abs. 1 lit. f DSGVO), haben Sie das Recht, aus
          Gründen, die sich aus Ihrer besonderen Situation ergeben,{' '}
          <strong>
            jederzeit Widerspruch gegen diese Verarbeitung einzulegen
          </strong>
          . Wir verarbeiten die Daten dann nicht mehr, es sei denn, wir können
          zwingende schutzwürdige Gründe nachweisen, die Ihre Interessen, Rechte
          und Freiheiten überwiegen, oder die Verarbeitung dient der
          Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          Ein Widerspruch genügt formlos an {angabe('email')}.
        </p>
      </div>

      <Abschnitt titel="Beschwerde bei einer Aufsichtsbehörde">
        <p>
          Sie können sich unabhängig davon bei einer Datenschutz-Aufsichtsbehörde
          beschweren (Art. 77 DSGVO). Zuständig ist für uns:
        </p>
        <p>{ANBIETER.aufsichtsbehoerde}</p>
      </Abschnitt>

      <Abschnitt titel="Automatisierte Entscheidungen">
        <p>
          Eine automatisierte Entscheidungsfindung einschließlich Profilbildung
          nach Art. 22 DSGVO findet nicht statt. Ergebnisse der KI-Funktionen
          sind Vorschläge zur fachlichen Prüfung und keine Entscheidungen.
        </p>
      </Abschnitt>

      <Abschnitt titel="Müssen Sie Daten bereitstellen?">
        <p>
          Für den Aufruf der Anwendung sind nur die technisch notwendigen
          Verbindungsdaten erforderlich. Für ein Nutzerkonto benötigen wir eine
          E-Mail-Adresse — ohne sie ist eine Anmeldung nicht möglich. Weitere
          Angaben sind freiwillig; werden sie nicht gemacht, stehen einzelne
          Funktionen nicht zur Verfügung.
        </p>
      </Abschnitt>

      {/* 83-02: the access-request form exists (/registrieren) — its paragraph,
          as 57-06 Task 3 reserved this place for. */}
      <Abschnitt titel="Registrierung (Zugangsanfrage)">
        <p>
          Die Seite „Registrieren“ legt kein Konto an. Sie bereitet eine E-Mail
          an {angabe('anfrageEmail')} vor, die Sie selbst aus Ihrem
          E-Mail-Programm absenden: Name, Büro oder Firma, E-Mail-Adresse,
          freiwillig Telefonnummer, Rolle und Ihre Nachricht. Diese Angaben
          verwenden wir nur, um über die Freischaltung zu entscheiden und Ihr
          Konto einzurichten; die Einladung mit dem Zugang versendet Supabase in
          unserem Auftrag (siehe Nr. 6).
        </p>
        <p>
          Wird kein Konto eingerichtet, löschen wir die Anfrage nach{' '}
          {ANBIETER.loeschfristAnfragenMonate} Monaten. Rechtsgrundlage: Art. 6
          Abs. 1 lit. b DSGVO (Anbahnung der Nutzung).
        </p>
      </Abschnitt>

      <p className="mt-6 text-xs text-slate-400">Stand: {RECHT_STAND}</p>
    </div>
  );
}

/** Numbered clause inside the terms. Same visual rhythm as Abschnitt. */
function Klausel({ nummer, titel, children }) {
  return (
    <section className="mt-5 first:mt-0">
      <h2 className="text-sm font-semibold text-slate-800">
        § {nummer} {titel}
      </h2>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
        {children}
      </ol>
    </section>
  );
}

/**
 * Cancellation and refund rules. Rendered twice: as § 9 inside the terms and
 * as its own page /rueckerstattung, so a customer looking for "refund" finds
 * the word without reading the whole contract.
 *
 * B2B only (anbieter.js `nurUnternehmer`): there is no statutory right of
 * withdrawal for entrepreneurs (§§ 312 ff. BGB address consumers), so the
 * text says so instead of copying a consumer withdrawal form that would not
 * apply. Statutory warranty rights (reduction, termination for cause) are
 * kept explicitly - excluding them would fail § 307 BGB. [ASSUMED]
 *
 * @param {{alsKlausel?: boolean}} props alsKlausel = only the <li> items, for
 *   embedding in NutzungsbedingungenText § 9
 */
export function RueckerstattungText({ alsKlausel = false }) {
  const punkte = (
    <>
      <li>
        <strong>Unentgeltliche Fassungen:</strong> Die lokale Fassung und der
        Quellcode (MIT-Lizenz) sind unentgeltlich. Es entsteht kein
        Zahlungsanspruch und damit auch kein Erstattungsanspruch.
      </li>
      <li>
        <strong>Kein gesetzliches Widerrufsrecht:</strong> Das Angebot richtet
        sich ausschließlich an Unternehmer (§ 14 BGB). Die Widerrufsrechte für
        Verbraucher (§§ 312g, 355 BGB) finden keine Anwendung.
      </li>
      <li>
        <strong>Laufende Nutzungsentgelte:</strong> Kündigt der Kunde
        ordentlich, endet die Zahlungspflicht mit dem Ende des laufenden
        Abrechnungszeitraums; bereits bezahlte Zeiträume werden nicht
        anteilig erstattet. Kündigt der Anbieter ordentlich oder stellt er den
        Dienst ein, wird ein vorausbezahltes, nicht mehr nutzbares Entgelt
        taggenau anteilig innerhalb von 14 Tagen erstattet.
      </li>
      <li>
        <strong>Projektbezogene Festpreise:</strong> Für Leistungen nach
        individuellem Angebot gelten dessen Bedingungen. Bereits erbrachte und
        abgenommene Teilleistungen werden nicht erstattet.
      </li>
      <li>
        <strong>Störungen:</strong> Ist die Cloud-Fassung aus Gründen, die der
        Anbieter zu vertreten hat, an mehr als 72 Stunden eines Monats
        zusammenhängend nicht nutzbar, mindert sich das Entgelt dieses Monats
        anteilig. Die gesetzlichen Gewährleistungsrechte, insbesondere die
        Minderung und die Kündigung aus wichtigem Grund, bleiben unberührt.
      </li>
      <li>
        <strong>Ablauf:</strong> Erstattungsanträge in Textform an{' '}
        {angabe('email')}. Wir prüfen innerhalb von 14 Tagen und erstatten per
        Überweisung auf das Konto, von dem gezahlt wurde. In der Anwendung
        selbst werden keine Zahlungsdaten erhoben; alle Zahlungen laufen über
        Angebot und Rechnung.
      </li>
    </>
  );

  if (alsKlausel) return punkte;

  return (
    <div>
      <Abschnitt titel="Kündigung und Rückerstattung">
        <p>
          Diese Regeln sind § 9 der Nutzungsbedingungen und gelten für alle
          entgeltlichen Leistungen von {angabe('geschaeftsbezeichnung')}.
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">{punkte}</ol>
      </Abschnitt>
      <Abschnitt titel="Kündigungsfristen">
        <p>
          Ohne abweichende Vereinbarung im Angebot ist der Nutzungsvertrag mit
          einer Frist von vier Wochen zum Monatsende in Textform kündbar. Nach
          Vertragsende stehen Ihre Daten 30 Tage zum Export bereit (JSON, IFC,
          BCF, GAEB, PDF).
        </p>
      </Abschnitt>
      <p className="mt-6 text-xs text-slate-400">Stand: {RECHT_STAND}</p>
    </div>
  );
}

/**
 * Terms of use (AGB) for all three build modes. Written for entrepreneurs
 * only; the consumer-facing clauses that §§ 312 ff. BGB would demand are
 * deliberately absent and the text says why.
 *
 * Liability follows the pattern the BGH accepts for standard terms: unlimited
 * for intent, gross negligence, injury to life/body/health and product
 * liability; for slight negligence only for cardinal duties and capped at the
 * typical foreseeable damage (§ 309 Nr. 7 BGB, applied to B2B via § 307).
 * Every classification is [ASSUMED] until a lawyer has read it (57-06 Task 9).
 */
export function NutzungsbedingungenText() {
  return (
    <div>
      <p className="text-sm leading-relaxed text-slate-600">
        Anbieter: {angabe('name')}, handelnd unter „{angabe('geschaeftsbezeichnung')}“,{' '}
        {angabe('strasse')}, {angabe('plz')} {angabe('ort')} (nachfolgend „Anbieter“).
        Vertragspartner ist das nutzende Unternehmen (nachfolgend „Kunde“).
      </p>

      <Klausel nummer={1} titel="Geltungsbereich">
        <li>
          Diese Bedingungen gelten für die Nutzung der Software-Plattform
          BIT-Atelier in den vom Anbieter bereitgestellten Fassungen:
          installierbare lokale Fassung und Cloud-Betrieb mit Konto. Für den
          Quellcode selbst gilt die MIT-Lizenz (§ 10).
        </li>
        {ANBIETER.nurUnternehmer && (
          <li>
            Das Angebot richtet sich ausschließlich an Unternehmer im Sinne des
            § 14 BGB, juristische Personen des öffentlichen Rechts und
            öffentlich-rechtliche Sondervermögen. Mit der Nutzung bestätigt der
            Kunde, in dieser Eigenschaft zu handeln. Verbraucher sind von der
            Nutzung ausgeschlossen.
          </li>
        )}
        <li>
          Abweichende Bedingungen des Kunden werden nicht Vertragsbestandteil,
          auch wenn der Anbieter ihnen nicht ausdrücklich widerspricht.
        </li>
      </Klausel>

      <Klausel nummer={2} titel="Leistungsgegenstand">
        <li>
          BIT-Atelier ist eine Software zur Unterstützung von Entwurf,
          Fachplanung, Ausschreibung und Vergabe, Bauausführung und Abrechnung.
          Der Anbieter erbringt eine <strong>Softwareleistung</strong>, keine
          Architekten-, Ingenieur-, Rechts- oder Steuerberatungsleistung.
        </li>
        <li>
          Mengen, Kosten, Kennwerte, Regel- und Modellprüfungen sowie Vorschläge
          der KI-Funktionen sind <strong>Arbeitshilfen</strong>. Die fachliche
          Prüfung, die Freigabe und die Verantwortung für jede darauf gestützte
          Entscheidung verbleiben beim Kunden und den von ihm beauftragten
          Fachplanern.
        </li>
        <li>
          Die Plattform ist für private Bieterverfahren, GU-Vergaben und
          modellbasierte Preisspiegel bestimmt. Sie ist <strong>nicht</strong>{' '}
          für förmliche öffentliche Vergabeverfahren nach VgV, UVgO oder VOB/A
          Abschnitte 2 und 3 geeignet und dafür nicht zertifiziert; ein
          Verschluss der Angebote gegenüber dem Betreiber der Instanz findet
          technisch nicht statt.
        </li>
        <li>
          Der Funktionsumfang entgeltlicher Leistungen ergibt sich aus dem
          jeweiligen Angebot. Unentgeltlich bereitgestellte Fassungen (lokale
          Fassung, Quellcode) können jederzeit geändert oder eingestellt werden
          und begründen keinen Anspruch auf Verfügbarkeit oder Datenerhalt.
        </li>
      </Klausel>

      <Klausel nummer={3} titel="Zugang und Konten">
        <li>
          Konten für den Cloud-Betrieb richtet der Anbieter nach einer
          Zugangsanfrage über die Seite „Registrieren“ von Hand ein. Ein
          Anspruch auf Freischaltung besteht nicht.
        </li>
        <li>
          Der Kunde hält Zugangsdaten geheim und gibt sie nur an eigene
          Mitarbeiter im vereinbarten Umfang weiter. Er informiert den Anbieter
          unverzüglich über einen Missbrauchsverdacht.
        </li>
        <li>
          Für Handlungen über sein Konto haftet der Kunde, soweit er sie zu
          vertreten hat.
        </li>
      </Klausel>

      <Klausel nummer={4} titel="Pflichten des Kunden, Inhalte">
        <li>
          Der Kunde stellt sicher, dass er an allen hochgeladenen Modellen,
          Plänen, Dokumenten und Daten die erforderlichen Rechte hält und dass
          die Eingabe personenbezogener Daten Dritter (etwa Bieter, Beteiligte,
          Bauherren) datenschutzrechtlich zulässig ist. Besondere Kategorien
          personenbezogener Daten (Art. 9 DSGVO) dürfen nicht eingestellt
          werden.
        </li>
        <li>
          Untersagt sind im Cloud-Betrieb das Einbringen von Schadsoftware,
          Angriffe auf die Verfügbarkeit und die Umgehung von
          Zugriffsbeschränkungen.
        </li>
        <li>
          Der Kunde bleibt Inhaber aller Rechte an seinen Inhalten. Er räumt
          dem Anbieter nur die Rechte ein, die für den Betrieb der Leistung
          technisch erforderlich sind. Der Anbieter nutzt Kundeninhalte nicht
          zum Training von Modellen.
        </li>
        <li>
          In der lokalen Fassung liegen alle Daten ausschließlich auf dem Gerät
          des Kunden; die Datensicherung obliegt ihm. Im Cloud-Betrieb sichert der Anbieter die Datenbank in dem im
          Angebot genannten Umfang; der Kunde exportiert seine Projektdaten
          zusätzlich in angemessenen Abständen über die Exportfunktionen.
        </li>
      </Klausel>

      <Klausel nummer={5} titel="KI-Funktionen und Dienste Dritter">
        <li>
          KI-Funktionen sind optional und werden nur auf Anforderung des Kunden
          ausgeführt. Dabei werden die in der Datenschutzerklärung genannten
          Daten an den jeweiligen Anbieter übertragen. Hinterlegt der Kunde
          eigene API-Schlüssel, ist er Vertragspartner des KI-Anbieters und
          trägt dessen Entgelte.
        </li>
        <li>
          Ergebnisse von Sprach- und Urteilsmodellen können unvollständig,
          veraltet oder falsch sein. Sie werden als Vorschlag gekennzeichnet
          und ersetzen keine fachliche Prüfung. Eine automatisierte
          Entscheidung im Sinne des Art. 22 DSGVO findet nicht statt.
        </li>
        <li>
          Karten-, Wetter-, Geo- und Vergabedaten stammen von Dritten
          (OpenStreetMap, Esri, Open-Meteo, TED u. a.). Der Anbieter schuldet
          weder deren Verfügbarkeit noch deren Richtigkeit; es gelten die
          Nutzungsbedingungen der jeweiligen Datenquelle.
        </li>
      </Klausel>

      <Klausel nummer={6} titel="Verfügbarkeit, Wartung, Weiterentwicklung">
        <li>
          Eine bestimmte Verfügbarkeit der Cloud-Fassung ist nur geschuldet,
          wenn sie im Angebot vereinbart ist. Wartungsfenster kündigt der
          Anbieter nach Möglichkeit mindestens 48 Stunden vorher in der
          Anwendung oder per E-Mail an.
        </li>
        <li>
          Der Anbieter entwickelt die Software fort und darf Funktionen ändern
          oder ersetzen, solange der vertraglich vereinbarte Kern der Leistung
          erhalten bleibt. Über wesentliche Änderungen informiert er in
          Textform.
        </li>
      </Klausel>

      <Klausel nummer={7} titel="Vergütung">
        <li>
          Entgeltliche Leistungen werden nach individuellem Angebot erbracht.
          Alle Preise verstehen sich netto zuzüglich gesetzlicher Umsatzsteuer.
        </li>
        <li>
          Die Abrechnung erfolgt per Rechnung; Zahlungen sind innerhalb von 14
          Tagen nach Rechnungsdatum ohne Abzug fällig. In der Anwendung werden
          keine Zahlungsdaten erhoben. Bei Verzug gilt § 288 BGB.
        </li>
      </Klausel>

      <Klausel nummer={8} titel="Laufzeit, Kündigung, Datenrückgabe">
        <li>
          Laufzeit und Kündigungsfrist ergeben sich aus dem Angebot. Fehlt eine
          Regelung, läuft der Vertrag unbefristet und ist von beiden Seiten mit
          einer Frist von vier Wochen zum Monatsende in Textform kündbar.
        </li>
        <li>
          Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt
          unberührt. Ein wichtiger Grund liegt für den Anbieter insbesondere
          vor, wenn der Kunde trotz Mahnung länger als 30 Tage mit einem
          Entgelt in Verzug ist oder schwerwiegend gegen § 4 verstößt.
        </li>
        <li>
          Nach Vertragsende kann der Kunde seine Daten 30 Tage lang in gängigen,
          maschinenlesbaren Formaten (JSON, IFC, BCF, GAEB, PDF) exportieren.
          Anschließend löscht der Anbieter die Daten auf Verlangen, spätestens
          nach 90 Tagen, soweit keine gesetzlichen Aufbewahrungspflichten
          entgegenstehen.
        </li>
      </Klausel>

      <Klausel nummer={9} titel="Kündigung und Rückerstattung">
        <RueckerstattungText alsKlausel />
      </Klausel>

      {/* 83-02: open source. The old § 10 granted a non-transferable licence and
          § 4 forbade reverse engineering (§§ 69d, 69e UrhG) and passing access
          on — both contradict the MIT licence and are gone. The customer-content
          clause moved to § 4. Wording of the first two items as decided by the
          operator ("alle Nutzer sind auf eigene Gefahr"). [ASSUMED] lawyer review
          of the whole terms is still open (57-06 Task 9). */}
      <Klausel nummer={10} titel="Open Source">
        <li>
          BIT-Atelier ist freie Software unter der MIT-Lizenz. Quellcode:{' '}
          <a href={REPO_URL} className="underline" target="_blank" rel="noreferrer">
            {REPO_URL}
          </a>
          .
        </li>
        <li>
          Die Nutzung erfolgt auf eigene Gefahr; die Software wird ohne
          Gewährleistung bereitgestellt. Prüfergebnisse und Berechnungen sind
          Hinweise und ersetzen keine fachliche Prüfung.
        </li>
        <li>
          Enthaltene Komponenten Dritter unterliegen ihren eigenen Lizenzen,
          die in der Datei THIRD-PARTY-LICENSES.md genannt sind und diesen
          Bedingungen insoweit vorgehen.
        </li>
      </Klausel>

      <Klausel nummer={11} titel="Gewährleistung">
        <li>
          Für entgeltlich vereinbarte Leistungen stellt der Anbieter die
          Software nach dem Stand der Technik bereit. Software kann nicht
          vollständig fehlerfrei sein; Mängel meldet der Kunde in Textform mit
          nachvollziehbarer Beschreibung. Der Anbieter beseitigt Mängel in
          angemessener Frist durch Nachbesserung oder Umgehungslösung.
        </li>
        <li>
          Für unentgeltlich bereitgestellte Fassungen (lokale Fassung,
          Quellcode, unentgeltlicher Cloud-Zugang) haftet der Anbieter für Sach-
          und Rechtsmängel nur bei Vorsatz und Arglist (§§ 523, 524, 600 BGB
          entsprechend).
        </li>
      </Klausel>

      <Klausel nummer={12} titel="Haftung">
        <li>
          Der Anbieter haftet unbeschränkt bei Vorsatz und grober
          Fahrlässigkeit, bei schuldhafter Verletzung von Leben, Körper oder
          Gesundheit, nach dem Produkthaftungsgesetz sowie im Umfang einer
          übernommenen Garantie.
        </li>
        <li>
          Bei leichter Fahrlässigkeit haftet der Anbieter nur für die
          Verletzung wesentlicher Vertragspflichten (Pflichten, deren Erfüllung
          die ordnungsgemäße Durchführung des Vertrags erst ermöglicht und auf
          deren Einhaltung der Kunde regelmäßig vertrauen darf), begrenzt auf
          den vertragstypischen, vorhersehbaren Schaden und je Vertragsjahr auf
          das in den vorangegangenen zwölf Monaten gezahlte Entgelt.
        </li>
        <li>
          Für Datenverlust haftet der Anbieter nur in der Höhe des Aufwands,
          der bei ordnungsgemäßer, regelmäßiger Datensicherung durch den Kunden
          zur Wiederherstellung erforderlich gewesen wäre.
        </li>
        <li>
          Für Schäden aus der ungeprüften Übernahme von Berechnungsergebnissen,
          Kostenangaben, Prüfbefunden oder KI-Vorschlägen in Planung, Vergabe
          oder Ausführung haftet der Anbieter nicht, soweit nicht Absatz 1
          eingreift.
        </li>
      </Klausel>

      <Klausel nummer={13} titel="Datenschutz und Vertraulichkeit">
        <li>
          Die Verarbeitung personenbezogener Daten beschreibt die
          Datenschutzerklärung. Für den Cloud-Betrieb schließen die Parteien
          einen Auftragsverarbeitungsvertrag nach Art. 28 DSGVO, den der
          Anbieter mit dem Angebot bereitstellt.
        </li>
        <li>
          Beide Parteien behandeln Projektdaten, Preise und Geschäftsgeheimnisse
          der jeweils anderen Seite vertraulich und nutzen sie nur zur
          Durchführung des Vertrags. Diese Pflicht überdauert das Vertragsende
          um drei Jahre.
        </li>
      </Klausel>

      <Klausel nummer={14} titel="Änderung dieser Bedingungen">
        <li>
          Der Anbieter kann diese Bedingungen mit Wirkung für die Zukunft
          ändern, wenn dafür ein sachlicher Grund besteht (etwa Gesetzesänderung,
          neue Funktionen, Änderung eingesetzter Dienste). Änderungen werden
          mindestens sechs Wochen vor Wirksamwerden in Textform mitgeteilt.
        </li>
        <li>
          Widerspricht der Kunde nicht innerhalb dieser Frist, gelten die
          geänderten Bedingungen; auf diese Folge weist der Anbieter in der
          Mitteilung hin. Widerspricht der Kunde, kann jede Seite den Vertrag
          zum Wirksamkeitszeitpunkt kündigen.
        </li>
      </Klausel>

      <Klausel nummer={15} titel="Schlussbestimmungen">
        <li>
          Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des
          UN-Kaufrechts.
        </li>
        <li>
          Ist der Kunde Kaufmann, juristische Person des öffentlichen Rechts
          oder öffentlich-rechtliches Sondervermögen, ist ausschließlicher
          Gerichtsstand {angabe('ort')}.
        </li>
        <li>
          Änderungen und Nebenabreden bedürfen der Textform. Sollte eine
          Bestimmung unwirksam sein, bleibt der Vertrag im Übrigen wirksam.
          Bei Abweichungen zwischen Sprachfassungen ist die deutsche Fassung
          maßgeblich.
        </li>
      </Klausel>

      <p className="mt-6 text-xs text-slate-400">Stand: {RECHT_STAND}</p>
    </div>
  );
}

/**
 * Cookie policy - or rather: the list of everything the app keeps in the
 * browser, since it sets no cookies at all. Plan 80-05 (EINST-04): the rows
 * now come from browserSpeicher.js's richtlinienZeilen() instead of a
 * hand-kept array here — that array had already drifted from the code (the
 * tour's and the header's save-later keys were both missing, 57-06 G-4), and
 * a test now guards the ONE registry against every literal storage key in the
 * source tree (browserSpeicher.test.js). Adding a key there is what adds the
 * row here; this component has no list of its own left to drift.
 */
export function CookieRichtlinieText() {
  // "Cache Storage" carried the "(Service Worker)" qualifier only in the old
  // hand-kept list; the registry's own value stays the short form the
  // Datenschutz settings area (80-05) shows too, so this is the one place
  // that still spells it out for the public-facing text.
  const zeilen = richtlinienZeilen().map((z) => [
    z.schluessel ?? (z.speicher === 'Cache Storage' ? 'Programmdateien' : 'Projektdatenbank'),
    z.speicher === 'Cache Storage' ? 'Cache Storage (Service Worker)' : z.speicher,
    z.zweck,
    z.kategorie,
    z.fassung,
  ]);

  return (
    <div>
      <Abschnitt titel="Kurzfassung">
        <p>
          <strong>BIT-Atelier setzt keine Cookies</strong> — weder eigene noch
          solche Dritter, in keiner Fassung. Es gibt keine Analyse-, Tracking-
          oder Werbedienste und deshalb auch kein Cookie-Banner: Wo nichts
          Einwilligungspflichtiges geladen wird, wäre ein Banner eine leere
          Geste.
        </p>
        <p>
          Was die Anwendung dennoch in Ihrem Browser ablegt, steht vollständig
          in der folgenden Tabelle. „Notwendig“ heißt: ohne diesen Eintrag
          funktioniert die von Ihnen gewünschte Funktion nicht (§ 25 Abs. 2
          Nr. 2 TDDDG). Einträge, die eine Einwilligung bräuchten, legt die
          Anwendung nicht an.
        </p>
      </Abschnitt>

      <Abschnitt titel="Speicher im Browser">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-700">
                <th scope="col" className="py-1.5 pr-2 font-semibold">Schlüssel</th>
                <th scope="col" className="py-1.5 pr-2 font-semibold">Ort</th>
                <th scope="col" className="py-1.5 pr-2 font-semibold">Zweck</th>
                <th scope="col" className="py-1.5 pr-2 font-semibold">Grundlage</th>
                <th scope="col" className="py-1.5 font-semibold">Fassung</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map(([schluessel, ort, zweck, grundlage, fassung]) => (
                <tr key={schluessel} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 pr-2 font-mono text-[11px] text-slate-700">{schluessel}</td>
                  <td className="py-1.5 pr-2">{ort}</td>
                  <td className="py-1.5 pr-2">{zweck}</td>
                  <td className="py-1.5 pr-2">{grundlage}</td>
                  <td className="py-1.5">{fassung}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Alle Einträge bleiben, bis Sie sie löschen; keiner enthält eine
          Gerätekennung, und keiner wird an uns übertragen.
        </p>
      </Abschnitt>

      <Abschnitt titel="Dienste Dritter">
        <p>
          Beim Öffnen einer Karte lädt Ihr Browser Kartenkacheln unmittelbar
          von den in der Datenschutzerklärung genannten Anbietern. Wir binden
          dabei keine Skripte Dritter ein und übermitteln keine Kennungen; ob
          ein Kachel-Server seinerseits Cookies setzt, liegt außerhalb unseres
          Einflusses — nach unserem Kenntnisstand tun die genannten Dienste das
          nicht. Schriften, Skripte und Stylesheets liefern wir selbst aus.
        </p>
      </Abschnitt>

      <Abschnitt titel="Löschen und Widerrufen">
        <p>
          Sämtliche Einträge entfernen Sie in den Einstellungen Ihres Browsers
          unter „Websitedaten löschen“ für diese Adresse; Einstellungen dieses
          Geräts auch in der Anwendung unter Einstellungen › Datenschutz &amp;
          Browserdaten.
        </p>
        <p>
          Ändert sich diese Liste, aktualisieren wir das Datum unten. Ein
          Speicherschlüssel, der hier nicht steht, gehört nicht zu dieser
          Anwendung.
        </p>
      </Abschnitt>

      <p className="mt-6 text-xs text-slate-400">Stand: {RECHT_STAND}</p>
    </div>
  );
}
