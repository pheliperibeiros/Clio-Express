// Clio - Desktop entry point (Tauri v2)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub fn main() {
    clio_lib::run()
}
