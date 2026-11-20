"use client";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/client/api";
import { chooseMaterial, choiceUnit, type MaterialGroup } from "@/lib/material-choice";
import type { DocumentItem } from "@/lib/client/types";

type Props = { item: DocumentItem; editable: boolean; label: string; onChange: (patch: Partial<DocumentItem>) => void };
export function MaterialNameField({ item, editable, label, onChange }: Props) {
  const id = useId(), input = useRef<HTMLInputElement>(null), menu = useRef<HTMLDivElement>(null), composing = useRef(false);
  const [open, setOpen] = useState(false), [groups, setGroups] = useState<MaterialGroup[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [active, setActive] = useState(0), [position, setPosition] = useState<CSSProperties>({});
  useEffect(() => {
    if (!open || !editable) return;
    const sync = () => {
      const r = input.current?.getBoundingClientRect(); if (!r) return;
      const v = window.visualViewport, top = v?.offsetTop || 0, bottom = top + (v?.height || window.innerHeight);
      const width = Math.min(Math.max(r.width, 300), window.innerWidth - 16), below = bottom - r.bottom - 12, above = r.top - top - 12;
      const flip = below < 180 && above > below, height = Math.min(300, Math.max(90, flip ? above : below));
      setPosition({ position: "fixed", left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        top: flip ? Math.max(top + 6, r.top - height - 5) : r.bottom + 5, width, maxHeight: height });
    };
    sync(); window.addEventListener("scroll", sync, true); window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync); window.visualViewport?.addEventListener("scroll", sync);
    return () => { window.removeEventListener("scroll", sync, true); window.removeEventListener("resize", sync); window.visualViewport?.removeEventListener("resize", sync); window.visualViewport?.removeEventListener("scroll", sync); };
  }, [open, editable]);
  useEffect(() => {
    if (!open || !editable || composing.current) return;
    let current = true; setGroups([]); setActive(0); setError("");
    if (!item.name.trim()) { setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(() => {
      api.get<{ groups: MaterialGroup[] }>("/api/master-data/material-lookup?q=" + encodeURIComponent(item.name.trim()))
        .then(r => { if (current) setGroups(r.groups); }).catch(e => { if (current) setError(e.message || "检索失败"); }).finally(() => { if (current) setLoading(false); });
    }, 200);
    return () => { current = false; window.clearTimeout(timer); };
  }, [open, editable, item.name]);
  useEffect(() => { if (!editable) setOpen(false); }, [editable]);
  const choose = (group: MaterialGroup) => { onChange(chooseMaterial(item, group)); setOpen(false); };
  return <>
    <input ref={input} className="input" aria-label={label} value={item.name} disabled={!editable} placeholder="输入品名检索" autoComplete="off"
      role="combobox" aria-autocomplete="list" aria-expanded={open && editable} aria-controls={id} aria-activedescendant={open && groups[active] ? `${id}-${active}` : undefined}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onBlur={event => { if (!menu.current?.contains(event.relatedTarget)) setOpen(false); }}
      onCompositionStart={() => { composing.current = true; setOpen(false); }} onCompositionEnd={() => { composing.current = false; setOpen(true); }}
      onChange={event => {
        const name = event.target.value, oldAutoUnit = item.materialChoice?.source === "master" && item.materialChoice.confirmedUnit !== choiceUnit(item.unit);
        onChange({ name, ingredientId: null, matchStatus: "UNMATCHED", matchScore: null, materialChoice: null, ...(oldAutoUnit ? { unit: "" } : {}) });
        if (!composing.current) setOpen(true);
      }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Escape") { setOpen(false); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive(n => Math.max(0, Math.min(groups.length - 1, n + (event.key === "ArrowDown" ? 1 : -1)))); }
        if (event.key === "Enter") { event.preventDefault(); if (open && groups[active] && !loading) choose(groups[active]); else setOpen(true); }
      }} />
    {open && editable && typeof document !== "undefined" && createPortal(<div ref={menu} className="material-lookup-menu" style={position} id={id} role="listbox" aria-label="品名候选"
      onBlur={event => { if (!menu.current?.contains(event.relatedTarget) && event.relatedTarget !== input.current) setOpen(false); }}>
      {loading ? <p role="status">正在检索…</p> : error ? <p role="alert">{error}</p> : !item.name.trim() ? <p>输入品名或已登记别名。</p> : !groups.length ? <p>未找到对应资料，请核实名称或使用“新建品名”。不会自动选择相近材料。</p> : groups.map((group, index) => <button key={group.key} id={`${id}-${index}`} type="button" role="option" aria-selected={index === active}
        className={index === active ? "is-active" : ""} onMouseDown={event => event.preventDefault()} onClick={() => choose(group)}>
        <strong>{group.name}</strong><span>{group.spec || "规格未注明"} · {[...new Set(group.options.map(o => o.unit + (o.provisional ? "（暂用）" : "")))].join("、")}</span>
        {group.matchedAlias && <small>命中别名：{group.matchedAlias}</small>}
      </button>)}
    </div>, document.body)}
  </>;
}

