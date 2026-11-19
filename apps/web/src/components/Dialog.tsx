import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { errorText } from '../lib/vault';

export function Dialog({
  title,
  sub,
  wide,
  onClose,
  children,
}: {
  title: string;
  sub?: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    ref.current?.addEventListener('keydown', onKey);
    const node = ref.current;
    return () => {
      node?.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={wide ? 'dialog wide' : 'dialog'} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A one-field dialog for names: add a unit, rename, new folder. */
export function PromptDialog({
  title,
  label,
  initial = '',
  confirm = 'Save',
  sub,
  multiline,
  allowEmpty,
  maxLength = 200,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  confirm?: string;
  sub?: string;
  /** A text area, for notes. */
  multiline?: boolean;
  /** Submit is allowed with nothing typed. */
  allowEmpty?: boolean;
  maxLength?: number;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} sub={sub} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value.trim() && !allowEmpty) return;
          setBusy(true);
          setError(null);
          try {
            await onSubmit(value.trim());
            onClose();
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>{label}</span>
          {multiline ? (
            <textarea className="input" rows={5} value={value} onChange={(e) => setValue(e.target.value)} maxLength={maxLength} />
          ) : (
            <input className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={maxLength} />
          )}
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn pri" disabled={busy || (!allowEmpty && !value.trim())}>
            {confirm}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirm,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirm: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={title} sub={message} onClose={onClose}>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? 'btn danger' : 'btn pri'}
          onClick={async () => {
            try {
              await onConfirm();
              onClose();
            } catch (err) {
              setError(errorText(err));
            }
          }}
        >
          {confirm}
        </button>
      </div>
    </Dialog>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

/** A right-click menu, placed at the pointer and kept on screen. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: (MenuItem | 'sep')[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
      el.querySelector<HTMLElement>('button')?.focus();
    }
    const close = (e: Event) => {
      if (!el?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [x, y, onClose]);
  return createPortal(
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((item, i) =>
        item === 'sep' ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={item.danger ? 'danger' : undefined}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
