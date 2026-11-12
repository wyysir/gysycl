"use client";
import { ChevronLeft, ChevronRight, LoaderCircle, ScanLine, Trash2, ZoomIn } from "lucide-react";
import type { DocumentDto } from "@/lib/client/types";
import { DocumentImage } from "./DocumentImage";
export function DocumentOriginal({pages,selectedPage,onSelect,authorized,status,zoomed,canDelete,disabled,onZoom,onDelete}:{
  pages: DocumentDto["pages"]; selectedPage:number; onSelect:(page:number)=>void; authorized:boolean; status:string; zoomed:boolean;
  canDelete:boolean; disabled:boolean; onZoom:()=>void; onDelete:()=>void;
}) {
  const page=pages[selectedPage];
  return (        <section className="card image-card desktop-original">
          <div className="image-card-head">
            <div className="image-file-meta">
              <strong className="panel-title">原单凭证</strong>
              <span>{page ? `第 ${selectedPage + 1} / ${pages.length} 页 · 点击放大查看手写细节` : !authorized ? "原图按查看权限隐藏" : "手工录入送货单 · 无原图"}</span>
              {page?.sourceDocDate || page?.sourceDocNo ? (
                <span>原单日期：{page.sourceDocDate || "未识别"} · 原单号：{page.sourceDocNo || "未识别"}</span>
              ) : null}
            </div>
            <button
              className="icon-button"
              type="button"
              title="放大 / 还原"
              disabled={!page}
              onClick={onZoom}
            >
              <ZoomIn size={15} />
            </button>
          </div>
          {page && <div className="original-toolbar">
            <button className="btn btn--outline btn--small" aria-label="上一页原图" disabled={selectedPage <= 0} onClick={() => onSelect(selectedPage - 1)}><ChevronLeft size={16} />上一页</button>
            <span>第 {selectedPage + 1} / {pages.length} 页</span>
            <button className="btn btn--outline btn--small" aria-label="下一页原图" disabled={selectedPage >= pages.length - 1} onClick={() => onSelect(selectedPage + 1)}>下一页<ChevronRight size={16} /></button>
          </div>}
          <div className={`image-stage ${zoomed ? "is-zoomed" : ""}`}>
            {page ? (
              <DocumentImage src={page.url} alt={`送货单第 ${selectedPage + 1} 页`} />
            ) : (
              <div className="empty">
                <p>{!authorized ? "原图已按查看权限隐藏" : "手工录入送货单，无需上传图片。可增加一行录入明细。"}</p>
              </div>
            )}
            {status === "PROCESSING" ? (
              <div className="image-processing">
                <LoaderCircle className="spin" size={26} />
                <strong>正在识别图片…</strong>
                <span>页面会自动刷新，无需手动操作</span>
              </div>
            ) : null}
          </div>
          {pages.length > 1 ? (
            <div className="page-tabs">
              {pages.map((item, index) => (
                <button
                  key={item.id}
                  className={selectedPage === index ? "is-active" : ""}
                  type="button"
                  onClick={() => onSelect(index)}
                >
                  <img className="page-thumb" src={item.url} alt="" />第 {index + 1} 页
                </button>
              ))}
            </div>
          ) : null}
          <div className="image-tip">
            <ScanLine size={12} /> 原图不会被修改；低置信字段已在右侧标黄。
          </div>
          {canDelete && page ? (
            <div style={{padding: "0 16px 16px"}}>
              <button className="btn btn--outline btn--small" type="button" disabled={disabled}
                onClick={onDelete}>
                <Trash2 size={14} /> 删除此图片
              </button>
            </div>
          ) : null}
        </section>);
}
