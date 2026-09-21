import React, { useEffect, useId, useRef } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldAlert, X } from 'lucide-react';

export type ConfirmDialogTone = 'danger' | 'warning' | 'primary';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  eyebrow?: string;
  subject?: string;
  tone?: ConfirmDialogTone;
  loading?: boolean;
  error?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  eyebrow = '操作确认',
  subject,
  tone = 'danger',
  loading = false,
  error,
  onConfirm,
  onCancel
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCancelRef = useRef(onCancel);
  const loadingRef = useRef(loading);
  onCancelRef.current = onCancel;
  loadingRef.current = loading;

  useEffect(() => {
    if (!open) return;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loadingRef.current) onCancelRef.current();
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const ToneIcon = tone === 'primary' ? CheckCircle2 : tone === 'warning' ? AlertTriangle : ShieldAlert;

  return (
    <div
      className="confirm-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className={`confirm-dialog confirm-dialog-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="confirm-dialog-signal" />
        <header className="confirm-dialog-header">
          <div className="confirm-dialog-icon" aria-hidden="true">
            <ToneIcon size={22} />
          </div>
          <div className="confirm-dialog-heading">
            <span>{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="confirm-dialog-close"
            aria-label="关闭确认框"
            disabled={loading}
            onClick={onCancel}
          >
            <X size={17} />
          </button>
        </header>

        <div className="confirm-dialog-body">
          <p id={descriptionId}>{description}</p>
          {subject && (
            <div className="confirm-dialog-subject">
              <span>操作对象</span>
              <strong>{subject}</strong>
            </div>
          )}
          {error && (
            <div className="confirm-dialog-error" role="alert">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="confirm-dialog-actions">
          {cancelLabel ? (
            <button
              ref={cancelButtonRef}
              type="button"
              className="btn-secondary"
              disabled={loading}
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={`confirm-dialog-confirm confirm-dialog-confirm-${tone}`}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading && <LoaderCircle size={16} className="spin-icon" />}
            {loading ? '正在处理…' : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
};
