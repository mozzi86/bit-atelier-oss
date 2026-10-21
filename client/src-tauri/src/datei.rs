// .bitproj files opened by double-click (plan 93-10). The installer registers the
// extension (tauri.conf.json bundle.fileAssociations); Windows then starts the
// shell with the file path as argument, and a second start while the window is
// open hands its arguments to the running instance (single-instance plugin,
// lib.rs). This module keeps those paths and offers four commands to the page
// (src/client/dateiHuelle.js):
//
//   datei_ausstehend  → the next opened file (path, name, size, mtime) or null
//   datei_lesen       → its bytes (raw response), only for files opened that way
//   datei_stand       → size + mtime of a .bitproj path (change check before saving back)
//   datei_schreiben   → write bytes to a .bitproj path, atomic (.tmp + rename)
//
// Security rule of this module (threat T-11 in 93-10-PLAN.md): reading is
// limited to files the user opened through the shell in this session; writing
// and the status query only accept absolute paths with the extension .bitproj
// and no ".." component; writing either replaces an EXISTING file or creates a
// NEW one (`neu`), never both by accident, and never leaves a .tmp behind.
// 104-10 (path rule; @core/lib/pfadRichtlinie.js on the page side): only paths on
// a local drive — a UNC share (\\server\share) or a verbatim/device path (\\?\,
// \\.\) is refused before the file system is asked (datei_lesen, datei_stand,
// datei_schreiben, and the command line), and a command-line file whose
// real path turns out to be on a share (mapped network drive) is not queued.
// The page is our own bundle under a strict CSP — this bounds what it may touch,
// it does not replace that.
//
// In:  command-line paths, raw bytes from the page. Out: file info, bytes.
// Errors are plain-text German strings (shown in the app).

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::State;

/// Largest .bitproj read or written, bytes (64 MB) — same cap as the local server.
pub const MAX_BYTES: u64 = 64 * 1024 * 1024;

/// Opened files: the queue the page has not fetched yet, and every file the
/// page may read in this session.
#[derive(Default)]
pub struct DateiZustand {
    ausstehend: Mutex<Vec<PathBuf>>,
    erlaubt: Mutex<HashSet<PathBuf>>,
}

/// What the page learns about a file. `geaendert_ms` = modification time, ms since 1970.
#[derive(Serialize, Debug, PartialEq)]
pub struct DateiInfo {
    pub pfad: String,
    pub name: String,
    pub groesse: u64,
    pub geaendert_ms: u64,
}

/// True for a path ending in .bitproj (any case).
pub fn ist_bitproj(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("bitproj"))
        .unwrap_or(false)
}

/// The .bitproj paths in a command line (argument 0 is the program itself);
/// relative ones are resolved against `cwd` (the second instance's folder).
pub fn aus_argumenten(args: &[String], cwd: Option<&Path>) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .map(|p| match cwd {
            Some(c) if !p.is_absolute() => c.join(p),
            _ => p,
        })
        .filter(|p| ist_bitproj(p))
        .collect()
}

/// Windows' canonical form starts with \\?\ — fine for the file system, ugly
/// in the app and in a copy's file name; the page gets the plain form.
fn anzeige(p: &Path) -> String {
    let s = p.to_string_lossy();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

/// Queues existing .bitproj files for the page. Returns true when one was added.
pub fn vormerken(zustand: &DateiZustand, pfade: Vec<PathBuf>) -> bool {
    let mut neu = false;
    for p in pfade {
        // 104-10: never resolve a share path (Windows would contact the server); a
        // mapped drive only shows up as UNC after canonicalize — checked again.
        if lokales_laufwerk(&p, false).is_err() {
            continue;
        }
        let Ok(echt) = fs::canonicalize(&p) else { continue };
        if lokales_laufwerk(&echt, true).is_err() || !echt.is_file() || !ist_bitproj(&echt) {
            continue;
        }
        if let (Ok(mut a), Ok(mut e)) = (zustand.ausstehend.lock(), zustand.erlaubt.lock()) {
            e.insert(echt.clone());
            a.push(echt);
            neu = true;
        }
    }
    neu
}

fn info(p: &Path) -> Result<DateiInfo, String> {
    let m = fs::metadata(p).map_err(|e| format!("Datei nicht lesbar: {e}"))?;
    let geaendert_ms = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(DateiInfo {
        pfad: anzeige(p),
        name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        groesse: m.len(),
        geaendert_ms,
    })
}

/// Plain-text reasons, same wording as PFAD_MELDUNGEN in pfadRichtlinie.js.
const NETZWERK: &str = r"Netzwerkpfade (\\Server\Freigabe) werden nicht geöffnet — bitte die Datei auf ein lokales Laufwerk kopieren.";
const GERAET: &str = r"Geräte- und Systempfade (\\?\, \\.\, /dev, /proc) werden nicht geöffnet.";

/// 104-10: the path names a local drive (`C:\…`) or has no Windows prefix at
/// all (POSIX). `verbatim` = also accept `\\?\C:\…`, the form fs::canonicalize
/// returns on Windows — never accepted from the page.
pub fn lokales_laufwerk(p: &Path, verbatim: bool) -> Result<(), String> {
    match p.components().next() {
        Some(Component::Prefix(pre)) => match pre.kind() {
            Prefix::Disk(_) => Ok(()),
            Prefix::VerbatimDisk(_) if verbatim => Ok(()),
            Prefix::UNC(..) | Prefix::VerbatimUNC(..) => Err(NETZWERK.into()),
            _ => Err(GERAET.into()),
        },
        _ => Ok(()),
    }
}

/// 104-10: a folder the user configured (the storage location of ablage.rs and
/// profil.rs): a local drive or a network share is fine — a NAS is a sensible
/// place for it —, a verbatim or device path (`\\?\`, `\\.\`) is not.
pub fn kein_geraetepfad(p: &Path) -> Result<(), String> {
    match p.components().next() {
        Some(Component::Prefix(pre)) => match pre.kind() {
            Prefix::Disk(_) | Prefix::UNC(..) => Ok(()),
            _ => Err(GERAET.into()),
        },
        _ => Ok(()),
    }
}

/// Absolute, on a local drive (104-10), .bitproj, no "..".
pub fn pfad_pruefen(pfad: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(pfad);
    lokales_laufwerk(&p, false)?;
    if !p.is_absolute() || !ist_bitproj(&p) {
        return Err("Nur absolute Pfade zu .bitproj-Dateien sind erlaubt.".into());
    }
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Pfade mit „..“ sind nicht erlaubt.".into());
    }
    Ok(p)
}

