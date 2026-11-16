import { toast } from './state.js';
import { connect } from './net.js';
import { render } from './views.js';
import { showVersion } from './version.js';
import { t } from './i18n.js';
import './settings-dialog.js';

// Surface script errors in the UI so a broken animation or render never fails silently.
window.addEventListener('error', (e) => toast(t('toast.scriptError', { message: e.message })));
window.addEventListener('unhandledrejection', (e) => toast(t('toast.scriptError', { message: e.reason?.message || e.reason })));

document.addEventListener('fullscreenchange', render);

render();
connect();
showVersion();
