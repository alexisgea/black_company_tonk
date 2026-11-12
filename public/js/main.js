import { toast } from './state.js';
import { connect } from './net.js';
import { render } from './views.js';
import { showVersions } from './version.js';

// Surface script errors in the UI so a broken animation or render never fails silently.
window.addEventListener('error', (e) => toast(`Script error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => toast(`Script error: ${e.reason?.message || e.reason}`));

render();
connect();
showVersions();
