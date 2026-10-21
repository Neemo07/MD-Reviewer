/**
 * Modal dialogs: confirmations and single line prompts.
 */
function buildModal(inner) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.appendChild(inner);
  document.body.appendChild(backdrop);
  return backdrop;
}

/**
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <h2></h2>
      <p></p>
      <div class="modal-actions">
        <button type="button" class="btn" data-role="cancel"></button>
        <button type="button" class="btn" data-role="confirm"></button>
      </div>`;
    modal.querySelector('h2').textContent = title;
    modal.querySelector('p').textContent = message ?? '';
    const cancelBtn = modal.querySelector('[data-role="cancel"]');
    const confirmBtn = modal.querySelector('[data-role="confirm"]');
    cancelBtn.textContent = cancelLabel;
    confirmBtn.textContent = confirmLabel;
    if (danger) confirmBtn.classList.add('danger');

    const backdrop = buildModal(modal);
    const done = (value) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); done(false); }
      if (event.key === 'Enter') { event.preventDefault(); done(true); }
    };
    cancelBtn.addEventListener('click', () => done(false));
    confirmBtn.addEventListener('click', () => done(true));
    backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) done(false); });
    document.addEventListener('keydown', onKey, true);
    confirmBtn.focus();
  });
}

/**
 * @returns {Promise<string|null>} the trimmed value, or null when cancelled
 */
export function promptDialog({ title, message = '', label = 'Name', value = '', confirmLabel = 'Create', validate }) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <h2></h2>
      <p></p>
      <input type="text" />
      <div class="modal-error" style="color:var(--danger);font-size:12px;margin-top:6px;min-height:14px;"></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-role="cancel"></button>
        <button type="button" class="btn primary" data-role="confirm"></button>
      </div>`;
    modal.querySelector('h2').textContent = title;
    modal.querySelector('p').textContent = message;
    modal.querySelector('p').style.display = message ? '' : 'none';
    const input = modal.querySelector('input');
    const errorEl = modal.querySelector('.modal-error');
    const cancelBtn = modal.querySelector('[data-role="cancel"]');
    const confirmBtn = modal.querySelector('[data-role="confirm"]');
    cancelBtn.textContent = 'Cancel';
    confirmBtn.textContent = confirmLabel;
    input.value = value;

    const backdrop = buildModal(modal);
    const done = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const submit = () => {
      const raw = input.value.trim();
      const error = validate ? validate(raw) : null;
      if (error) {
        errorEl.textContent = error;
        input.focus();
        return;
      }
      done(raw || null);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); done(null); }
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
    };
    cancelBtn.addEventListener('click', () => done(null));
    confirmBtn.addEventListener('click', submit);
    backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) done(null); });
    document.addEventListener('keydown', onKey, true);
    input.focus();
    input.select();
  });
}

/** Transient notification in the bottom right corner. */
export function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`.trim();
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}
