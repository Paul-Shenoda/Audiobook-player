/** @type {number|null} */
let hideTimer = null;

/**
 * @param {string} message
 * @param {'info'|'success'|'error'} [type='info']
 * @param {number} [durationMs=4000]
 */
export function showToast(message, type = 'info', durationMs = 4000) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'app-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }

  el.textContent = message;
  el.className = `app-toast app-toast--${type} app-toast--visible`;

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    el.classList.remove('app-toast--visible');
  }, durationMs);
}
