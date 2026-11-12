import { LOADED_VERSION } from './app-version.js';

// Shows "v x" in the bottom-right corner. If the server has been updated since this page loaded, asks for a reload.
export async function showVersion() {
  const label = document.getElementById('version');
  label.textContent = `v${LOADED_VERSION}`;
  try {
    const res = await fetch('/version');
    const { version } = await res.json();
    if (version !== LOADED_VERSION) label.textContent = `v${LOADED_VERSION} · v${version} available, reload`;
  } catch {
    // Keep showing the loaded version if the server can't be reached.
  }
}
