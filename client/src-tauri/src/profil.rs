// Local profile of the desktop client (Phase 70-02, interface in 70-02-PLAN):
// `{ name, buero, ablageort }` — no server, no account, no payment.
//
// Where it lives: `<AppConfig>/profil.json`, on Windows
// `%APPDATA%\de.bit-atelier.app\profil.json`. Deliberately NOT in the WebView's
// storage: from 70-03 on the profile carries the pointer to the user's storage
// location, and a pointer that disappears with the WebView profile (identifier
// change, "clear browsing data") would show an empty office although every file
// is still on disk.
//
// In:  the profile object from the web app (two commands, see lib.rs).
// Out: the stored profile, or None before the first start.
// Errors are returned as plain-text strings (German, shown in the dialog).

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

/// File name of the profile inside the app config directory.
const PROFIL_DATEI: &str = "profil.json";
/// Upper bound for name and office, in characters. [ASSUMED] generous for any
/// real person or office name; it only stops a runaway paste.
const MAX_TEXT: usize = 200;

/// The profile as stored. Field names are German like the web app's store
/// fields and must never be renamed (project rule: extend, do not rename).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Profil {
    /// Display name of the person working on this device.
    pub name: String,
    /// Office name.
    #[serde(default)]
    pub buero: String,
    /// Absolute path of the storage folder (70-03); None = not chosen yet.
    #[serde(default)]
    pub ablageort: Option<String>,
    /// ISO time of the first save, set by the web app.
    #[serde(default)]
    pub angelegt: Option<String>,
}

/// Checks the profile before it is written.
/// Returns the reason in plain German when it is not acceptable.
pub fn pruefen(profil: &Profil) -> Result<(), String> {
    if profil.name.trim().is_empty() {
        return Err("Der Name fehlt.".into());
    }
    if profil.name.chars().count() > MAX_TEXT || profil.buero.chars().count() > MAX_TEXT {
        return Err(format!("Name und Büro dürfen höchstens {MAX_TEXT} Zeichen lang sein."));
    }
    if let Some(ort) = &profil.ablageort {
        if !Path::new(ort).is_absolute() {
            return Err(format!("Der Ablageort muss ein vollständiger Pfad sein: {ort}"));
        }
    }
    Ok(())
}

/// Writes a file atomically: write `<ziel>.tmp`, flush it to disk, rename over
/// the target. A crash in the middle leaves the previous version untouched.
pub fn atomar_schreiben(ziel: &Path, inhalt: &[u8]) -> Result<(), String> {
    let mut tmp = ziel.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    {
        let mut datei = fs::File::create(&tmp)
            .map_err(|e| format!("{} konnte nicht angelegt werden: {e}", tmp.display()))?;
        datei
            .write_all(inhalt)
            .and_then(|_| datei.sync_all())
            .map_err(|e| format!("{} konnte nicht geschrieben werden: {e}", tmp.display()))?;
    }
    // std::fs::rename replaces an existing target on Windows too
    // (MoveFileExW with MOVEFILE_REPLACE_EXISTING).
    fs::rename(&tmp, ziel).map_err(|e| format!("{} konnte nicht ersetzt werden: {e}", ziel.display()))
}

/// Path of the profile file; creates the config directory when missing.
fn profil_pfad<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let ordner = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Konfigurationsordner nicht ermittelbar: {e}"))?;
    fs::create_dir_all(&ordner).map_err(|e| format!("{} konnte nicht angelegt werden: {e}", ordner.display()))?;
    Ok(ordner.join(PROFIL_DATEI))
}

/// Reads the profile. Missing file → None (first start). A damaged file is
/// REPORTED, not treated as "no profile" — otherwise the first-start dialog
/// would overwrite it and the storage pointer would be gone.
pub fn lesen<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Profil>, String> {
    let pfad = profil_pfad(app)?;
    let roh = match fs::read_to_string(&pfad) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{} nicht lesbar: {e}", pfad.display())),
    };
    serde_json::from_str(&roh)
        .map(Some)
        .map_err(|e| format!("{} ist beschädigt: {e}", pfad.display()))
}

/// Validates and stores the profile atomically.
pub fn schreiben<R: Runtime>(app: &AppHandle<R>, profil: &Profil) -> Result<(), String> {
    pruefen(profil)?;
    let pfad = profil_pfad(app)?;
    let text = serde_json::to_vec_pretty(profil).map_err(|e| e.to_string())?;
    atomar_schreiben(&pfad, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profil(name: &str, ablageort: Option<&str>) -> Profil {
        Profil { name: name.into(), buero: "Büro".into(), ablageort: ablageort.map(Into::into), angelegt: None }
    }

    #[test]
    fn name_is_required() {
        assert!(pruefen(&profil("  ", None)).is_err());
        assert!(pruefen(&profil("A. Muster", None)).is_ok());
    }

    #[test]
    fn storage_location_must_be_absolute() {
        assert!(pruefen(&profil("A", Some("relativ/ordner"))).is_err());
        let absolut = std::env::temp_dir();
        assert!(pruefen(&profil("A", absolut.to_str())).is_ok());
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_tmp() {
        let ordner = std::env::temp_dir().join(format!("bit-profil-test-{}", std::process::id()));
        fs::create_dir_all(&ordner).unwrap();
        let ziel = ordner.join("p.json");
        atomar_schreiben(&ziel, b"eins").unwrap();
        atomar_schreiben(&ziel, b"zwei").unwrap();
        assert_eq!(fs::read_to_string(&ziel).unwrap(), "zwei");
        assert!(!ordner.join("p.json.tmp").exists());
        fs::remove_dir_all(&ordner).unwrap();
    }
}
