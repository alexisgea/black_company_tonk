import { LOADED_VERSION } from './app-version.js';

// Shows "v x" in the bottom-right corner. If the server has been updated since this page loaded, asks for a reload.
export async function showVersion() {
  const label = document.getElementById('version');
  label.textContent = `v${LOADED_VERSION}`;
  try {
    const res = await fetch('/version');
    const { version } = await res.json();
    if (version !== LOADED_VERSION) {
      label.textContent = `v${LOADED_VERSION} · v${version} available, click to reload`;
      label.classList.add('update');
      label.addEventListener('click', () => {
        // Navigating to a unique URL bypasses any stale cached copy of the page; the modules then revalidate too.
        const url = new URL(location.href);
        url.searchParams.set('v', version);
        location.replace(url);
      });
    }
  } catch {
    // Keep showing the loaded version if the server can't be reached.
  }
}
