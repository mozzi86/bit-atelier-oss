// Own storage location of the desktop client (Phase 70-03): the file commands
// behind the web app's file storage adapter (packages/nova-core/src/api/
// dateiSpeicher.js, bridged by src/client/ablage.js).
//
// Security rule of this module: the page can only ever touch files INSIDE the
// storage folder named in the profile. Every path argument is relative, split
// into components and rejected when a component is empty, ".", ".." or carries
// a drive/stream colon — so no "..\..\Windows", no "C:\x", no "datei:stream".
// That is the whole scope; tauri-plugin-fs is not used (its scope would have
// to be widened at runtime for a folder the user picks, plus the persisted-
// scope plugin, to say the same thing).
//
// Commands that look outside the folder do so for ONE fixed purpose each:
// the folder picker, the default folder, opening the folder in the file
// manager, and reading the old Node installation's db.json (read-only, fixed
// candidate paths) for the one-time takeover.
//
// In:  relative paths + text from the page. Out: text, file names, byte counts.
// Errors are plain-text German strings (shown in the app).

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::profil;

/// Storage root as read from the profile; None until a profile with a
/// location exists. Updated whenever the profile is written.
#[derive(Default)]
pub struct AblageZustand(pub Mutex<Option<PathBuf>>);

/// Name of the default folder under %LOCALAPPDATA% (Windows) / the local data
/// dir elsewhere. Deliberately NOT under the app identifier folder: the NSIS
/// uninstaller's "delete application data" option removes
/// %LOCALAPPDATA%\de.bit-atelier.app — it must never take the projects along.
/// [ASSUMED from the Tauri NSIS template's delete-app-data step; not verified
/// on this machine.]
const STANDARD_ORDNER: &str = "BIT-Atelier-Ablage";

/// Checks one relative path and joins it to the root.
pub fn aufloesen(wurzel: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Ok(wurzel.to_path_buf());
    }
    let mut ziel = wurzel.to_path_buf();
    for teil in rel.split(['/', '\\']) {
        if teil.is_empty() || teil == "." || teil == ".." || teil.contains(':') || teil.contains('\0') {
            return Err(format!("Pfad außerhalb des Ablageorts abgelehnt: {rel}"));
        }
        ziel.push(teil);
    }
    // Belt and braces: after joining, every component below the root must be a
    // plain name (no prefix/root/parent sneaked in through an odd separator).
    let unten = ziel.strip_prefix(wurzel).map_err(|_| format!("Pfad außerhalb des Ablageorts abgelehnt: {rel}"))?;
    if unten.components().any(|k| !matches!(k, Component::Normal(_))) {
        return Err(format!("Pfad außerhalb des Ablageorts abgelehnt: {rel}"));
    }
    Ok(ziel)
}

/// The storage root, loaded from the profile on first use.
fn wurzel<R: Runtime>(app: &AppHandle<R>, zustand: &State<AblageZustand>) -> Result<PathBuf, String> {
    let mut gesperrt = zustand.0.lock().map_err(|_| "Interner Fehler: Ablage-Zustand gesperrt".to_string())?;
    if gesperrt.is_none() {
        let p = profil::lesen(app)?.ok_or("Noch kein Profil angelegt.")?;
        let ort = p.ablageort.ok_or("Im Profil ist kein Ablageort eingetragen.")?;
        *gesperrt = Some(PathBuf::from(ort));
    }
    Ok(gesperrt.clone().expect("set above"))
}

/// Sets the root after the profile changed (called by profil_schreiben).
pub fn wurzel_setzen(zustand: &State<AblageZustand>, ort: Option<String>) {
    if let Ok(mut g) = zustand.0.lock() {
        *g = ort.map(PathBuf::from);
    }
}

fn io_text(was: &str, pfad: &Path, e: std::io::Error) -> String {
    format!("{was} fehlgeschlagen ({}): {e}", pfad.display())
}

/// Reads a text file; None when it does not exist.
#[tauri::command]
pub fn ablage_lesen(app: AppHandle, zustand: State<AblageZustand>, pfad: String) -> Result<Option<String>, String> {
    let ziel = aufloesen(&wurzel(&app, &zustand)?, &pfad)?;
    match fs::read_to_string(&ziel) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_text("Lesen", &ziel, e)),
    }
}

