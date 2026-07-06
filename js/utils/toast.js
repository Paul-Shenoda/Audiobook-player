/** @type {number|null} */
let hideTimer = null;

/**
 * @param {string} message
 * @param {'info'|'success'|'error'} [type='info']
 * @param {number} [durationMs=4000]
 * @param {{ label: string, onClick: () => void }} [action] optional button
 */
export function showToast(message, type = 'info', durationMs = 4000, action) {
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

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      el.classList.remove('app-toast--visible');
      action.onClick();
    });
    el.appendChild(btn);
  }

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    el.classList.remove('app-toast--visible');
  }, durationMs);
}