export function MaterialUnitField({ item, editable, label, onChange, canCreateUnit = false }: Props & { canCreateUnit?: boolean }) {
  const [group, setGroup] = useState<MaterialGroup | null>(null), [error, setError] = useState(""), [manual, setManual] = useState(false), [pending, setPending] = useState<string | null>(null);
  const key = item.materialChoice?.key, record = item.ingredientId;
  const params = key ? "key=" + encodeURIComponent(key) : record ? "ingredientId=" + encodeURIComponent(record) : "";
  useEffect(() => {
    let current = true;
    if (!key || group?.key !== key) { setGroup(null); setPending(null); setManual(false); }
    setError("");
    if (!params) return;
    api.get<{ groups: MaterialGroup[] }>("/api/master-data/material-lookup?" + params).then(r => { if (current) {
      const next = r.groups[0], sourceSpec = choiceUnit(item.spec) === choiceUnit(item.unit) ? "" : item.spec.trim().toLowerCase().replace(/\s/g, "");
      setGroup(next && next.spec.trim().toLowerCase().replace(/\s/g, "") === sourceSpec ? next : null);
    } }).catch(e => { if (current) setError(e.message || "单位读取失败"); });
    return () => { current = false; };
  }, [params, item.spec]);
  function apply(unit: string) {
    if (group) onChange(chooseMaterial(item, group, unit));
    else onChange({ unit, ...(item.materialChoice ? { materialChoice: { ...item.materialChoice, source: "manual", confirmedUnit: choiceUnit(unit) || null } } : {}) });
    setPending(null);
  }
  function request(unit: string) {
    if (choiceUnit(item.unit) && choiceUnit(unit) !== choiceUnit(item.unit)) setPending(unit);
    else apply(unit);
  }
  const units = group ? [...new Set(group.options.map(o => o.unit))] : [], current = choiceUnit(item.unit);
  const needsConfirmation = item.materialChoice && item.ingredientId && item.materialChoice.confirmedUnit !== current && ["master", "unknown"].includes(item.materialChoice.source);
  const newUnit = !!group && !item.ingredientId && !!item.materialChoice && !!current && !group.options.some(o => choiceUnit(o.unit) === current);
  const confirmedNewUnit = newUnit && item.materialChoice?.source === "manual" && item.materialChoice.confirmedUnit === current;
  return <div className="material-unit-field">
    {group && !manual ? <select className="select" aria-label={label} disabled={!editable} value={item.unit} onChange={event => {
      if (event.target.value === "__manual") setManual(true); else request(event.target.value);
    }}>
      {!item.unit && <option value="">请选择单位</option>}
      {item.unit && !units.includes(item.unit) && <option value={item.unit}>{item.unit}（原单／未登记）</option>}
      {units.map(unit => <option key={unit} value={unit}>{unit}{group.options.filter(o => o.unit === unit).every(o => o.provisional) ? "（资料暂用）" : ""}{group.options.filter(o => o.unit === unit).length > 1 ? "（有重复资料，需核对）" : ""}</option>)}
      <option value="__manual">其他／输入原单单位</option>
    </select> : <input className="input" aria-label={label} value={item.unit} disabled={!editable} placeholder="原单单位" onChange={event => {
      const unit = event.target.value;
      // A manual input is an explicit correction. It never changes numeric fields.
      apply(unit);
    }} maxLength={30} />}
    {manual && group && <button className="link-button" type="button" onClick={() => setManual(false)}>选择已有单位</button>}
    {error && <small role="alert" className="text-danger">{error}</small>}
    {newUnit && editable && <div className="material-unit-registration">
      {canCreateUnit ? confirmedNewUnit ? <small>保存时为此品名、规格新增“{item.unit}”采购单位；换算比例稍后在后台设置。</small> : <><small>此单位尚未登记；按原单确认后，保存时新增。</small><button className="link-button" type="button" onClick={() => apply(item.unit)}>确认原单为{item.unit}，保存时新增</button></> : <small>此单位尚未登记，请由有新建基础资料权限的人员添加。</small>}
    </div>}
    {item.materialChoice?.source === "master" && <small className="material-unit-origin">资料带入{item.materialChoice.provisional ? " · 暂用单位" : ""}</small>}
    {needsConfirmation && editable && <button className="link-button material-unit-confirm" type="button" onClick={() => onChange({ materialChoice: { ...item.materialChoice!, source: "manual", confirmedUnit: current } })}>对照原单后确认单位</button>}
    {pending !== null && <div className="material-unit-question" role="alert">
      <p>将{item.unit}改为{pending || "空白"}，数量{item.quantity}、单价{item.unitPrice === null ? "未授权" : item.unitPrice}、金额{item.amount === null ? "未授权" : item.amount}均保留。这是纠正原单单位，不是换算；请确认原图实际使用该单位。</p>
      <button type="button" className="link-button" onClick={() => apply(pending)}>确认原单为{pending || "空白"}</button>
      <button type="button" className="link-button" onClick={() => setPending(null)}>保留{item.unit}</button>
    </div>}
  </div>;
}
