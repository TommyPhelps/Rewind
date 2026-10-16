// Browser-preview stand-ins for the Tauri modules. Never part of the desktop build:
// in the real app these imports resolve to @tauri-apps/* and talk to Rust.
export async function invoke(): Promise<never> { throw new Error("Not running inside the REWIND desktop app."); }
export async function open() { return null; }
export async function save() { return null; }
export async function openUrl(url: string) { window.open(url, "_blank"); }
export function getCurrentWindow() { throw new Error("no window"); }
export async function availableMonitors() { return []; }
export function convertFileSrc(p: string) { return p; }
