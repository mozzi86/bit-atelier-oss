// Entry point of the desktop shell. All setup lives in lib.rs (`run`), so the
// same code can later serve a mobile target.

// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bit_atelier_client_lib::run()
}
