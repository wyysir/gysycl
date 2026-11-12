"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearDrafts, deleteDraft, draftTab, listDrafts, readDraft, writeDraft, type DraftRecord } from "@/lib/client/draft-store";
import { installHistoryGuard } from "@/lib/client/history-guard";

type Protection = { dirty: boolean; busy: boolean; keep: () => Promise<boolean>; discard: () => Promise<boolean>; save?: () => Promise<boolean> };
type Context = { owner: string; tab: string; register: (value: Protection) => () => void; request: (action: () => void | Promise<void>, allowKeep?: boolean) => void };
const context = createContext<Context | null>(null);
export function LeaveProtectionProvider({ owner, children }: { owner: string; children: React.ReactNode }) {
  const router = useRouter(), pathname = usePathname();
  const [tab, setTab] = useState("");
  const active = useRef<Protection | null>(null);
  const pending = useRef<(() => void | Promise<void>) | null>(null);
  const [open, setOpen] = useState(false), [acting, setActing] = useState(false), [error, setError] = useState("");
  const [ui, setUi] = useState({ busy: false, save: false });
  const [allowKeep, setAllowKeep] = useState(true);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const dialog = useRef<HTMLElement>(null), focus = useRef<HTMLElement | null>(null);
  const register = useCallback((value: Protection) => { active.current = value; setUi(old => old.busy === value.busy && old.save === !!value.save ? old : { busy: value.busy, save: !!value.save }); return () => { if (active.current === value) active.current = null; }; }, []);
  const request = useCallback((action: () => void | Promise<void>, keep = true) => {
    if (!active.current?.dirty && !active.current?.busy) { Promise.resolve().then(action).catch(() => window.alert("操作失败，请重试。")); return; }
    // Repeated Back presses keep the first destination and never stack dialogs.
    if (pending.current) return;
    focus.current = window.document.activeElement as HTMLElement;
    pending.current = action; setAllowKeep(keep); setError(""); setOpen(true);
  }, []);
  const cancel = useCallback(() => { pending.current = null; setOpen(false); setError(""); focus.current?.focus(); }, []);
  // A completed upload can navigate while a busy-state leave dialog is open.
  useEffect(() => { pending.current = null; setOpen(false); setError(""); }, [pathname]);
  useLayoutEffect(() => {
    setTab(draftTab());
    return installHistoryGuard(() => !!(active.current?.dirty || active.current?.busy || pending.current), request);
  }, [request]);
  useEffect(() => {
    if (!tab) return;
    let current = true;
    clearDrafts(owner, true).then(() => listDrafts(owner, tab)).then(rows => { if (current) setDrafts(rows); }).catch(() => {});
    return () => { current = false; };
  }, [owner, tab, pathname]);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (!active.current?.dirty && !active.current?.busy) return;
      const anchor = (event.target as Element)?.closest?.("a");
      if (!(anchor instanceof HTMLAnchorElement) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || anchor.target && anchor.target !== "_self" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === location.pathname && url.search === location.search) return;
      event.preventDefault(); event.stopPropagation(); request(() => router.push(url.pathname + url.search + url.hash));
    };
    const before = (event: BeforeUnloadEvent) => {
      if (active.current?.dirty || active.current?.busy) { event.preventDefault(); event.returnValue = ""; }
    };
    window.document.addEventListener("click", click, true); window.addEventListener("beforeunload", before);
    return () => { window.document.removeEventListener("click", click, true); window.removeEventListener("beforeunload", before); };
  }, [request, router]);
  useEffect(() => {
    if (!open) return;
    const previous = window.document.body.style.overflow; window.document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !acting) { event.preventDefault(); cancel(); }
      if (event.key !== "Tab") return;
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => { window.document.body.style.overflow = previous; window.removeEventListener("keydown", key); };
  }, [open, acting, cancel]);
  async function leave(mode: "keep" | "discard" | "save") {
    const protection = active.current, action = pending.current;
    if (!protection || !action || protection.busy || acting) return;
    setActing(true); setError("");
    try {
      const ok = await (mode === "save" ? protection.save?.() : protection[mode]());
      if (!ok) { setError("未能完成操作，内容已保留，请重试或继续编辑。"); return; }
      active.current = null; pending.current = null; setOpen(false);
      await action();
    } catch { setError("操作失败，内容仍在当前页面，请重试。"); }
    finally { setActing(false); }
  }
  const value = useMemo(() => ({ owner, tab, register, request }), [owner, tab, register, request]);
  const otherDrafts = drafts.filter(row => row.scope !== pathname);
  return <context.Provider value={value}>
    {otherDrafts.length > 0 && <aside className="notice recovery-banner" role="status">有未提交的恢复副本：{otherDrafts.map(row => <Link key={row.key} href={row.scope}>{row.scope === "/upload" ? "继续录入" : "继续核对单据"}</Link>)}</aside>}
    {children}
    {open && <div className="modal-backdrop"><section ref={dialog} className="modal-card leave-dialog" role="dialog" aria-modal="true" aria-label="未保存的内容">
      <h2>有未保存的内容</h2><p>{allowKeep ? "取消可继续编辑；暂存后离开可在此浏览器、此标签页恢复，最长保留12小时。" : "退出登录将清除当前账号的恢复副本。请先保存，或明确放弃修改后退出。"}</p>
      {ui.busy && <p role="status">正在保存或上传，请等待完成后再离开。</p>}
      {error && <p className="text-danger" role="alert">{error}</p>}
      <div className="modal-actions"><button className="btn btn--outline" disabled={acting} onClick={cancel}>取消</button>
        {allowKeep && <button className="btn btn--outline" disabled={acting || ui.busy} onClick={() => leave("keep")}>暂存并离开</button>}
        <button className="btn btn--danger" disabled={acting || ui.busy} onClick={() => leave("discard")}>放弃修改并离开</button>
        {ui.save && <button className="btn btn--primary" disabled={acting || ui.busy} onClick={() => leave("save")}>保存并离开</button>}
      </div>
    </section></div>}
  </context.Provider>;
}
function useProtectionContext() { const value = useContext(context); if (!value) throw new Error("LeaveProtectionProvider is required"); return value; }
export function useProtectedNavigation() { return useProtectionContext().request; }
export function useLeaveProtection(value: Protection) { const { register } = useProtectionContext(); useLayoutEffect(() => register(value), [register, value]); }
export function useLocalDraft<T>(scope: string) {
  const { owner, tab } = useProtectionContext();
  const [draft, setDraft] = useState<DraftRecord<T> | null>(null), [loadedKey, setLoadedKey] = useState(""), [error, setError] = useState("");
  const key = JSON.stringify([owner, tab, scope]);
  useEffect(() => {
    if (!tab) return;
    let current = true;
    readDraft<T>(owner, tab, scope).then(value => { if (current) setDraft(value); }).catch(() => { if (current) { setDraft(null); setError("浏览器无法读取恢复副本，请勿直接关闭页面。"); } }).finally(() => { if (current) setLoadedKey(key); });
    return () => { current = false; };
  }, [owner, tab, scope, key]);
  const write = useCallback(async (value: T) => {
    try { if (!tab) return false; await writeDraft(owner, tab, scope, value); setError(""); return true; }
    catch { setError("浏览器暂存失败，请保持本页打开并先保存或上传；当前内容仍在页面中。"); return false; }
  }, [owner, tab, scope]);
  const clear = useCallback(async () => {
    try { await deleteDraft(owner, tab, scope); setDraft(null); setError(""); return true; }
    catch { setError("清理恢复副本失败，请重试。"); return false; }
  }, [owner, tab, scope]);
  return { owner, ready: !!tab && loadedKey === key, draft, write, clear, error };
}
