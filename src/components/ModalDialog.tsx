import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}

// `closedby` is a newer <dialog> attribute that React's DOM types do not know yet.
const CLOSED_BY_ANY = { closedby: 'any' } as React.HTMLAttributes<HTMLDialogElement>;

export const ModalDialog: React.FC<ModalDialogProps> = ({ open, onClose, title, wide, children }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      dialog.returnValue = '';
      onClose();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  // Fallback for browsers without native closedby="any" support
  const pressedOutsideRef = useRef(false);
  const isOutside = (e: React.PointerEvent<HTMLDialogElement>) => {
    const d = dialogRef.current;
    if (!d) return false;
    const r = d.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...CLOSED_BY_ANY}
      onPointerDown={(e) => {
        if (!('closedBy' in HTMLDialogElement.prototype)) {
          pressedOutsideRef.current = isOutside(e);
        }
      }}
      onPointerUp={(e) => {
        if (!('closedBy' in HTMLDialogElement.prototype) && pressedOutsideRef.current && isOutside(e)) {
          dialogRef.current?.close();
        }
      }}
      className={`m-auto rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-surface)] text-[var(--ac-ink)] shadow-2xl p-0 ${
        wide ? 'w-[min(1040px,calc(100vw-2rem))]' : 'w-[min(640px,calc(100vw-2rem))]'
      } max-h-[calc(100vh-3rem)] overflow-hidden`}
    >
      <div className="flex flex-col max-h-[calc(100vh-3rem)]">
        <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-[var(--ac-line)] bg-[var(--ac-surface-2)]">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight m-0">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[var(--ac-muted)] hover:text-[var(--ac-ink)] hover:bg-[var(--ac-surface)] border border-transparent hover:border-[var(--ac-line)] cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </dialog>
  );
};