/// Writes `<ziel>.tmp`, flushes it, renames it over the target; removes the
/// .tmp again when anything fails.
pub fn atomar_schreiben(ziel: &Path, daten: &[u8]) -> Result<(), String> {
    let mut name = ziel.file_name().ok_or("Kein Dateiname.")?.to_os_string();
    name.push(".tmp");
    let tmp = ziel.with_file_name(name);
    let ergebnis = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(daten)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, ziel)
    })();
    if let Err(e) = ergebnis {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Datei konnte nicht geschrieben werden: {e}"));
    }
    Ok(())
}

/// Hex (two characters per byte) → bytes. The path travels hex-encoded in a
/// request header because header values must be ASCII.
pub fn hex_dekodieren(text: &str) -> Result<Vec<u8>, String> {
    if text.len() % 2 != 0 {
        return Err("Ungültige Pfadangabe.".into());
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).map_err(|_| "Ungültige Pfadangabe.".to_string()))
        .collect()
}

/// The next opened file, or null.
#[tauri::command]
pub fn datei_ausstehend(zustand: State<DateiZustand>) -> Result<Option<DateiInfo>, String> {
    let naechste = {
        let mut a = zustand.ausstehend.lock().map_err(|_| "Interner Fehler.")?;
        if a.is_empty() {
            return Ok(None);
        }
        a.remove(0)
    };
    info(&naechste).map(Some)
}

/// The real path of a file the page may read: on a local drive (104-10) and opened
/// through the shell in this session. The drive check runs BEFORE fs::canonicalize —
/// resolving a UNC path would already open the SMB connection (and offer the Windows
/// credentials) before the allow list could refuse it.
pub fn lesen_erlaubt(zustand: &DateiZustand, pfad: &str) -> Result<PathBuf, String> {
    lokales_laufwerk(Path::new(pfad), false)?;
    let echt = fs::canonicalize(pfad).map_err(|_| "Die Datei wurde nicht gefunden.".to_string())?;
    let erlaubt = zustand.erlaubt.lock().map_err(|_| "Interner Fehler.")?.contains(&echt);
    if !erlaubt {
        return Err("Diese Datei wurde nicht über BIT-Atelier geöffnet.".into());
    }
    Ok(echt)
}