/// Writes a text file and flushes it to disk (the adapter renames it into
/// place afterwards — that pair is the atomic write).
#[tauri::command]
pub fn ablage_schreiben(app: AppHandle, zustand: State<AblageZustand>, pfad: String, text: String) -> Result<(), String> {
    let ziel = aufloesen(&wurzel(&app, &zustand)?, &pfad)?;
    let mut datei = fs::File::create(&ziel).map_err(|e| io_text("Anlegen", &ziel, e))?;
    datei
        .write_all(text.as_bytes())
        .and_then(|_| datei.sync_all())
        .map_err(|e| io_text("Schreiben", &ziel, e))
}

/// Renames a file, replacing the target (MoveFileExW with REPLACE_EXISTING on Windows).
#[tauri::command]
pub fn ablage_umbenennen(app: AppHandle, zustand: State<AblageZustand>, von: String, nach: String) -> Result<(), String> {
    let w = wurzel(&app, &zustand)?;
    let (a, b) = (aufloesen(&w, &von)?, aufloesen(&w, &nach)?);
    fs::rename(&a, &b).map_err(|e| io_text("Umbenennen", &b, e))
}

/// Deletes a file; a missing file is not an error.
#[tauri::command]
pub fn ablage_loeschen(app: AppHandle, zustand: State<AblageZustand>, pfad: String) -> Result<(), String> {
    let ziel = aufloesen(&wurzel(&app, &zustand)?, &pfad)?;
    match fs::remove_file(&ziel) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_text("Löschen", &ziel, e)),
    }
}

/// File names (no folders) in a folder; a missing folder gives an empty list.
#[tauri::command]
pub fn ablage_liste(app: AppHandle, zustand: State<AblageZustand>, ordner: String) -> Result<Vec<String>, String> {
    let ziel = aufloesen(&wurzel(&app, &zustand)?, &ordner)?;
    let eintraege = match fs::read_dir(&ziel) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(io_text("Auflisten", &ziel, e)),
    };
    let mut namen = Vec::new();
    for e in eintraege.flatten() {
        if e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if let Some(n) = e.file_name().to_str() {
                namen.push(n.to_string());
            }
        }
    }
    namen.sort();
    Ok(namen)
}

/// Creates a folder with all parents.
#[tauri::command]
pub fn ablage_ordner_anlegen(app: AppHandle, zustand: State<AblageZustand>, ordner: String) -> Result<(), String> {
    let ziel = aufloesen(&wurzel(&app, &zustand)?, &ordner)?;
    fs::create_dir_all(&ziel).map_err(|e| io_text("Ordner anlegen", &ziel, e))
}

/// Bytes used by the storage folder (recursive), for the "belegt" readout.
pub fn groesse(pfad: &Path) -> u64 {
    let Ok(eintraege) = fs::read_dir(pfad) else { return 0 };
    eintraege
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => groesse(&e.path()),
            Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

/// Bytes used by the current storage folder.
#[tauri::command]
pub fn ablage_groesse(app: AppHandle, zustand: State<AblageZustand>) -> Result<u64, String> {
    Ok(groesse(&wurzel(&app, &zustand)?))
}

/// What a folder holds, for choosing or checking a storage location.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrdnerBefund {
    /// The folder exists.
    pub vorhanden: bool,
    /// It holds a BIT-Atelier storage (meta.json at the top).
    pub hat_daten: bool,
    /// It holds nothing at all.
    pub leer: bool,
}

/// Inspects a folder chosen by the user (absolute path).
pub fn befund(pfad: &Path) -> OrdnerBefund {
    let vorhanden = pfad.is_dir();
    let hat_daten = pfad.join("meta.json").is_file();
    let leer = !vorhanden || fs::read_dir(pfad).map(|mut d| d.next().is_none()).unwrap_or(false);
    OrdnerBefund { vorhanden, hat_daten, leer }
}

