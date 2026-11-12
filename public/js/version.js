// Keep in sync with "version" in package.json (test/server.test.js checks this).
export const CLIENT_VERSION = '0.1.0';

// Shows "client x / server y" in the bottom-right corner; the server version comes from GET /version.
export async function showVersions() {
  const label = document.getElementById('version');
  const text = (server) => `client v${CLIENT_VERSION} · server ${server}`;
  label.textContent = text('…');
  try {
    const res = await fetch('/version');
    const { version } = await res.json();
    label.textContent = text(`v${version}`);
  } catch {
    label.textContent = text('unknown');
  }
}
