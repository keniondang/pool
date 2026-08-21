// Toasts, confirm dialogs and form modals.
//
// The rule these follow: interrupt only when an action is rare,
// irreversible and consequential. Frequent actions get an undo instead,
// because a confirm you see fifty times stops being read.

import { paintIcons } from './icons.js';
import { wireMoney, money, fmt } from './utils.js';

let toastTimer = null;

function root() {
  let el = document.getElementById('ui-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ui-root';
    document.body.appendChild(el);
  }
  return el;
}

// ---------------------------------------------------------------- toast

/**
 * Non-blocking bar at the bottom. If onUndo is given it shows an Undo
 * button; pressing it cancels the action and stops the timer.
 */
export function toast(message, onUndo, ms = 5000) {
  clearTimeout(toastTimer);
  const host = root();
  const old = host.querySelector('.toast');
  if (old) old.remove();

  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML =
    '<span class="tmsg">' + message + '</span>' +
    (onUndo ? '<button class="tundo">Undo</button>' : '');
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));

  const close = () => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 200);
  };

  if (onUndo) {
    el.querySelector('.tundo').onclick = () => {
      clearTimeout(toastTimer);
      close();
      onUndo();
    };
  }
  toastTimer = setTimeout(close, ms);
}

// ---------------------------------------------------------------- modal shell

function openModal(inner, { onOpen, onClose } = {}) {
  const host = root();
  const wrap = document.createElement('div');
  wrap.className = 'modal-overlay';
  wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + inner + '</div>';
  host.appendChild(wrap);
  paintIcons();
  requestAnimationFrame(() => wrap.classList.add('in'));

  const close = () => {
    wrap.classList.remove('in');
    setTimeout(() => wrap.remove(), 180);
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);

  // tapping the backdrop dismisses, tapping the card does not
  wrap.onclick = e => { if (e.target === wrap) close(); };

  if (onOpen) onOpen(wrap, close);
  return close;
}

// ---------------------------------------------------------------- confirm

/**
 * Blocking yes/no. `body` should state the consequence, not just ask
 * the question, so the answer is informed rather than reflexive.
 */
export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false, onYes }) {
  openModal(
    '<div class="modal-title">' + title + '</div>' +
    '<div class="modal-body">' + body + '</div>' +
    '<div class="modal-actions">' +
      '<button class="btn outline mcancel">Cancel</button>' +
      '<button class="btn ' + (danger ? 'danger-solid' : 'solid') + ' mok">' + confirmLabel + '</button>' +
    '</div>',
    {
      onOpen(wrap, close) {
        wrap.querySelector('.mcancel').onclick = close;
        wrap.querySelector('.mok').onclick = () => { close(); onYes(); };
      }
    }
  );
}

// ---------------------------------------------------------------- form modal

/**
 * fields: [{ id, label, placeholder, money: bool, value,
 *            select: [{ value, label }] }]
 * onSubmit receives an object keyed by field id. Money fields arrive as ints.
 * Return a string to show it as an error and keep the modal open.
 */
export function formModal({ title, body, fields, submitLabel = 'Add', onSubmit }) {
  const inputs = fields.map(f => {
    const label = '<label class="flabel" for="mf-' + f.id + '">' + f.label + '</label>';
    if (f.select) {
      return label + '<select id="mf-' + f.id + '">' +
        f.select.map(o =>
          '<option value="' + o.value + '"' +
          (String(o.value) === String(f.value) ? ' selected' : '') + '>' +
          o.label + '</option>').join('') +
        '</select>';
    }
    return label +
      '<input id="mf-' + f.id + '" class="' + (f.money ? 'money' : '') + '" type="text" ' +
      'placeholder="' + (f.placeholder || '') + '" value="' + (f.value || '') + '" />';
  }).join('');

  openModal(
    '<div class="modal-title">' + title + '</div>' +
    (body ? '<div class="modal-body" style="margin-bottom:4px;">' + body + '</div>' : '') +
    '<div class="modal-form">' + inputs + '</div>' +
    '<div class="modal-err" id="modal-err"></div>' +
    '<div class="modal-actions">' +
      '<button class="btn outline mcancel">Cancel</button>' +
      '<button class="btn solid mok">' + submitLabel + '</button>' +
    '</div>',
    {
      onOpen(wrap, close) {
        wireMoney();
        const first = wrap.querySelector('input');
        if (first) setTimeout(() => first.focus(), 60);

        const submit = () => {
          const out = {};
          fields.forEach(f => {
            const el = wrap.querySelector('#mf-' + f.id);
            out[f.id] = f.money ? money(el.value) : el.value.trim();
          });
          const err = onSubmit(out);
          if (err) {
            wrap.querySelector('#modal-err').textContent = err;
            return;
          }
          close();
        };

        wrap.querySelector('.mcancel').onclick = close;
        wrap.querySelector('.mok').onclick = submit;
        wrap.querySelectorAll('input').forEach(i => {
          i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        });
      }
    }
  );
}


// ---------------------------------------------------------------- sheet

/**
 * Full-height bottom sheet whose body can re-render in place. Used for
 * logging, which stays open across several entries so a till run is one
 * sheet and three taps rather than three round trips.
 */
export function openSheet({ header, body, onMount }) {
  const host = root();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-overlay';
  wrap.innerHTML =
    '<div class="sheet" role="dialog" aria-modal="true">' +
      '<div class="sheet-head" id="sheet-head">' + header + '</div>' +
      '<div class="sheet-body" id="sheet-body">' + body + '</div>' +
    '</div>';
  host.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));

  const api = {
    close() {
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 200);
      document.removeEventListener('keydown', onKey);
    },
    setHeader(html) {
      wrap.querySelector('#sheet-head').innerHTML = html;
      if (onMount) onMount(wrap, api);
    },
    setBody(html) {
      wrap.querySelector('#sheet-body').innerHTML = html;
      if (onMount) onMount(wrap, api);
    },
    el: wrap
  };

  function onKey(e) { if (e.key === 'Escape') api.close(); }
  document.addEventListener('keydown', onKey);
  wrap.onclick = e => { if (e.target === wrap) api.close(); };

  if (onMount) onMount(wrap, api);
  return api;
}
