// Build script of the desktop shell: generates the Tauri context (config,
// capabilities, icons) the `generate_context!` macro in lib.rs embeds.
//
// The app manifest lists every own command. Without it Tauri allows ALL app
// commands to every window; with it each command gets an `allow-<name>`
// permission that capabilities/default.json must grant explicitly — a new
// command stays unreachable until someone decides it may be called.
const BEFEHLE: &[&str] = &[
    "profil_lesen",
    "profil_schreiben",
    "ablage_lesen",
    "ablage_schreiben",
    "ablage_umbenennen",
    "ablage_loeschen",
    "ablage_liste",
    "ablage_ordner_anlegen",
    "ablage_groesse",
    "ablage_pruefen",
    "ablage_standard",
    "ablage_waehlen",
    "ablage_oeffnen",
    "ablage_kopieren",
    "altbestand_lesen",
    "altbestand_sichern",
    // 93-10: .bitproj opened by double-click (datei.rs).
    "datei_ausstehend",
    "datei_lesen",
    "datei_stand",
    "datei_schreiben",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(BEFEHLE)),
    )
    .expect("tauri build script failed");
}
