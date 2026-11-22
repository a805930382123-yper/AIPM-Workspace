import { useEffect, useRef } from 'react';

/** Keep focus inside an existing dialog without changing how it closes. */
export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const { ownerDocument } = dialog;
    const ownerWindow = ownerDocument.defaultView;
    const trigger = ownerDocument.activeElement;
    const focusable = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => node.getClientRects().length > 0);
    (dialog.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ?? focusable()[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0],
        last = items[items.length - 1];
      const active = ownerDocument.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      if (ownerWindow && trigger instanceof ownerWindow.HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return ref;
}
