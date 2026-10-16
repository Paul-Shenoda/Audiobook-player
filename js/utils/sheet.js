/**
 * A modal bottom sheet: dim backdrop, a dialog panel, Escape or a backdrop tap
 * closes it, Tab stays inside it, and focus goes back to whatever opened it.
 * The caller fills `panel` and calls `focus()` once it has content.
 *
 * @param {{
 *   label: string,
 *   className?: string,
 *   opener?: Element|null,
 *   onClose?: () => void,
 * }} options
 */
export function openSheet({ label, className = '', opener = document.activeElement, onClose }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'ns-backdrop';
  const panel = document.createElement('div');
  panel.className = `ns-sheet ${className}`.trim();
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', label);
  panel.tabIndex = -1;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  let closed = false;

  function focusables() {
    return [...panel.querySelectorAll('button:not([disabled]), [tabindex="0"]')];
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      const items = focusables();
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeydown, true);

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    backdrop.remove();
    if (opener?.isConnected) opener.focus();
    onClose?.();
  }

  return {
    panel,
    close,
    /** Move focus into the sheet: the given element, else the first control, else the panel. */
    focus(target) {
      (target ?? focusables()[0] ?? panel).focus();
    },
  };
}