/// The bytes of a file the user opened through the shell in this session.
#[tauri::command]
pub fn datei_lesen(zustand: State<DateiZustand>, pfad: String) -> Result<tauri::ipc::Response, String> {
    let echt = lesen_erlaubt(&zustand, &pfad)?;
    if fs::metadata(&echt).map(|m| m.len()).unwrap_or(0) > MAX_BYTES {
        return Err("Die Datei ist zu groß (über 64 MB).".into());
    }
    let bytes = fs::read(&echt).map_err(|e| format!("Datei nicht lesbar: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Size + mtime of a .bitproj path; null when it does not exist.
#[tauri::command]
pub fn datei_stand(pfad: String) -> Result<Option<DateiInfo>, String> {
    let p = pfad_pruefen(&pfad)?;
    if !p.is_file() {
        return Ok(None);
    }
    info(&p).map(Some)
}

/// Writes the raw request body to the .bitproj path in header `pfad` (hex);
/// header `neu` = "1" creates a new file (refused when it exists), else an
/// existing file is replaced (refused when it is missing).
#[tauri::command]
pub fn datei_schreiben(request: tauri::ipc::Request) -> Result<DateiInfo, String> {
    let tauri::ipc::InvokeBody::Raw(daten) = request.body() else {
        return Err("Rohdaten erwartet.".into());
    };
    let kopf = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let pfad = String::from_utf8(hex_dekodieren(&kopf("pfad").ok_or("Pfad fehlt.")?)?).map_err(|_| "Ungültige Pfadangabe.")?;
    let neu = kopf("neu").as_deref() == Some("1");
    let p = pfad_pruefen(&pfad)?;
    if !p.parent().map(|o| o.is_dir()).unwrap_or(false) {
        return Err("Der Ordner der Datei ist nicht vorhanden.".into());
    }
    if neu && p.exists() {
        return Err("Die Datei existiert bereits.".into());
    }
    if !neu && !p.is_file() {
        return Err("Die Datei ist nicht mehr vorhanden.".into());
    }
    if daten.len() as u64 > MAX_BYTES {
        return Err("Die Daten sind zu groß (über 64 MB).".into());
    }
    atomar_schreiben(&p, daten)?;
    info(&p)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_ordner(name: &str) -> PathBuf {
        let o = std::env::temp_dir().join(format!("bit-9310-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&o);
        fs::create_dir_all(&o).unwrap();
        o
    }

    #[test]
    fn picks_bitproj_arguments() {
        let args = vec!["BIT-Atelier.exe".into(), "--flag".into(), "a.BITPROJ".into(), "b.txt".into()];
        let cwd = Path::new("/home/nutzer");
        assert_eq!(aus_argumenten(&args, Some(cwd)), vec![cwd.join("a.BITPROJ")]);
    }

    #[test]
    fn path_rules() {
        assert!(pfad_pruefen("relativ.bitproj").is_err());
        let o = tmp_ordner("pfad");
        assert!(pfad_pruefen(o.join("x.txt").to_str().unwrap()).is_err());
        assert!(pfad_pruefen(o.join("..").join("x.bitproj").to_str().unwrap()).is_err());
        assert!(pfad_pruefen(o.join("x.bitproj").to_str().unwrap()).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn path_rule_104_10_local_drives_only() {
        assert_eq!(pfad_pruefen(r"\\server\share\x.bitproj").unwrap_err(), NETZWERK);
        assert_eq!(pfad_pruefen(r"\\?\UNC\server\share\x.bitproj").unwrap_err(), NETZWERK);
        assert_eq!(pfad_pruefen(r"\\?\C:\x.bitproj").unwrap_err(), GERAET);
        assert_eq!(pfad_pruefen(r"\\.\C:\x.bitproj").unwrap_err(), GERAET);
        assert!(pfad_pruefen(r"C:\Projekte\x.bitproj").is_ok());
        assert!(lokales_laufwerk(Path::new(r"\\?\C:\x.bitproj"), true).is_ok());
        let z = DateiZustand::default();
        assert!(!vormerken(&z, vec![PathBuf::from(r"\\server\share\x.bitproj")]));
        // Reading refuses a share or device path before the file system is asked.
        assert_eq!(lesen_erlaubt(&z, r"\\server.invalid\share\x.bitproj").unwrap_err(), NETZWERK);
        assert_eq!(lesen_erlaubt(&z, r"\\?\UNC\server.invalid\share\x.bitproj").unwrap_err(), NETZWERK);
        assert_eq!(lesen_erlaubt(&z, r"\\?\C:\x.bitproj").unwrap_err(), GERAET);
        assert_eq!(lesen_erlaubt(&z, r"C:\gibt-es-nicht-10410\x.bitproj").unwrap_err(), "Die Datei wurde nicht gefunden.");
    }

    #[cfg(windows)]
    #[test]
    fn path_rule_104_10_configured_folders() {
        assert!(kein_geraetepfad(Path::new(r"C:\Ablage")).is_ok());
        assert!(kein_geraetepfad(Path::new(r"\\nas\buero\Ablage")).is_ok());
        assert_eq!(kein_geraetepfad(Path::new(r"\\?\C:\Ablage")).unwrap_err(), GERAET);
        assert_eq!(kein_geraetepfad(Path::new(r"\\.\PhysicalDrive0")).unwrap_err(), GERAET);
    }

    #[test]
    fn hex_round_trip() {
        assert_eq!(hex_dekodieren("c3bc").unwrap(), "ü".as_bytes());
        assert!(hex_dekodieren("abc").is_err());
    }

    #[test]
    fn atomic_write_leaves_no_tmp_and_queue_reads_once() {
        let o = tmp_ordner("schreiben");
        let ziel = o.join("Haus.bitproj");
        atomar_schreiben(&ziel, b"eins").unwrap();
        atomar_schreiben(&ziel, b"zwei").unwrap();
        assert_eq!(fs::read(&ziel).unwrap(), b"zwei");
        assert!(!o.join("Haus.bitproj.tmp").exists());
        let z = DateiZustand::default();
        assert!(vormerken(&z, vec![ziel.clone(), o.join("fehlt.bitproj")]));
        assert_eq!(z.ausstehend.lock().unwrap().len(), 1);
        let _ = fs::remove_dir_all(&o);
    }
}