/// Inspects an absolute folder path (no reading of contents beyond the top level).
#[tauri::command]
pub fn ablage_pruefen(ordner: String) -> Result<OrdnerBefund, String> {
    let p = PathBuf::from(&ordner);
    if !p.is_absolute() {
        return Err(format!("Der Ablageort muss ein vollständiger Pfad sein: {ordner}"));
    }
    Ok(befund(&p))
}

/// The default storage folder (not created here).
#[tauri::command]
pub fn ablage_standard(app: AppHandle) -> Result<String, String> {
    let basis = app
        .path()
        .local_data_dir()
        .map_err(|e| format!("Lokaler Datenordner nicht ermittelbar: {e}"))?;
    Ok(basis.join(STANDARD_ORDNER).to_string_lossy().into_owned())
}

/// Folder picker. Async on purpose: the blocking dialog must not run on the
/// main thread (synchronous commands do — that would freeze the window).
#[tauri::command]
pub async fn ablage_waehlen(app: AppHandle, start: Option<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file().set_title("Ablageort wählen");
    if let Some(s) = start.filter(|s| Path::new(s).is_dir()) {
        dialog = dialog.set_directory(s);
    }
    match dialog.blocking_pick_folder() {
        None => Ok(None),
        Some(fp) => fp
            .into_path()
            .map(|p| Some(p.to_string_lossy().into_owned()))
            .map_err(|e| format!("Gewählter Ordner nicht lesbar: {e}")),
    }
}

/// Opens the storage folder in the file manager (only that folder).
#[tauri::command]
pub fn ablage_oeffnen(app: AppHandle, zustand: State<AblageZustand>) -> Result<(), String> {
    let w = wurzel(&app, &zustand)?;
    #[cfg(target_os = "windows")]
    let programm = "explorer.exe";
    #[cfg(target_os = "macos")]
    let programm = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let programm = "xdg-open";
    std::process::Command::new(programm)
        .arg(&w)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Dateimanager ließ sich nicht öffnen: {e}"))
}

/// Copies a folder tree (used when the user moves the storage location).
pub fn baum_kopieren(von: &Path, nach: &Path) -> Result<u64, String> {
    fs::create_dir_all(nach).map_err(|e| io_text("Ordner anlegen", nach, e))?;
    let mut anzahl = 0;
    for e in fs::read_dir(von).map_err(|e| io_text("Auflisten", von, e))?.flatten() {
        let ziel = nach.join(e.file_name());
        let typ = e.file_type().map_err(|err| io_text("Lesen", &e.path(), err))?;
        if typ.is_dir() {
            anzahl += baum_kopieren(&e.path(), &ziel)?;
        } else if typ.is_file() {
            // Leftovers of an interrupted write are not copied.
            if e.file_name().to_string_lossy().ends_with(".tmp") {
                continue;
            }
            fs::copy(e.path(), &ziel).map_err(|err| io_text("Kopieren", &ziel, err))?;
            anzahl += 1;
        }
    }
    Ok(anzahl)
}

/// Copies the current storage folder into an EMPTY target folder and returns
/// the number of files. The old folder stays untouched — moving means copy
/// first, switch the profile afterwards (done by the page), never delete.
#[tauri::command]
pub fn ablage_kopieren(app: AppHandle, zustand: State<AblageZustand>, ziel: String) -> Result<u64, String> {
    let von = wurzel(&app, &zustand)?;
    let nach = PathBuf::from(&ziel);
    if !nach.is_absolute() {
        return Err(format!("Der Ablageort muss ein vollständiger Pfad sein: {ziel}"));
    }
    if nach.starts_with(&von) || von.starts_with(&nach) {
        return Err("Der neue Ablageort darf nicht im alten liegen (und umgekehrt).".into());
    }
    if !befund(&nach).leer {
        return Err(format!("Der Zielordner ist nicht leer: {ziel}"));
    }
    baum_kopieren(&von, &nach)
}

/// The old Node installation's database, read-only, for the one-time takeover.
#[derive(Serialize)]
pub struct Altbestand {
    /// Where it was found.
    pub pfad: String,
    /// Raw file content (the page parses and counts it).
    pub text: String,
}

