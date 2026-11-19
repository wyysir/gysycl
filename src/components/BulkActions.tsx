"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { EditorSheet } from "./EditorSheet";
import { useToast } from "./ToastProvider";

type Row = { id: string; name: string; updatedAt: string };
type Action = "enable" | "disable" | "delete";
const verbs = { enable: "启用", disable: "停用", delete: "删除" };
const effects = {
  supplier: "删除资料及别名；有单据或合同价时禁止删除。",
  project: "删除项目点及该项目授权，员工账号保留；有单据、合同价、营业额或上传批次时禁止删除。",
  user: "逻辑删除账号，立即禁止登录；历史单据、审核、营业额归属和微信绑定保留，历史员工号不能重复使用。",
};
export function BulkActions<T extends Row>({ rows, selected, onSelect, kind, endpoint, onChange, currentUserId }: { rows: T[]; selected: string[]; onSelect: (ids: string[]) => void; kind: keyof typeof effects; endpoint: string; onChange: () => Promise<void>; currentUserId?: string }) {
  const { showToast } = useToast();
  const [action, setAction] = useState<Action | null>(null), [targets, setTargets] = useState<T[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const eligible = rows.filter(row => row.id !== currentUserId), chosen = eligible.filter(row => selected.includes(row.id));
  async function submit() {
    if (!action || busy) return;
    setBusy(true); setError("");
    try {
      await api.post(endpoint, { action, items: targets.map(({ id, updatedAt }) => ({ id, updatedAt })) });
      showToast(`已${verbs[action]}${targets.length}条`); setAction(null); onSelect([]); await onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-actions card-body">
      <label><input type="checkbox" aria-label="全选当前列表" checked={!!eligible.length && chosen.length === eligible.length} disabled={busy} onChange={e => onSelect(e.target.checked ? eligible.map(row => row.id) : [])} />全选当前列表</label>
      <span>已选{chosen.length}条（最多200条）</span>
      {(["enable", "disable", "delete"] as const).map(value => <button key={value} className={`btn ${value === "delete" ? "btn--danger" : "btn--outline"}`} disabled={!chosen.length || chosen.length > 200 || busy} onClick={() => { setTargets(chosen); setAction(value); setError(""); }}>批量{verbs[value]}</button>)}
      {currentUserId && <span>当前登录账号不参与批量操作</span>}
    </div>
    {action && <EditorSheet title={`批量${verbs[action]}`} onClose={() => { if (!busy) setAction(null); }}>
      <p>确认{verbs[action]}以下{targets.length}条？</p>
      <ul>{targets.map(row => <li key={row.id}>{row.name}</li>)}</ul>
      <p>{action === "delete" ? effects[kind] + "删除后不能直接恢复。" : kind === "user" ? "停用后登录及接口权限立即失效，重新启用后恢复；历史记录和角色保留。" : "停用后退出新业务选择，历史记录保留；在全部或停用列表可重新启用。"}</p>
      <p>任一条不满足条件或已被修改，整批不执行，请刷新后重新选择。</p>
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions"><button className="btn btn--outline" disabled={busy} onClick={() => setAction(null)}>取消</button><button className={`btn ${action === "delete" ? "btn--danger" : "btn--primary"}`} disabled={busy} onClick={submit}>{busy ? "处理中…" : `确认${verbs[action]}`}</button></div>
    </EditorSheet>}
  </>;
}
