"use client";
import { hasPermission } from "@/lib/permissions";

import Link from "next/link";
import { MasterImport } from "@/components/MasterImport";
import { IngredientCategories, type CategoryList } from "@/components/IngredientCategories";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { api, ApiClientError } from "@/lib/client/api";
import { usePageMemory, useScrollMemory } from "@/lib/client/page-memory";
import type { Bootstrap } from "@/lib/client/types";
import type {
  IngredientDetail,
  IngredientHistory,
  IngredientList,
  IngredientRecord,
} from "@/lib/client/ingredients";
import { ErrorState, PageLoading, formatMoney } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";

const blank = {
  name: "",
  unit: "",
  spec: "",
  category: "",
  aliases: "",
  notes: "",
  active: true,
};
const historyBlank = {
  from: "",
  to: "",
  projectId: "",
  supplierId: "",
  unit: "",
};
const values = (item: IngredientRecord) => ({
  name: item.name,
  unit: item.unit,
  spec: item.spec,
  category: item.category,
  aliases: item.aliases.join("、"),
  notes: item.notes,
  active: item.active,
});
const aliases = (text: string) =>
  text
    .split(/[、,，;；\n]/)
    .map((value) => value.trim())
    .filter(Boolean);

export default function IngredientsPage() {
  const { showToast } = useToast();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null),
    [error, setError] = useState("");
  const [list, setList] = useState<IngredientList | null>(null),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  const [q, setQ] = usePageMemory("ingredients-query", ""),
    [category, setCategory] = usePageMemory("ingredients-category", ""),
    [unit, setUnit] = usePageMemory("ingredients-unit", ""),
    [status, setStatus] = usePageMemory("ingredients-status", "active"),
    [page, setPage] = usePageMemory("ingredients-page", 1);
  const [selected, setSelected] = usePageMemory<string | null>("ingredients-selection", null),
    [detail, setDetail] = useState<IngredientDetail | null>(null),
    [detailError, setDetailError] = useState("");
  const [tab, setTab] = usePageMemory<"basic" | "contracts" | "history">("ingredients-tab", "basic"),
    [form, setForm] = useState(blank),
    [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<IngredientHistory | null>(null),
    [historyFilters, setHistoryFilters] = usePageMemory("ingredients-history-filters", historyBlank),
    [historyPage, setHistoryPage] = usePageMemory("ingredients-history-page", 1),
    [historyError, setHistoryError] = useState("");
  const [mergeQ, setMergeQ] = useState(""),
    [mergeList, setMergeList] = useState<IngredientList | null>(null),
    [mergeTarget, setMergeTarget] = useState("");
  const [categories, setCategories] = useState<CategoryList>({categories: [], version: ""});
  const [checked, setChecked] = useState<IngredientRecord[]>([]);
  const [batchAction, setBatchAction] = useState<"disable" | "enable" | "category" | null>(null);
  const [batchCategory, setBatchCategory] = useState("");
  const [batchTargets, setBatchTargets] = useState<IngredientRecord[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState("");
  function reloadCategories() {
    api.get<CategoryList>("/api/master-data/ingredient-categories").then(setCategories).catch(e => showToast(e.message, "error"));
  }
  useEffect(() => { reloadCategories(); }, [refresh]);
  useEffect(() => { setChecked([]); }, [q, category, unit, status, page, refresh]);
  function prepareBatch(action: "disable" | "enable" | "category", targets = checked) {
    setBatchTargets(targets); setBatchAction(action); setBatchCategory(""); setBatchError("");
  }
  async function saveBatch() {
    setBatchBusy(true); setBatchError("");
    try {
      await api.patch("/api/master-data/ingredients/bulk", {
        items: batchTargets.map(item => ({id: item.id, version: item.version})),
        ...(batchAction === "category" ? {category: batchCategory} : {active: batchAction === "enable"}),
      });
      showToast(`已更新${batchTargets.length}条原材料`); setBatchAction(null); setRefresh(value => value + 1);
    } catch (e) { setBatchError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBatchBusy(false); }
  }
  const detailSequence = useRef(0);
  const admin = Boolean(bootstrap && hasPermission(bootstrap.user,"master.manage"));
  const canCreateGlobal = Boolean(bootstrap && hasPermission(bootstrap.user,"master.create_global"));
  const formEditable = admin || selected === "new" && canCreateGlobal;
  useScrollMemory("ingredients", !loading && !!list);
  useEffect(() => {
    api
      .get<Bootstrap>("/api/bootstrap?scope=context")
      .then(setBootstrap)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () =>
        api
          .get<IngredientList>(
            "/api/master-data/ingredients?" +
              new URLSearchParams({
                q,
                category,
                unit,
                status,
                page: String(page),
              }),
          )
          .then((data) => {
            if (current) setList(data);
          })
          .catch((e) => {
            if (current) setError(e.message);
          })
          .finally(() => {
            if (current) setLoading(false);
          }),
      200,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q, category, unit, status, page, refresh]);
  useEffect(() => {
    if (!selected || selected === "new") return;
    const sequence = ++detailSequence.current;
    setDetail(null);
    setDetailError("");
    api
      .get<IngredientDetail>(`/api/master-data/ingredients/${selected}`)
      .then((data) => {
        if (sequence === detailSequence.current) {
          setDetail(data);
          setForm(values(data.ingredient));
        }
      })
      .catch((e) => {
        if (sequence === detailSequence.current) setDetailError(e.message);
      });
    return () => {
      detailSequence.current++;
    };
  }, [selected, refresh]);
  useEffect(() => {
    if (!selected || selected === "new" || tab !== "history") return;
    let current = true;
    setHistory(null);
    setHistoryError("");
    api
      .get<IngredientHistory>(
        `/api/master-data/ingredients/${selected}/history?` +
          new URLSearchParams({ ...historyFilters, page: String(historyPage) }),
      )
      .then((data) => {
        if (current) setHistory(data);
      })
      .catch((e) => {
        if (current) setHistoryError(e.message);
      });
    return () => {
      current = false;
    };
  }, [selected, tab, historyFilters, historyPage, refresh]);
  useEffect(() => {
    if (!admin || !detail || tab !== "basic") return;
    let current = true;
    setMergeList(null);
    setMergeTarget("");
    const timer = setTimeout(
      () =>
        api
          .get<IngredientList>(
            "/api/master-data/ingredients?" +
              new URLSearchParams({ q: mergeQ, unit: detail.ingredient.unit }),
          )
          .then((data) => {
            if (current) setMergeList(data);
          })
          .catch((e) => {
            if (current) showToast(e.message, "error");
          }),
      200,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [admin, detail, mergeQ, tab, showToast]);
  function open(id: string) {
    setSelected(id);
    setTab("basic");
    setDetailError("");
    setMergeQ("");
    setHistoryFilters(historyBlank);
    setHistoryPage(1);
    if (id === "new") {
      setDetail(null);
      setForm(blank);
    }
  }
  function close() {
    setSelected(null);
    setDetail(null);
  }
  function anotherUnit() {
    if (!detail) return;
    setForm({ ...values(detail.ingredient), unit: "", spec: "" });
    setDetail(null);
    setSelected("new");
    setTab("basic");
    showToast("请填写另一计量单位；数量和价格不会自动换算");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!formEditable || saving) return;
    setSaving(true);
    const payload = { ...form, aliases: aliases(form.aliases) };
    try {
      if (selected === "new") {
        const result = await api.post<{ id: string }>(
          "/api/master-data/ingredients",
          { ...payload, confirmNew: true },
        );
        setSelected(result.id);
        showToast("原材料已新增");
      } else if (detail) {
        const result = await api.patch<{ ingredient: IngredientRecord }>(
          `/api/master-data/ingredients/${detail.ingredient.id}`,
          { ...payload, version: detail.ingredient.version },
        );
        setDetail({ ...detail, ingredient: result.ingredient });
        setForm(values(result.ingredient));
        showToast("原材料已保存");
      }
      setRefresh((value) => value + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : "保存失败";
      showToast(message, "error");
      if (e instanceof ApiClientError && e.status === 409)
        setDetailError(
          message + "。请关闭详情后重新打开，核对最新资料再保存。",
        );
    } finally {
      setSaving(false);
    }
  }
  async function merge() {
    if (!detail || !mergeTarget || saving) return;
    if (
      !window.confirm(
        "确认合并到所选同单位材料？源材料将停用，已通过单据保留原引用与金额，未审单据和合同价改指目标，名称和别名迁移到目标。",
      )
    )
      return;
    setSaving(true);
    try {
      await api.post("/api/master-data/merge", {
        type: "ingredient",
        sourceId: detail.ingredient.id,
        targetId: mergeTarget,
      });
      showToast("材料已合并，历史单据保持原记录");
      close();
      setRefresh((value) => value + 1);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "合并失败", "error");
    } finally {
      setSaving(false);
    }
  }
  if (!bootstrap && !error) return <PageLoading label="正在读取原材料…" />;
  if (error && !list)
    return (
      <ErrorState message={error} onRetry={() => window.location.reload()} />
    );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">原材料管理</h1>
          <p className="page-subtitle">
            规范品名、计量单位、别名与价格记录集中查看。
          </p>
        </div>
        <div className="page-actions">
        {bootstrap && hasPermission(bootstrap.user,"master.import") && <MasterImport onImported={() => setRefresh(v => v + 1)} />}
        {admin && <IngredientCategories data={categories} reload={() => { reloadCategories(); setRefresh(v => v + 1); }} />}
        {canCreateGlobal ? (
          <button className="btn btn--primary" onClick={() => open("new")}>
            <Plus size={16} />
            新增原材料
          </button>
        ) : null}
        </div>
      </div>
      <section className="card">
        <div className="catalog-filters">
          <label className="field">
            名称或别名
            <div className="search-input">
              <input
                className="input"
                aria-label="搜索原材料"
                placeholder="输入品名或常用叫法"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </label>
          <label className="field">
            分类
            <select
              className="select"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部分类</option>
              {list?.categories.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            单位
            <select
              className="select"
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部单位</option>
              {list?.units.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          {admin ? (
            <label className="field">
              状态
              <select
                className="select"
                aria-label="状态"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="active">启用</option>
                <option value="inactive">停用</option>
                <option value="all">全部</option>
              </select>
            </label>
          ) : null}
        </div>
      </section>
      {error ? <p role="alert">{error}</p> : null}
      {loading ? (
        <p role="status">正在搜索…</p>
      ) : (
        <>
          {admin && <div className="page-actions" style={{marginBottom: 12}}>
            <label><input type="checkbox" aria-label="全选本页材料" checked={!!list?.items.length && checked.length === list.items.length} disabled={loading || batchBusy} onChange={e => setChecked(e.target.checked ? list?.items || [] : [])} />全选本页</label>
            <span>已选{checked.length}条</span>
            <button className="btn btn--outline" disabled={!checked.length} onClick={() => prepareBatch("disable")}>批量停用</button>
            <button className="btn btn--outline" disabled={!checked.length} onClick={() => prepareBatch("enable")}>批量启用</button>
            <button className="btn btn--outline" disabled={!checked.length} onClick={() => prepareBatch("category")}>调整分类</button>
          </div>}
          <div className="table-wrap" aria-label="原材料逐行列表">
            <table className="data-table ingredients-table"><thead><tr>
              {admin && <th>选择</th>}<th>品名</th><th>单位</th><th>分类</th><th>规格</th><th>状态</th><th>操作</th>
            </tr></thead><tbody>
              {list?.items.map(item => <tr key={item.id}>
                {admin && <td><input type="checkbox" aria-label={`选择${item.name}（${item.unit}）`} checked={checked.some(row => row.id === item.id)} onChange={e => setChecked(rows => e.target.checked ? [...rows, item] : rows.filter(row => row.id !== item.id))} /></td>}
                <td><strong>{item.name}</strong></td><td>{item.unit}</td><td>{item.category || "未分类"}</td><td>{item.spec || "—"}</td><td>{item.active ? "启用" : "停用"}</td>
                <td><div className="page-actions"><button className="btn btn--outline btn--small" onClick={() => open(item.id)}>{admin ? "编辑" : "查看详情"}</button>
                {admin && <button className="btn btn--outline btn--small" onClick={() => prepareBatch(item.active ? "disable" : "enable", [item])}>{item.active ? "停用" : "启用"}</button>}</div></td>
              </tr>)}
            </tbody></table>
          </div>
          {!list?.items.length ? (
            <div className="empty">暂无符合条件的材料</div>
          ) : null}
          <div className="pager">
            <button
              className="btn btn--outline"
              disabled={page <= 1}
              onClick={() => setPage((v) => v - 1)}
            >
              上一页
            </button>
            <span>
              第 {page} 页 · {list?.total || 0} 条
            </span>
            <button
              className="btn btn--outline"
              disabled={!list || page * 20 >= list.total}
              onClick={() => setPage((v) => v + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
      {batchAction && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" aria-label="批量维护原材料"><div className="modal-head"><h2>{batchAction === "category" ? "调整分类" : batchAction === "disable" ? "停用原材料" : "启用原材料"}</h2></div><div className="card-body">
        <p>本次操作{batchTargets.length}条材料，历史单据及合同记录继续保留。</p>
        <ul>{batchTargets.map(item => <li key={item.id}>{item.name} · {item.spec || "无规格"} · {item.unit}</li>)}</ul>
        {batchAction === "category" && <label className="field">目标分类<select className="select" value={batchCategory} onChange={e => setBatchCategory(e.target.value)}><option value="">未分类</option>{categories.categories.filter(item => item.active).map(item => <option key={item.name}>{item.name}</option>)}</select></label>}
        {batchError && <p role="alert">{batchError}</p>}<div className="modal-actions"><button className="btn btn--outline" disabled={batchBusy} onClick={() => setBatchAction(null)}>取消</button><button className="btn btn--primary" disabled={batchBusy} onClick={saveBatch}>确认{batchAction === "disable" ? "停用" : batchAction === "enable" ? "启用" : "调整"}</button></div>
      </div></section></div>}
      {selected ? (
        <div
          className="modal-backdrop"
          onMouseDown={() => {
            if (!saving) close();
          }}
        >
          <section
            className="modal-card catalog-detail"
            role="dialog"
            aria-modal="true"
            aria-label={selected === "new" ? "新增原材料" : "材料详情"}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>
                {selected === "new"
                  ? "新增原材料"
                  : detail?.ingredient.name || "材料详情"}
              </h2>
              <button
                className="icon-button"
                disabled={saving}
                aria-label="关闭材料详情"
                onClick={close}
              >
                ×
              </button>
            </div>
            {detailError ? (
              <p className="line-warning" role="alert">
                {detailError}
              </p>
            ) : null}
            {selected !== "new" && !detail ? (
              <p>正在读取详情…</p>
            ) : (
              <>
                {selected !== "new" ? (
                  <div
                    className="page-tabs"
                    role="tablist"
                    aria-label="材料详情分类"
                  >
                    {(
                      [
                        ["basic", "基本资料"],
                        ["contracts", "合同价格"],
                        ["history", "采购历史"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        role="tab"
                        aria-selected={tab === value}
                        onClick={() => setTab(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {tab === "basic" ? (
                  <>
                    <form onSubmit={save}>
                      <div className="catalog-form">
                        <label className="field">
                          规范品名 *
                          <input
                            className="input"
                            required
                            maxLength={100}
                            disabled={!formEditable || saving}
                            value={form.name}
                            onChange={(e) =>
                              setForm({ ...form, name: e.target.value })
                            }
                          />
                        </label>
                        <label className="field">
                          计量单位 *
                          <input
                            className="input"
                            required
                            maxLength={30}
                            disabled={!formEditable || saving}
                            value={form.unit}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                unit: e.target.value,
                                spec: !form.spec.trim() || form.spec === form.unit
                                  ? e.target.value
                                  : form.spec,
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          规格
                          <input
                            className="input"
                            maxLength={100}
                            disabled={!formEditable || saving}
                            placeholder="留空时按计量单位填写"
                            value={form.spec}
                            onChange={(e) =>
                              setForm({ ...form, spec: e.target.value })
                            }
                          />
                        </label>
                        <label className="field">
                          分类
                          <input
                            className="input"
                            list="material-categories"
                            maxLength={50}
                            disabled={!formEditable || saving}
                            value={form.category}
                            onChange={(e) =>
                              setForm({ ...form, category: e.target.value })
                            }
                          />
                          <datalist id="material-categories">
                            {categories.categories.filter(item => item.active).map(item => (
                              <option key={item.name} value={item.name} />
                            ))}
                          </datalist>
                        </label>
                        <label className="field catalog-wide">
                          多个别名（用顿号、逗号或换行分隔）
                          <textarea
                            className="textarea"
                            aria-label="多个别名（用顿号、逗号或换行分隔）"
                            rows={2}
                            disabled={!formEditable || saving}
                            value={form.aliases}
                            onChange={(e) =>
                              setForm({ ...form, aliases: e.target.value })
                            }
                          />
                        </label>
                        <label className="field catalog-wide">
                          备注
                          <textarea
                            className="textarea"
                            aria-label="备注"
                            rows={3}
                            maxLength={2000}
                            disabled={!formEditable || saving}
                            value={form.notes}
                            onChange={(e) =>
                              setForm({ ...form, notes: e.target.value })
                            }
                          />
                        </label>
                        <label className="check-row">
                          <input
                            type="checkbox"
                            disabled={!formEditable || saving}
                            checked={form.active}
                            onChange={(e) =>
                              setForm({ ...form, active: e.target.checked })
                            }
                          />
                          启用（停用后不再进入新材料选择列表）
                        </label>
                      </div>
                      {detail?.ingredient.referenced ? (
                        <p className="text-muted">
                          修改规格或单位仅更新材料资料，已有单据和合同保留原规格、单位及价格；数量和价格不会自动换算。
                          {canCreateGlobal ? (
                            <button
                              className="btn btn--outline btn--small"
                              type="button"
                              disabled={saving}
                              onClick={anotherUnit}
                            >
                              新增另一单位记录
                            </button>
                          ) : null}
                        </p>
                      ) : null}
                      {formEditable ? (
                        <div className="modal-actions">
                          <button
                            className="btn btn--outline"
                            type="button"
                            disabled={saving}
                            onClick={close}
                          >
                            取消
                          </button>
                          <button
                            className="btn btn--primary"
                            type="submit"
                            disabled={saving || !!detailError}
                          >
                            {saving ? "保存中…" : "保存材料"}
                          </button>
                        </div>
                      ) : null}
                    </form>
                    {admin && detail ? (
                      <section className="material-merge">
                        <h3>合并同单位重复材料</h3>
                        <p className="text-muted">
                          源记录停用，已通过单据保留原引用。跨单位材料分别维护。
                        </p>
                        <label className="field">
                          搜索目标材料
                          <input
                            className="input"
                            value={mergeQ}
                            onChange={(e) => setMergeQ(e.target.value)}
                          />
                        </label>
                        <label className="field">
                          目标（仅 {detail.ingredient.unit}）
                          <select
                            className="select"
                            value={mergeTarget}
                            onChange={(e) => setMergeTarget(e.target.value)}
                          >
                            <option value="">请选择目标材料</option>
                            {mergeList?.items
                              .filter((v) => v.id !== detail.ingredient.id)
                              .map((v) => (
                                <option value={v.id} key={v.id}>
                                  {v.name} · {v.spec || v.unit}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button
                          className="btn btn--outline"
                          disabled={!mergeTarget || saving}
                          onClick={merge}
                        >
                          合并到目标材料
                        </button>
                      </section>
                    ) : null}
                  </>
                ) : null}
                {tab === "contracts" ? (
                  <>
                    <p className="text-muted">
                      仅显示你有权限查看的项目合同，价格在
                      <Link href="/master">合同主数据</Link>维护。
                    </p>
                    <div className="catalog-history">
                      {detail?.contracts.map((contract) => (
                        <article className="history-entry" key={contract.id}>
                          <strong>
                            {contract.projectName} · {contract.supplierName}
                          </strong>
                          <p>
                            {formatMoney(contract.unitPrice)} / {contract.unit}{" "}
                            · 规格 {contract.spec || "未填写"}
                          </p>
                          <small>
                            {contract.startsOn} 至{" "}
                            {contract.endsOn || "长期有效"}
                          </small>
                        </article>
                      ))}
                      {!detail?.contracts.length ? <p>暂无合同价格</p> : null}
                    </div>
                  </>
                ) : null}
                {tab === "history" ? (
                  <>
                    <p className="text-muted">
                      仅展示已通过单据的历史成交价，每页 20 条。
                    </p>
                    <div className="history-filters">
                      <label className="field">
                        开始日期
                        <input
                          className="input"
                          type="date"
                          value={historyFilters.from}
                          onChange={(e) => {
                            setHistoryFilters({
                              ...historyFilters,
                              from: e.target.value,
                            });
                            setHistoryPage(1);
                          }}
                        />
                      </label>
                      <label className="field">
                        截止日期
                        <input
                          className="input"
                          type="date"
                          value={historyFilters.to}
                          onChange={(e) => {
                            setHistoryFilters({
                              ...historyFilters,
                              to: e.target.value,
                            });
                            setHistoryPage(1);
                          }}
                        />
                      </label>
                      <label className="field">
                        项目
                        <select
                          className="select"
                          value={historyFilters.projectId}
                          onChange={(e) => {
                            setHistoryFilters({
                              ...historyFilters,
                              projectId: e.target.value,
                            });
                            setHistoryPage(1);
                          }}
                        >
                          <option value="">全部项目</option>
                          {bootstrap?.projects.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        供应商
                        <select
                          className="select"
                          value={historyFilters.supplierId}
                          onChange={(e) => {
                            setHistoryFilters({
                              ...historyFilters,
                              supplierId: e.target.value,
                            });
                            setHistoryPage(1);
                          }}
                        >
                          <option value="">全部供应商</option>
                          {bootstrap?.suppliers.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        单位
                        <input
                          className="input"
                          placeholder={detail?.ingredient.unit}
                          value={historyFilters.unit}
                          onChange={(e) => {
                            setHistoryFilters({
                              ...historyFilters,
                              unit: e.target.value,
                            });
                            setHistoryPage(1);
                          }}
                        />
                      </label>
                    </div>
                    {historyError ? (
                      <p role="alert">{historyError}</p>
                    ) : !history ? (
                      <p>正在读取历史…</p>
                    ) : (
                      <>
                        <div className="catalog-history">
                          {history.items.map((item) => (
                            <article className="history-entry" key={item.id}>
                              <strong>
                                {item.docDate} ·{" "}
                                <Link href={`/documents/${item.documentId}?from=ingredients`}>
                                  {item.docNo || "未填写单号"}
                                </Link>
                              </strong>
                              <p>
                                {item.projectName} · {item.supplierName}
                              </p>
                              <p>
                                {item.quantity} {item.unit} ×{" "}
                                {formatMoney(item.unitPrice, item.unitPrice !== null)} ={" "}
                                {formatMoney(item.amount, item.amount !== null)}
                              </p>
                              <small>
                                原单品名：{item.name} · 规格：
                                {item.spec || "未填写"}
                              </small>
                            </article>
                          ))}
                          {!history.items.length ? <p>暂无历史</p> : null}
                        </div>
                        <div className="pager">
                          <button
                            className="btn btn--outline btn--small"
                            disabled={historyPage <= 1}
                            onClick={() => setHistoryPage((v) => v - 1)}
                          >
                            上一页
                          </button>
                          <span>
                            第 {historyPage} 页 · {history.total} 条
                          </span>
                          <button
                            className="btn btn--outline btn--small"
                            disabled={historyPage * 20 >= history.total}
                            onClick={() => setHistoryPage((v) => v + 1)}
                          >
                            下一页
                          </button>
                        </div>
                      </>
                    )}
                  </>
                ) : null}
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
