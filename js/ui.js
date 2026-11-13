/* ==========================================================================
   RRMS — UI primitives: escaping, toasts, accessible modals, copy helpers
   ========================================================================== */
(function () {
  'use strict';

  window.RRMS = window.RRMS || {};

  var lastFocused = null;
  var activeModal = null;

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toastStack() {
    var stack = document.getElementById('toastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'toastStack';
      stack.className = 'toast-stack';
      stack.setAttribute('aria-live', 'polite');
      stack.setAttribute('aria-atomic', 'false');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type, duration) {
    var stack = toastStack();
    var variant = type || 'success';
    var node = document.createElement('div');
    node.className = 'toast toast-' + variant;
    node.setAttribute('role', 'status');
    var iconName = variant === 'success' ? 'checkout' : variant === 'error' ? 'warning' : 'info';
    node.innerHTML = '<span class="toast-icon">' + RRMS.Icons.svg(iconName, 20) + '</span>' +
      '<span class="toast-message">' + esc(message) + '</span>' +
      '<button type="button" class="toast-close" aria-label="Close">' + RRMS.Icons.svg('x', 16) + '</button>';
    stack.appendChild(node);
    var timeout = window.setTimeout(remove, duration || 3600);
    function remove() {
      window.clearTimeout(timeout);
      if (!node.parentNode) return;
      node.classList.add('toast-leaving');
      window.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 180);
    }
    node.querySelector('.toast-close').addEventListener('click', remove);
    return remove;
  }

  function trapFocus(event, container) {
    if (event.key !== 'Tab') return;
    var focusable = container.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    var visible = Array.prototype.filter.call(focusable, function (node) {
      return node.offsetWidth > 0 || node.offsetHeight > 0 || node === document.activeElement;
    });
    if (!visible.length) return;
    var first = visible[0];
    var last = visible[visible.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function closeModal() {
    if (!activeModal) return;
    var modal = activeModal;
    activeModal = null;
    document.removeEventListener('keydown', modal.onKeydown);
    modal.overlay.classList.add('is-closing');
    window.setTimeout(function () {
      if (modal.overlay.parentNode) modal.overlay.parentNode.removeChild(modal.overlay);
    }, 160);
    document.body.classList.remove('modal-open');
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    lastFocused = null;
    if (typeof modal.onClose === 'function') modal.onClose();
  }

  function modal(options) {
    if (activeModal) closeModal();
    lastFocused = document.activeElement;
    var opts = options || {};
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay' + (opts.variant === 'sheet' ? ' sheet-overlay' : '');
    var dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-' + (opts.size || 'md') +
      (opts.variant === 'sheet' ? ' modal-sheet' : '');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'modalTitle');
    var kicker = opts.kicker
      ? '<p class="modal-kicker">' + esc(opts.kicker) + '</p>'
      : '';
    var subtitle = opts.subtitle
      ? '<p class="modal-subtitle">' + esc(opts.subtitle) + '</p>'
      : '';

    dialog.innerHTML =
      '<div class="modal-header">' +
        '<div class="modal-heading">' + kicker +
          '<h2 class="modal-title" id="modalTitle">' + esc(opts.title || '') + '</h2>' +
          subtitle +
        '</div>' +
        '<button type="button" class="icon-button modal-close" aria-label="Close">' +
          RRMS.Icons.svg('x', 20) +
        '</button>' +
      '</div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      (opts.footer ? '<div class="modal-footer">' + opts.footer + '</div>' : '');

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');

    var onKeydown = function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
      } else {
        trapFocus(event, dialog);
      }
    };
    document.addEventListener('keydown', onKeydown);

    overlay.addEventListener('mousedown', function (event) {
      if (event.target === overlay) closeModal();
    });
    dialog.querySelector('.modal-close').addEventListener('click', closeModal);

    activeModal = {
      overlay: overlay,
      dialog: dialog,
      onKeydown: onKeydown,
      onClose: opts.onClose
    };

    var focusTarget = dialog.querySelector('[data-autofocus]') ||
      dialog.querySelector('.modal-close');
    if (focusTarget) window.setTimeout(function () { focusTarget.focus(); }, 30);

    if (typeof opts.onOpen === 'function') opts.onOpen(dialog);
    return { close: closeModal, dialog: dialog, body: dialog.querySelector('.modal-body'), footer: dialog.querySelector('.modal-footer') };
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (err) {
      return false;
    }
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  function statusBadge(status, t) {
    var key = 'status.' + status;
    return '<span class="status-badge status-' + esc(status) + '">' +
      '<span class="status-dot"></span>' + esc(t(key)) + '</span>';
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2);
    return parts[0].charAt(0) + parts[parts.length - 1].charAt(0);
  }

  function languageText(pathBase, km, en) {
    return RRMS.I18n.getLanguage() === 'en' ? en : km;
  }

  RRMS.UI = {
    esc: esc,
    toast: toast,
    modal: modal,
    closeModal: closeModal,
    copy: copy,
    debounce: debounce,
    statusBadge: statusBadge,
    initials: initials,
    languageText: languageText
  };
})();