/// Fixed candidate paths of the Node installation's db.json (installer 92-02:
/// %LOCALAPPDATA%\BIT-Atelier\daten, ~/BIT-Atelier/daten on macOS/Linux and on
/// machines where the installer was started from a sandboxed app).
/// BIT_ALTBESTAND_DATEI overrides the list — for the headless test, which must
/// never touch a real installation.
fn altbestand_kandidaten<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    if let Some(p) = std::env::var_os("BIT_ALTBESTAND_DATEI") {
        return vec![PathBuf::from(p)];
    }
    let mut liste = Vec::new();
    if let Ok(lokal) = app.path().local_data_dir() {
        liste.push(lokal.join("BIT-Atelier").join("daten").join("db.json"));
    }
    if let Ok(heim) = app.path().home_dir() {
        liste.push(heim.join("BIT-Atelier").join("daten").join("db.json"));
    }
    liste
}

/// Reads the first existing candidate; None when there is none.
#[tauri::command]
pub fn altbestand_lesen(app: AppHandle) -> Result<Option<Altbestand>, String> {
    for p in altbestand_kandidaten(&app) {
        if p.is_file() {
            let text = fs::read_to_string(&p).map_err(|e| io_text("Lesen", &p, e))?;
            return Ok(Some(Altbestand { pfad: p.to_string_lossy().into_owned(), text }));
        }
    }
    Ok(None)
}

/// Copies the found db.json into `<Ablageort>/uebernahme/<name>` BEFORE the
/// takeover writes anything — the backup copy the plan asks for. Returns the
/// relative path of the copy.
#[tauri::command]
pub fn altbestand_sichern(app: AppHandle, zustand: State<AblageZustand>, quelle: String, name: String) -> Result<String, String> {
    let quelle = PathBuf::from(&quelle);
    if !altbestand_kandidaten(&app).iter().any(|k| k == &quelle) {
        return Err("Nur die gefundene Datenbank der bisherigen Installation kann gesichert werden.".into());
    }
    let rel = format!("uebernahme/{name}");
    let w = wurzel(&app, &zustand)?;
    let ziel = aufloesen(&w, &rel)?;
    if let Some(eltern) = ziel.parent() {
        fs::create_dir_all(eltern).map_err(|e| io_text("Ordner anlegen", eltern, e))?;
    }
    fs::copy(&quelle, &ziel).map_err(|e| io_text("Sicherungskopie", &ziel, e))?;
    Ok(rel)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wurzel_test() -> PathBuf {
        std::env::temp_dir().join("bit-ablage-wurzel")
    }

    #[test]
    fn relative_paths_stay_inside() {
        let w = wurzel_test();
        assert_eq!(aufloesen(&w, "daten/Project.json").unwrap(), w.join("daten").join("Project.json"));
        assert_eq!(aufloesen(&w, "daten\\Project.json").unwrap(), w.join("daten").join("Project.json"));
        assert_eq!(aufloesen(&w, "").unwrap(), w);
    }

    #[test]
    fn escapes_are_rejected() {
        let w = wurzel_test();
        for boese in ["../x", "daten/../../x", "C:\\Windows", "/etc/passwd", "daten//x", "./x", "a:stream", "\\\\server\\x"] {
            assert!(aufloesen(&w, boese).is_err(), "{boese} must be rejected");
        }
    }

    #[test]
    fn copy_skips_tmp_and_counts_files() {
        let basis = std::env::temp_dir().join(format!("bit-ablage-kopie-{}", std::process::id()));
        let von = basis.join("von");
        let nach = basis.join("nach");
        fs::create_dir_all(von.join("daten")).unwrap();
        fs::write(von.join("meta.json"), "{}").unwrap();
        fs::write(von.join("daten").join("P.json"), "[]").unwrap();
        fs::write(von.join("daten").join("P.json.tmp"), "[").unwrap();
        assert_eq!(baum_kopieren(&von, &nach).unwrap(), 2);
        assert!(nach.join("daten").join("P.json").is_file());
        assert!(!nach.join("daten").join("P.json.tmp").exists());
        assert!(befund(&nach).hat_daten);
        assert_eq!(groesse(&nach), 4);
        fs::remove_dir_all(&basis).unwrap();
    }
}
