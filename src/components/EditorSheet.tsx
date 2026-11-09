"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/** Presentation only: edits remain in the owning document, including after closing. */
export function EditorSheet({ title, onClose, children, initialField, className = "" }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  initialField?: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const sheet = root.current;
    const focus = initialField ? sheet?.querySelector<HTMLElement>(`[data-edit-field="${initialField}"] input:not(:disabled)`) : null;
    (focus || sheet?.querySelector<HTMLElement>(".sheet-close"))?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      // Nested material/image dialogs own the keyboard while they are on top.
      const layers = [...document.querySelectorAll<HTMLElement>(".modal-backdrop")].filter(el => el.getClientRects().length);
      if (layers.at(-1) !== sheet) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); }
      if (event.key === "Tab") {
        const controls = [...sheet.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const sync = () => { const v = window.visualViewport; if (v) setViewport({ top: v.offsetTop, height: v.height }); };
    sync();
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [initialField]);

  return <div ref={root} className="modal-backdrop editor-sheet-backdrop" style={viewport ? { top: viewport.top, height: viewport.height, bottom: "auto" } : undefined}
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal-card editor-sheet ${className}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="editor-sheet-head"><h2>{title}</h2><button className="icon-button sheet-close" type="button" aria-label="关闭编辑面板" onClick={onClose}><X size={20} /></button></header>
      {children}
    </section>
  </div>;
}
