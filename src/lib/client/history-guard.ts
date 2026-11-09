const marker = "__deliveryHistory";
type Entry = { session: string; index: number };
function entry(state: unknown): Entry | undefined {
  const value = (state as Record<string, Entry> | null)?.[marker];
  return value && typeof value.session === "string" && Number.isSafeInteger(value.index) ? value : undefined;
}

// Tag real entries, without adding sentinel entries or modifying Next's router fields.
// popstate is not cancellable: suspend the router, return to the original entry,
// then ask. On confirmation replay exactly the requested history delta once.
export function installHistoryGuard(blocked: () => boolean, ask: (proceed: () => void) => void) {
  const history = window.history;
  let current = entry(history.state) || { session: crypto.randomUUID(), index: 0 };
  let restoring: { home: Entry; target: Entry } | null = null;
  let permitted: Entry | null = null;
  let restoreTimer: ReturnType<typeof setTimeout> | undefined;
  history.replaceState({ ...history.state, [marker]: current }, "");
  let disposed = false, restoreMethods = () => {};
  function restored() {
    if (!restoring) return;
    clearTimeout(restoreTimer);
    const { home, target } = restoring;
    restoring = null;
    const proceed = () => { permitted = target; history.go(target.index - home.index); };
    if (blocked()) ask(proceed); else proceed();
  }
  function scheduleRestore() {
    clearTimeout(restoreTimer);
    // Coalesce rapid gestures. A second traversal can cancel an already queued
    // history.go; calculate from the browser's actual entry after it settles.
    restoreTimer = setTimeout(() => {
      if (!restoring || disposed) return;
      const actual = entry(history.state);
      if (!actual || actual.session !== restoring.home.session) return;
      if (actual.index === restoring.home.index) { restored(); return; }
      history.go(restoring.home.index - actual.index);
      scheduleRestore();
    }, 80);
  }
  // Register popstate during layout, before Next's passive router listener.
  // Wrap push/replace after Next installs its own methods.
  queueMicrotask(() => {
    if (disposed) return;
    const originalPush = history.pushState, originalReplace = history.replaceState;
    const push: History["pushState"] = function (data, unused, url) {
      const next = { ...current, index: current.index + 1 };
      originalPush.call(history, { ...data, [marker]: next }, unused, url);
      current = next;
    };
    const replace: History["replaceState"] = function (data, unused, url) {
      originalReplace.call(history, { ...data, [marker]: entry(history.state) || current }, unused, url);
    };
    history.pushState = push; history.replaceState = replace;
    restoreMethods = () => {
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace) history.replaceState = originalReplace;
    };
  });
  const pop = (event: PopStateEvent) => {
    const target = entry(event.state);
    // Unknown/cross-document entries are covered by beforeunload and recovery.
    if (!target || target.session !== current.session) {
      if (!restoring) current = target || { session: crypto.randomUUID(), index: 0 };
      return;
    }
    if (restoring) {
      event.stopImmediatePropagation();
      if (target.index !== restoring.home.index) scheduleRestore();
      else restored();
      return;
    }
    if (permitted?.index === target.index) { permitted = null; current = target; return; }
    const delta = current.index - target.index;
    if (delta && blocked()) {
      event.stopImmediatePropagation();
      restoring = { home: current, target };
      scheduleRestore();
    } else current = target;
  };
  window.addEventListener("popstate", pop, true);
  return () => {
    window.removeEventListener("popstate", pop, true);
    disposed = true; clearTimeout(restoreTimer); restoreMethods();
  };
}
