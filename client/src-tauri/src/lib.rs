// Desktop shell of BIT-Atelier (Phases 70-02, 70-03).
//
// What the shell does: one window around the built `lokal` web app
// (dist-lokal-client), one instance per user session, the local profile file
// (profil.rs), the file commands of the user's storage location
// (ablage.rs, every path confined to that folder) and the .bitproj files the
// user opens by double-click (datei.rs, plan 93-10).
// What it deliberately does NOT do: no domain logic, no second navigation, no
// own data rules — the web app decides everything, exactly as in the PWA; the
// shell only reads and writes the files the web app names.
//
// In:  the embedded frontend (tauri.conf.json → build.frontendDist).
// Out: the running window "main" and the commands listed in
//      `generate_handler!` below (each needs its allow-* entry in
//      capabilities/default.json, see build.rs).

mod ablage;
mod datei;
mod profil;

use std::path::Path;
use tauri::{Emitter, Manager, State};

/// Reads the local profile; `null` before the first start.
#[tauri::command]
fn profil_lesen(app: tauri::AppHandle) -> Result<Option<profil::Profil>, String> {
    profil::lesen(&app)
}

/// Stores the local profile (validated, atomic) and points the file commands
/// at its storage location.
#[tauri::command]
fn profil_schreiben(app: tauri::AppHandle, zustand: State<ablage::AblageZustand>, profil: profil::Profil) -> Result<(), String> {
    profil::schreiben(&app, &profil)?;
    ablage::wurzel_setzen(&zustand, profil.ablageort.clone());
    Ok(())
}

/// Builds and runs the shell. Blocks until the last window closes.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Single instance FIRST (plugin docs: it must be registered before every
    // other plugin). Two windows on the same storage location would write the
    // same collection files from two in-memory states (last write wins, the
    // other window's records are lost) — so a second start only brings the
    // existing window to the front.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    // 93-10: a double-clicked .bitproj while the window is open arrives here as
    // the second instance's arguments — queue it and tell the page.
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        if let Some(fenster) = app.get_webview_window("main") {
            let _ = fenster.unminimize();
            let _ = fenster.show();
            let _ = fenster.set_focus();
        }
        let zustand = app.state::<datei::DateiZustand>();
        if datei::vormerken(&zustand, datei::aus_argumenten(&argv, Some(Path::new(&cwd)))) {
            let _ = app.emit("datei-oeffnen", ());
        }
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(ablage::AblageZustand::default())
        .manage(datei::DateiZustand::default())
        // 93-10: the first start's own arguments (double-click while closed).
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            datei::vormerken(&app.state::<datei::DateiZustand>(), datei::aus_argumenten(&args, None));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            profil_lesen,
            profil_schreiben,
            ablage::ablage_lesen,
            ablage::ablage_schreiben,
            ablage::ablage_umbenennen,
            ablage::ablage_loeschen,
            ablage::ablage_liste,
            ablage::ablage_ordner_anlegen,
            ablage::ablage_groesse,
            ablage::ablage_pruefen,
            ablage::ablage_standard,
            ablage::ablage_waehlen,
            ablage::ablage_oeffnen,
            ablage::ablage_kopieren,
            ablage::altbestand_lesen,
            ablage::altbestand_sichern,
            datei::datei_ausstehend,
            datei::datei_lesen,
            datei::datei_stand,
            datei::datei_schreiben,
        ])
        .run(tauri::generate_context!())
        .expect("BIT-Atelier client could not start");
}
