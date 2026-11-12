"use client";

import { hasPermission, canEditRecord, canSubmitRecord, canDeleteRecord, canReviewRecord } from "@/lib/permissions";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { documentOrigin } from "@/lib/client/navigation";
import {
  AlertTriangle,
  FileText,
  LoaderCircle,
  Plus,
  RefreshCw,
  ScanLine,
  Trash2,
  ZoomIn,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  X,
} from "lucide-react";
import { api } from "@/lib/client/api";
import { currentItemChecks } from "@/lib/client/item-checks";
import { DocumentOriginal } from "@/components/DocumentOriginal";
import { DocumentAmountPanel } from "@/components/DocumentAmountPanel";
import { DocumentReviewIssues } from "@/components/DocumentReviewIssues";
import { BulkMaterialPicker } from "@/components/BulkMaterialPicker";
import { DocumentItemsEditor, type DocumentItemsHandle } from "@/components/DocumentItemsEditor";
import { EditorSheet } from "@/components/EditorSheet";
import { AmountInput } from "@/components/AmountInput";
import { DocumentImage } from "@/components/DocumentImage";
import { useMobile } from "@/lib/client/use-mobile";
import type {
  Bootstrap,
  DocumentDetail,
  DocumentDto,
  DocumentItem,
  IngredientSuggestion,
  SupplierSuggestion,
} from "@/lib/client/types";
import {
  CheckList,
  ErrorState,
  PageLoading,
  StatusPill,
  formatDate,
  formatDateTime,
  formatMoney,
} from "@/components/ui";
import { useToast } from "@/components/ToastProvider";

import { useLeaveProtection, useLocalDraft } from "@/components/LeaveProtection";
import { canRestoreDocument, documentRecovery, type DocumentRecovery } from "@/lib/client/document-recovery";

function scoreText(score: number) {
  return `${Math.round(score * 100)}%`;
}

function matchLabel(status: string) {
  return status === "MATCHED"
    ? "已匹配"
    : status === "SIMILAR"
      ? "疑似相近"
      : "未匹配";
}

export default function DocumentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const mobile = useMobile();
  const lineEditor = useRef<DocumentItemsHandle>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [reviewTab, setReviewTab] = useState<"compare" | "image" | "list">("compare");
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [totalsOpen, setTotalsOpen] = useState(false);
  const reviewRoot = useRef<HTMLDivElement>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const evidenceTrigger = useRef<HTMLElement | null>(null);
  const [data, setData] = useState<DocumentDetail | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [selectedPage, setSelectedPage] = useState(0);
  const [supplierQuery, setSupplierQuery] = useState("");
  const supplierSearchTouched=useRef(false);
  const [supplierSearching,setSupplierSearching]=useState(false);
  const [supplierSearchError,setSupplierSearchError]=useState("");
  const [supplierSuggestions, setSupplierSuggestions] = useState<
    SupplierSuggestion[]
  >([]);
  const [newItem, setNewItem] = useState<{
    index: number;
    name: string;
    spec: string;
    unit: string;
    category: string;
  } | null>(null);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawNote, setWithdrawNote] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<"document" | "page" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const recovery = useLocalDraft<DocumentRecovery>(`/documents/${params.id}`);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryConflict, setRecoveryConflict] = useState<DocumentRecovery | null>(null);
  const restoredId = useRef("");
  const returnTarget = documentOrigin(useSearchParams().get("from")).href;
  const [imageOpen, setImageOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const sourceFocus = useRef<HTMLElement | null>(null);
  const pollRef = useRef<number | null>(null);
  const loadSequence = useRef(0);
  const bootstrapRef = useRef<Bootstrap | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      const sequence = ++loadSequence.current;
      if (!quiet) setError("");
      try {
        const [detail, bootstrapData] = await Promise.all([
          api.get<DocumentDetail>(`/api/documents/${params.id}`),
          quiet && bootstrapRef.current ? Promise.resolve(bootstrapRef.current) : api.get<Bootstrap>("/api/bootstrap?scope=context"),
        ]);
        if (sequence !== loadSequence.current) return;
        setData(detail);
        setDirty(false);
        setBootstrap(bootstrapData);
        bootstrapRef.current = bootstrapData;
        if (!quiet || !supplierSearchTouched.current) {
          supplierSearchTouched.current=false;
          setSupplierQuery(detail.document.supplierName || detail.document.ocrSupplierName || "");
        }
      } catch (caught) {
        if (!quiet && sequence === loadSequence.current) {
          setError(caught instanceof Error ? caught.message : "加载失败");
        }
      }
    },
    [params.id],
  );

  useEffect(() => {
    load();
    return () => { loadSequence.current++; };
  }, [load]);

  useEffect(() => {
    if (!imageOpen) return;
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setImageOpen(false); sourceFocus.current?.focus(); }
      if (event.key === "Tab") {
        const buttons = window.document.querySelectorAll<HTMLButtonElement>(".image-lightbox button");
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("keydown", close); window.document.body.style.overflow = previousOverflow; };
  }, [imageOpen]);

  useEffect(() => {
    if (!toolsOpen) return;
    const dismiss = (event: PointerEvent) => { if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setToolsOpen(false); toolsRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", dismiss); window.removeEventListener("keydown", escape); };
  }, [toolsOpen]);
  useEffect(() => {
    if (!evidenceOpen) return;
    evidenceTrigger.current = window.document.activeElement as HTMLElement;
    const panel = window.document.querySelector<HTMLElement>(".editor-evidence");
    const previous = window.document.body.style.overflow;
    const drawerQuery = window.matchMedia("(min-width:768px) and (max-width:1439px)");
    const syncOverflow = () => { window.document.body.style.overflow = drawerQuery.matches ? "hidden" : previous; };
    syncOverflow();
    drawerQuery.addEventListener("change", syncOverflow);
    panel?.querySelector<HTMLButtonElement>(".evidence-close")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEvidenceOpen(false);
      if (event.key === "Tab" && drawerQuery.matches) {
        const buttons = Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []).filter(el => el.getClientRects().length);
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => { drawerQuery.removeEventListener("change", syncOverflow); window.document.body.style.overflow = previous; window.removeEventListener("keydown", keydown); evidenceTrigger.current?.focus(); };
  }, [evidenceOpen]);
  const document = useMemo(() => data?.document ? {
    ...data.document,
    checks: currentItemChecks(data.document.checks, data.document.items),
  } : undefined, [data]);
  const shouldPoll =
    document &&
    (document.status === "PROCESSING" ||
      (document.pages.length > 0 && !document.items.length &&
        !document.ocrError &&
        document.status === "DRAFT"));

  useEffect(() => {
    if (!shouldPoll || dirty) {
      if (pollRef.current) window.clearTimeout(pollRef.current);
      return;
    }
    pollRef.current = window.setTimeout(() => load(true), 1800);
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [document, load, shouldPoll, dirty]);

  useEffect(() => {
    const query = supplierQuery.trim();
    let cancelled = false;
    if (!query) { setSupplierSuggestions([]);setSupplierSearching(false);setSupplierSearchError("");return; }
    setSupplierSearching(true);setSupplierSearchError("");
    const timer = window.setTimeout(() => {
      api.get<{ suggestions: SupplierSuggestion[] }>(
        `/api/master-data/suggest?type=supplier&q=${encodeURIComponent(query)}`,
      ).then(result => { if (!cancelled) setSupplierSuggestions(result.suggestions); })
        .catch(() => { if (!cancelled) setSupplierSearchError("供应商检索失败，请稍后重新输入"); })
        .finally(()=>{if(!cancelled)setSupplierSearching(false);});
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [supplierQuery]);

  const editPermission = Boolean(document && bootstrap && document.status !== "PROCESSING" && canEditRecord(bootstrap.user,document));
  const canSubmit = Boolean(document && bootstrap && canSubmitRecord(bootstrap.user,document));
  const canReview = Boolean(document && bootstrap && canReviewRecord(bootstrap.user,document));
  const canWithdraw = Boolean(document && bootstrap && document.status === "APPROVED" && hasPermission(bootstrap.user,"document.withdraw",document.projectId));
  const canApprove = Boolean(document && bootstrap && hasPermission(bootstrap.user,"document.approve",document.projectId));
  const canReturn = Boolean(document && bootstrap && hasPermission(bootstrap.user,"document.return",document.projectId));
  const canOverride = Boolean(canApprove && document && bootstrap && hasPermission(bootstrap.user,"document.override",document.projectId));
  const canCreateMaster = Boolean(bootstrap && hasPermission(bootstrap.user,"master.create"));
  const canOcr = Boolean(document && bootstrap && editPermission && hasPermission(bootstrap.user,"document.ocr",document.projectId));

  useLayoutEffect(() => {
    if (!recovery.ready || !document || !bootstrap || document.id !== params.id || restoredId.current === params.id) return;
    restoredId.current = params.id;
    setRecoveryConflict(null);
    const saved = recovery.draft?.value;
    if (saved) {
      if (document.visibility && !document.visibility.sensitiveDetails) {
        void recovery.clear();
      } else if (canRestoreDocument(saved, document, editPermission)) {
        setData(current => current ? { ...current, document: { ...current.document, ...saved.fields } } : current);
        setDirty(saved.dirty); setReviewNote(saved.reviewNote);
        showToast("已恢复未提交的内容，请核对后保存");
      } else setRecoveryConflict(saved);
    }
    setRecoveryReady(true);
  }, [recovery.ready, recovery.draft, document, bootstrap, params.id, editPermission, showToast]);
  useEffect(() => {
    if (recoveryReady && document?.id === params.id && !recoveryConflict && (dirty || reviewNote.trim())) {
      void recovery.write(documentRecovery(document, dirty, reviewNote));
    }
  }, [recoveryReady, document, params.id, recoveryConflict, dirty, reviewNote, recovery.write]);
  useEffect(() => {
    const sync = () => reviewRoot.current?.style.setProperty("--review-vh", `${window.visualViewport?.height || window.innerHeight}px`);
    sync(); window.visualViewport?.addEventListener("resize", sync); window.addEventListener("resize", sync);
    return () => { window.visualViewport?.removeEventListener("resize", sync); window.removeEventListener("resize", sync); };
  }, [recoveryReady, recovery.ready, params.id]);
  const working = saving || reviewing || rechecking || deleting || withdrawing;
  useLeaveProtection({
    dirty: dirty || !!reviewNote.trim() || !!recoveryConflict,
    busy: working,
    keep: () => document ? recovery.write(recoveryConflict || documentRecovery(document, dirty, reviewNote)) : Promise.resolve(false),
    discard: async () => {
      const cleared = await recovery.clear();
      if (!cleared) return false;
      setDirty(false); setReviewNote(""); setRecoveryConflict(null); await load(true); return true;
    },
    save: editPermission && !recoveryConflict && !reviewNote.trim() ? async () => !!await save(true) : undefined,
  });

  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!data || !document || document.id !== params.id || !bootstrap || !recoveryReady || !recovery.ready) {
    return <PageLoading label="正在读取单据与识别结果…" />;
  }
  const currentDocument: DocumentDto = document;
  const busy = working || !!recoveryConflict;
  const viewAmount=document.visibility?.amount ?? hasPermission(bootstrap.user,"document.view_amount",document.projectId);
  const viewUnitPrice=document.visibility?.unitPrice ?? hasPermission(bootstrap.user,"document.view_unit_price",document.projectId);
  const viewDetails=document.visibility?.sensitiveDetails ?? true;

  function updateDocument(patch: Partial<DocumentDto>) {
    if (busy) return;
    setDirty(true);
    setData((current) =>
      current
        ? { ...current, document: { ...current.document, ...patch } }
        : current,
    );
  }

  function addRow() {
    if (busy) return;
    setDirty(true);
    const next: DocumentItem = {
      id: `new-${Date.now()}`,
      lineNo: currentDocument.items.length + 1,
      rawName: "",
      name: "",
      spec: "",
      unit: "",
      quantity: 0,
      unitPrice: currentDocument.visibility?.unitPrice === false ? null : 0,
      amount: viewAmount ? 0 : null,
      confidence: 1,
      ingredientId: null,
      matchStatus: "UNMATCHED",
      matchScore: null,
    };
    setData((current) =>
      current
        ? {
            ...current,
            document: {
              ...current.document,
              items: [...current.document.items, next],
            },
          }
        : current,
    );
  }

  function updateItem(index: number, patch: Partial<DocumentItem>) {
    if (busy) return;
    setDirty(true);
    setData((current) => {
      if (!current) return current;
      const items = current.document.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch, ...(["quantity", "unitPrice", "amount", "name", "spec", "unit", "ingredientId"].some(key => key in patch && patch[key as keyof DocumentItem] !== item[key as keyof DocumentItem]) ? { roundingConfirmed: false, roundingAdjustment: null } : {}) } : item,
      );
      return {
        ...current,
        document: {
          ...current.document,
          items,
          subtotal: viewAmount ? items.reduce(
            (sum, item) => sum + Number(item.amount || 0),
            0,
          ) : null,
        },
      };
    });
  }

  async function chooseSupplier(suggestion: SupplierSuggestion) {
    updateDocument({
      supplierId: suggestion.id,
      supplierName: suggestion.name,
      supplierMatchStatus: "MATCHED",
      supplierMatchScore: 1,
    });
    showToast(`已选择供应商：${suggestion.name}`);
  }

  async function createSupplier() {
    if (!newSupplierName.trim()) return;
    try {
      const created = await api.post<{
        id: string;
        name: string;
        documentVersion?: number | null;
      }>("/api/master-data/suppliers", {
        name: newSupplierName.trim(),
        rawName: currentDocument.ocrSupplierName || newSupplierName.trim(),
        sourceDocumentId: currentDocument.id,
        confirmNew: true,
      });
      updateDocument({
        supplierId: created.id,
        supplierName: created.name,
        supplierMatchStatus: "MATCHED",
        supplierMatchScore: 1,
      });
      // 服务端回写来源单据时会递增 version，这里同步，避免随后保存/提交 409。
      if (typeof created.documentVersion === "number") {
        updateDocument({ version: created.documentVersion });
      }
      setShowSupplierDialog(false);
      setNewSupplierName("");
      showToast("供应商已新建并绑定到当前单据");
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "新建失败", "error");
    }
  }

  async function createIngredient() {
    if (!newItem) return;
    try {
      const created = await api.post<{
        id: string;
        name: string;
        spec: string;
        unit: string;
        documentVersion?: number | null;
      }>("/api/master-data/ingredients", {
        name: newItem.name.trim(),
        rawName:
          currentDocument.items[newItem.index]?.rawName || newItem.name.trim(),
        spec: newItem.spec,
        unit: newItem.unit,
        category: newItem.category,
        sourceDocumentId: currentDocument.id,
        // New rows exist only in this draft; bind them locally until saving.
        sourceItemId: currentDocument.items[newItem.index]?.id.startsWith("new-")
          ? undefined : currentDocument.items[newItem.index]?.id,
        confirmNew: true,
      });
      updateItem(newItem.index, {
        ingredientId: created.id,
        name: created.name,
        spec: created.spec,
        unit: created.unit,
        matchStatus: "MATCHED",
        matchScore: 1,
      });
      // 服务端回写来源明细时会递增单据 version，这里同步，避免随后保存/提交 409。
      if (typeof created.documentVersion === "number") {
        updateDocument({ version: created.documentVersion });
      }
      setNewItem(null);
      showToast("原材料已新建并关联到当前明细，请保存单据");
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "新建失败", "error");
    }
  }

  async function save(silent = false) {
    if (!editPermission || recoveryConflict) return null;
    setSaving(true);
    try {
      const result = await api.patch<{ document: DocumentDto }>(
        `/api/documents/${currentDocument.id}`,
        {
          version: currentDocument.version,
          docNo: currentDocument.docNo,
          docDate: currentDocument.docDate,
          projectId: currentDocument.projectId,
          supplierId: currentDocument.supplierId,
          items: currentDocument.items.map((item) => ({
            id: item.id,
            lineNo: item.lineNo,
            name: item.name,
            rawName: item.rawName,
            spec: item.spec,
            unit: item.unit,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            amount: Number(item.amount),
            roundingConfirmed: Boolean(item.roundingConfirmed),
            confidence: item.confidence,
            ingredientId: item.ingredientId,
            matchStatus: item.matchStatus,
            matchScore: item.matchScore,
          })),
          taxAmount: currentDocument.taxAmount,
          totalAmount: currentDocument.totalAmount,
          notes: currentDocument.notes,
        },
      );
      setData(current => current ? { ...current, document: result.document } : current);
      setDirty(false);
      await recovery.clear();
      await load(true);
      if (!silent) showToast("修改已保存，比对结果已刷新");
      return result.document;
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "保存失败", "error");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if(currentDocument.batchId){
      const saved=dirty?await save(true):currentDocument;
      if(saved)router.push(`/batches/${currentDocument.batchId}`);
      return;
    }
    const saved = await save(true);
    if (!saved) return;
    try {
      await api.post(`/api/documents/${currentDocument.id}/submit`);
      showToast("已提交项目主管审核");
      await load(true);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "提交失败", "error");
    }
  }

  async function decide(action: "approve" | "return", override = false) {
    if (!canReview || reviewing) return;
    if ((action === "return" || override) && !reviewNote.trim()) { setEvidenceOpen(true); window.setTimeout(() => { const input = window.document.getElementById("decision-note"); input?.scrollIntoView({ block: "center" }); input?.focus(); }, 0); showToast("请先填写退回或强制通过原因", "error"); return; }
    if (override && !window.confirm("确认填写原因并强制通过？严重异常及审核原因将保留记录。")) return;
    setReviewing(true);
    try {
      if (dirty && !await save(true)) return;
      await api.post("/api/documents/" + currentDocument.id + "/review", { action, note: reviewNote.trim(), override });
      setReviewNote(""); await recovery.clear(); showToast(action === "return" ? "已退回补充" : "审核通过"); await load(true);
    } catch (caught) { showToast(caught instanceof Error ? caught.message : "审核失败", "error"); if (!dirty) await load(true); }
    finally { setReviewing(false); }
  }

  async function recheck() {
    if (rechecking || saving || reviewing) return;
    setRechecking(true);
    try {
      // Checks must use the edited values; replacing state first would lose them.
      if (dirty && !await save(true)) return;
      const result = await api.post<DocumentDetail>(
        `/api/documents/${currentDocument.id}/recheck`,
      );
      setData(result);
      setDirty(false);
      showToast("比对结果已重新计算");
    } catch (caught) {
      showToast(
        caught instanceof Error ? caught.message : "重新比对失败",
        "error",
      );
    } finally { setRechecking(false); }
  }

  async function retryOcr() {
    try {
      await api.post(`/api/documents/${currentDocument.id}/ocr`);
      showToast("已重新提交识别任务");
      await load(true);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "识别失败", "error");
    }
  }

  async function withdrawApproval() {
    if (!withdrawNote.trim()) {
      showToast("请填写撤回原因", "error");
      return;
    }
    setWithdrawing(true);
    try {
      await api.post(`/api/documents/${currentDocument.id}/withdraw`, {
        note: withdrawNote.trim(),
      });
      setWithdrawOpen(false);
      setWithdrawNote("");
      showToast("已撤回审核，单据已回到待审核状态，请主管修改后重新审核");
      await load(true);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "撤回失败", "error");
    } finally {
      setWithdrawing(false);
    }
  }

  async function confirmDeletion() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const wholeDraft = deleteTarget === "document" || currentDocument.pages.length === 1;
      // Preserve unsaved edits to other rows before removing a single image.
      const saved = wholeDraft ? currentDocument : await save(true);
      if (!saved) return;
      const targetPage = currentDocument.pages[selectedPage] || currentDocument.pages[0];
      const url = wholeDraft
        ? `/api/documents/${currentDocument.id}`
        : `/api/documents/${currentDocument.id}/pages/${targetPage.id}`;
      const result = await api.delete<{deleted: boolean; warnings: string[]}>(url, {version: saved.version});
      setDeleteTarget(null);
      if (result.deleted) {
        showToast(result.warnings[0] || "草稿已删除");
        setDirty(false); setReviewNote(""); await recovery.clear();
        router.replace("/documents");
      } else {
        setSelectedPage(Math.max(0, selectedPage - 1));
        await load(true);
        showToast(result.warnings[0] || "图片已删除，请核对剩余明细和总价");
      }
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "删除失败", "error");
    } finally {
      setDeleting(false);
    }
  }

  const page = document.pages[selectedPage] || document.pages[0];
  const canDelete = Boolean(bootstrap && canDeleteRecord(bootstrap.user,document));
  const deleteLabel = document.status === "NEEDS_REVISION" ? "删除退回单据" : "删除草稿";
  const deletesWholeDraft = deleteTarget === "document" || document.pages.length === 1;
  const sourceItemCount = document.items.filter(item => item.sourcePageNo === page?.pageNo).length;
  const hasUnknownSources = document.items.some(item => !item.sourcePageNo);
  const errorCount = document.checks.filter(
    (check) => check.status === "OPEN" && check.severity === "ERROR",
  ).length;
  const warningCount = document.checks.filter(
    (check) => check.status === "OPEN" && check.severity === "WARNING",
  ).length;
  const total = document.items.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );

  const documentInfo = (<section className="card panel-card document-info" id="document-info">
            <div className="panel-head">
              <span className="panel-title">单据信息与供应商</span>
              <span
                className={`pill pill--${errorCount ? "error" : warningCount ? "warning" : "approved"}`}
              >
                {errorCount
                  ? `${errorCount} 必须处理`
                  : warningCount
                    ? `${warningCount} 项提醒`
                    : "自动检查通过"}
              </span>
            </div>
            <div className="panel-body">
              <div className="meta-form">
                <div className="field">
                  <label htmlFor="document-number">系统单号</label>
                  <input
                    className="input"
                    id="document-number"
                    value={document.docNo}
                    readOnly
                    placeholder="系统自动生成"
                  /><button type="button" className="link-button" onClick={async()=>{try{await navigator.clipboard.writeText(document.docNo);showToast("单号已复制");}catch{showToast("无法自动复制，请长按单号复制","error");}}}>复制单号</button>
                </div>
                <div className="field">
                  <label>送货日期</label>
                  <input
                    className="input"
                    type="date"
                    value={document.docDate.slice(0, 10)}
                    disabled={!editPermission || busy}
                    onChange={(event) =>
                      // 直接保存 YYYY-MM-DD，避免转成 UTC 时间后被截断成前一天。
                      updateDocument({ docDate: event.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>项目点</label>
                  <input
                    className="input"
                    value={document.projectName}
                    disabled
                  />
                </div>
              </div>
              <div className="supplier-match-block">
                <div className="supplier-match-head">
                  <div>
                    <strong>{document.supplierName || "尚未确认"}</strong>
                    <span
                      className={`pill pill--${
                        document.supplierId
                          ? "approved"
                          : document.ocrSupplierName
                            ? "warning"
                            : "error"
                      }`}
                    >
                      {document.supplierId
                        ? "已匹配"
                        : document.ocrSupplierName
                          ? "待确认"
                          : "未匹配"}
                    </span>
                  </div>
                </div>
                {document.ocrSupplierName && !document.supplierId ? (
                  <p className="ocr-raw">
                    OCR 原始名称：{document.ocrSupplierName}
                  </p>
                ) : null}
                {editPermission ? (
                  <div className="match-search">
                    <input
                      className="input"
                      aria-label="搜索供应商"
                      value={supplierQuery}
                      onChange={(event) => {supplierSearchTouched.current=true;setSupplierQuery(event.target.value);}}
                      placeholder="输入供应商名称搜索已有主数据"
                    />
                    {canCreateMaster && <button
                      className="btn btn--outline btn--small"
                      type="button"
                      onClick={() => {
                        setNewSupplierName(
                          document.ocrSupplierName || supplierQuery,
                        );
                        setShowSupplierDialog(true);
                      }}
                    >
                      <Plus size={13} /> 新建供应商
                    </button>}
                  </div>
                ) : null}
                {supplierSearching && <p role="status" className="text-muted">正在检索供应商…</p>}
                {supplierSearchError && <p role="alert" className="text-warning">{supplierSearchError}</p>}
                {supplierSuggestions.length ? (
                  <div
                    className={`candidate-list ${
                      document.supplierId ? "is-compact" : ""
                    }`}
                  >
                    {supplierSuggestions.map((suggestion) => (
                      <button
                        className={`candidate-item candidate-item--${suggestion.matchStatus.toLowerCase()} ${
                          suggestion.id === document.supplierId
                            ? "is-selected"
                            : ""
                        }`}
                        type="button"
                        disabled={!editPermission || busy}
                        key={suggestion.id}
                        onClick={() => chooseSupplier(suggestion)}
                      >
                        <span>
                          <strong>{suggestion.name}</strong>
                          {suggestion.matchedAlias ? (
                            <small>别名：{suggestion.matchedAlias}</small>
                          ) : null}
                        </span>
                        <span className="candidate-score">
                          {matchLabel(suggestion.matchStatus)} ·{" "}
                          {scoreText(suggestion.score)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </section>);

  const knownTotal = document.items.every(item => item.amount !== null) ? total : null;
  const amountPanel = <DocumentAmountPanel authorized={viewAmount} editable={editPermission && !busy} subtotal={knownTotal} total={document.totalAmount} onChange={value => updateDocument({ totalAmount:value })} />;

  return (
    <div ref={reviewRoot} data-review-tab={reviewTab} className={"page document-page " + (canReview ? "document-page--review" : "")}>
      <div className="review-page-content">
      {recovery.error && <div className="notice notice--red" role="alert">{recovery.error}</div>}
      {recoveryConflict && <section className="notice notice--red" role="alert"><div><strong>恢复副本与服务器版本或权限不一致</strong><p>已保留原输入，未覆盖服务器。请对照以下内容处理；当前页面暂不允许编辑。</p><details><summary>查看原输入</summary><pre className="recovery-content">{JSON.stringify(recoveryConflict.fields, null, 2)}{recoveryConflict.reviewNote}</pre></details><button className="btn btn--danger" onClick={async () => { if (window.confirm("确认放弃这份未提交的恢复副本？") && await recovery.clear()) setRecoveryConflict(null); }}>放弃恢复副本</button></div></section>}
      <header className="ledger-document-head">
        <Link className="ledger-back" href={returnTarget} aria-label="返回列表"><ChevronLeft size={24} /><span>{returnTarget === "/reviews" ? "返回队列" : "返回列表"}</span></Link>
        <div className="ledger-document-title"><h1 className="editor-title">{mobile ? "核对明细" : canReview ? "主管审核" : "核对明细"}</h1><p>{document.supplierName || document.ocrSupplierName || "供应商待确认"} · {document.projectName} · {formatDate(document.docDate)}</p></div>
        <StatusPill status={document.status} />
        <div className="document-tools" ref={toolsRef}>
          <button className="icon-button" aria-label="更多单据操作" aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)}><MoreHorizontal size={22} /></button>
          {toolsOpen && <div className="document-tools-menu">
            {editPermission && <button className="btn btn--outline" disabled={busy} onClick={() => { setToolsOpen(false); addRow(); }}><Plus size={14} />增加一行</button>}
            <button className="btn btn--outline" onClick={() => { setInfoOpen(true); setToolsOpen(false); }}>单据信息与供应商</button>
            <button className="btn btn--outline" onClick={() => { setTotalsOpen(true); setToolsOpen(false); }}>单据金额与合计</button>
            <button className="btn btn--outline" onClick={() => { setEvidenceOpen(true); setToolsOpen(false); if (mobile) window.document.querySelector(".editor-evidence")?.scrollIntoView({ block: "start" }); }}>处理依据与记录</button>
            {editPermission && <button className="btn btn--outline" disabled={busy} onClick={() => { setToolsOpen(false); recheck(); }}><RefreshCw size={14} />重新比对</button>}
            {canWithdraw && <button className="btn btn--outline" onClick={() => { setToolsOpen(false); setWithdrawOpen(true); }}>撤回审核</button>}
            {canDelete && <button className="btn btn--danger" disabled={busy} onClick={() => { setToolsOpen(false); setDeleteTarget("document"); }}><Trash2 size={14} />{deleteLabel}</button>}
          </div>}
        </div>
      </header>
      <button type="button" className="compact-document-meta" aria-haspopup="dialog" onClick={() => setInfoOpen(true)}>
        <span>{document.supplierName || document.ocrSupplierName || "选择供应商"}<ChevronRight size={14} /></span>
        <time>{formatDate(document.docDate)}</time>
      </button>
      {canReview && <div className="review-alerts">
        {errorCount > 0 && <div className="notice notice--red"><AlertTriangle size={22} /><div><strong>普通通过受限：{document.checks.find(c=>c.status==="OPEN"&&c.severity==="ERROR")?.title}（共{errorCount}项）</strong><p>{document.checks.filter(c=>c.status==="OPEN"&&c.severity==="ERROR").map(c=>c.title).join("；")}。请核对保存后再审核；强制通过须有权限并填写原因。</p></div></div>}
        {warningCount > 0 && <div className="notice"><AlertTriangle size={22} /><div><strong>{warningCount} 项识别与价格提醒</strong><p>提醒不阻止普通通过，请对照原图复核。</p></div></div>}
      </div>}


      {document.status === "APPROVED" ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          已通过单据仅供查看；撤回后修改，操作会保留记录。
        </div>
      ) : null}
      {document.ocrError ? (
        <div className="notice notice--red" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} />
          <div>
            <strong>识别未完成</strong>
            {document.ocrError}。原图已保存，可继续人工录入或重试识别。
            {canOcr ? <button className="link-button" type="button" onClick={retryOcr}>
              重试识别
            </button> : null}
          </div>
        </div>
      ) : null}

      {document.ocrWarnings?.length ? (
        <details className="ocr-warning-details">
            <summary>{document.ocrWarnings.length} 项识别提醒，请对照原图核对</summary>
            <ul>{document.ocrWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        </details>
      ) : null}

      <DocumentReviewIssues items={document.items} checks={document.checks} threshold={bootstrap.system.confidenceThreshold} activeId={selectedItemId || document.items[0]?.id} onLocate={id => { if (reviewTab === "image") setReviewTab("compare"); lineEditor.current?.locate(id); }} onEvidence={() => setEvidenceOpen(true)} />
      <nav className="review-mobile-tabs" aria-label="核对视图" role="tablist">{([["compare", "对照"], ["image", "原图"], ["list", "全部明细"]] as const).map(([key,label]) => <button key={key} role="tab" aria-selected={reviewTab === key} aria-controls="review-workspace" onClick={() => setReviewTab(key)}>{label}</button>)}</nav>
      <div className="editor-layout" id="review-workspace">

        <DocumentOriginal pages={document.pages} selectedPage={selectedPage} onSelect={setSelectedPage} authorized={document.visibility?.sourceImages !== false} status={document.status} zoomed={zoomed} canDelete={canDelete} disabled={saving || deleting} onZoom={() => { sourceFocus.current = window.document.activeElement as HTMLElement; setImageOpen(true); }} onDelete={() => setDeleteTarget("page")} />

        <div className="editor-panel">


          <section className="card panel-card document-lines">
            <div className="panel-head items-panel-head">
              <h2 className="panel-title">明细核对</h2>
              <button className="link-button compact-source-button" disabled={!page} onClick={() => { sourceFocus.current = window.document.activeElement as HTMLElement; setImageOpen(true); }}>
                {page ? <><DocumentImage src={page.url} alt="" thumbnail /><span>查看原图<small>{document.pages.length} 页</small></span></> : <><FileText size={16} />{document.visibility?.sourceImages === false ? "原图未授权" : "手工录入 · 无原图"}</>}
              </button>
              {editPermission && <BulkMaterialPicker disabled={busy} onAdd={materials => {
                setDirty(true);
                setData(current => current ? { ...current, document: { ...current.document, items: [...current.document.items, ...materials.map((material, index) => ({
                  id: `new-${crypto.randomUUID()}`, lineNo: current.document.items.length + index + 1, rawName: material.name, name: material.name, spec: material.spec, unit: material.unit, quantity: 0, unitPrice: current.document.visibility?.unitPrice === false ? null : 0, amount: viewAmount ? 0 : null, confidence: 1, ingredientId: material.id, matchStatus: "MATCHED" as const, matchScore: 1,
                }))] } } : current);
              }} />}
              <button className="link-button evidence-trigger" onClick={() => setEvidenceOpen(true)}>处理依据</button>

            </div>
            <DocumentItemsEditor
              onAdd={addRow}
              visibility={{ unitPrice: viewUnitPrice, amount: viewAmount }}
              mobileMode={reviewTab === "list" ? "list" : "compare"}
              onActiveItem={setSelectedItemId}
              editorRef={lineEditor}
              externalModalOpen={imageOpen || Boolean(newItem)}
              checks={document.checks}
              onSourcePage={document.visibility?.sourceImages === false || !document.pages.length ? undefined : pageNo => { const index = document.pages.findIndex(p => p.pageNo === pageNo); if (index < 0) { showToast("未找到此明细的来源图片", "error"); return; } sourceFocus.current = window.document.activeElement as HTMLElement; setSelectedPage(index); }}
              items={document.items}
              editable={editPermission && !busy}
              canCreate={canCreateMaster}
              threshold={bootstrap.system.confidenceThreshold}
              onChange={updateItem}
              onNew={(index) => {
                const item = currentDocument.items[index];
                if (item)
                  setNewItem({
                    index,
                    name: item.name || item.rawName,
                    spec: item.spec,
                    unit: item.unit,
                    category: "",
                  });
              }}
              onRemove={(index) => {
                if (busy) return;
                setDirty(true);
                setData((current) =>
                  current
                    ? {
                        ...current,
                        document: {
                          ...current.document,
                          items: current.document.items
                            .filter((_, i) => i !== index)
                            .map((row, i) => ({ ...row, lineNo: i + 1 })),
                        },
                      }
                    : current,
                );
              }}
            />
          </section>

        </div>
        <aside className={"editor-evidence " + (evidenceOpen ? "is-open" : "")} aria-label="处理依据"><button className="icon-button evidence-close" aria-label="关闭处理依据" onClick={() => setEvidenceOpen(false)}><X size={18} /></button>          <section className="card panel-card">
            <div className="panel-head">
              <h2 className="panel-title">
                处理依据
              </h2>
              <span className="pill pill--info">
                {
                  document.checks.filter((check) => check.status === "OPEN")
                    .length
                }{" "}
                项未关闭
              </span>
            </div>
            <div className="panel-body">
              <CheckList checks={document.checks} onLocate={id => { setEvidenceOpen(false); lineEditor.current?.locate(id); }} />
              {viewAmount && <div className="evidence-totals"><h3>金额核对</h3><div><span>明细合计（{document.items.length} 条）</span><strong>{formatMoney(total)}</strong></div><div><span>原单总价</span><strong>{formatMoney(document.totalAmount)}</strong></div><div><span>差额</span><strong className={Math.abs(total - (document.totalAmount ?? 0)) > .01 ? "text-warning" : "text-success"}>{formatMoney(knownTotal === null || document.totalAmount === null ? null : total - document.totalAmount)}</strong></div></div>}
              <div className="field notes-field">
                <label>备注 / 审核说明</label>
                <textarea
                  className="textarea"
                  value={document.notes}
                  disabled={!editPermission || busy || !viewDetails}
                  onChange={(event) =>
                    updateDocument({ notes: event.target.value })
                  }
                  placeholder="记录验收情况、价格差异原因等"
                />
              </div>
            </div>
          </section>


{canReview && (<section className="card panel-card review-decision" id="review-decision"><div className="panel-head"><h2 className="panel-title">审核决定</h2></div><div className="panel-body">
 {errorCount > 0 && <div className="notice notice--red">普通通过受限：{document.checks.filter(c=>c.status==="OPEN"&&c.severity==="ERROR").map(c=>c.title).join("；")}。请先核对保存。{document.duplicateSources?.map(source=><p key={source.id}><Link className="link-button" href={"/documents/"+source.id}>{source.projectName} · {source.date} · 查看重复原图来源</Link></p>)}</div>}
 <label className="field">审核说明 / 退回或强制通过原因<textarea id="decision-note" className="textarea" disabled={busy} value={reviewNote} onChange={event => setReviewNote(event.target.value)} placeholder="普通通过可不填，退回及强制通过必须填写原因" /></label>

 </div></section>)}
          <section className="card panel-card">
            <div className="panel-head">
              <h2 className="panel-title">操作记录</h2>
            </div>
            <div className="panel-body">
              <div className="audit-list">
                {data.audit.slice(0, 10).map((entry) => (
                  <div className="audit-item" key={entry.id}>
                    <span className="audit-dot" />
                    <div className="audit-copy">
                      <strong>{entry.action}</strong>
                      <span>{entry.userName}</span>
                    </div>
                    <span className="audit-time">
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
</aside>
      </div>
      {evidenceOpen && <button className="evidence-backdrop" aria-label="关闭处理依据抽屉" onClick={() => setEvidenceOpen(false)} />}
      </div>
      <footer className={"sticky-actions ledger-actions " + (canReview ? "ledger-actions--review" : "")}>
        <div className="compact-footer-total"><small>{document.items.length} 项 · {dirty ? "修改未保存" : "明细合计"}</small><strong>{viewAmount ? formatMoney(knownTotal) : "金额未授权"}</strong></div>
        <Link className="btn btn--outline desktop-return" href={returnTarget}>{returnTarget === "/reviews" ? "返回队列" : "返回列表"}</Link>
        {editPermission && <button className={"btn " + (canReview ? "btn--primary" : "btn--outline")} onClick={() => save()} disabled={busy}>{saving && <LoaderCircle className="spin" size={16} />}{document.status === "PENDING_REVIEW" ? "保存修改" : "保存草稿"}</button>}
        {canSubmit && <button className="btn btn--primary" disabled={busy} onClick={submit}>{document.batchId?"返回批次核对并提交":"提交审核"}</button>}
        {canReview && <div className="ledger-review-actions">
          {canReturn && <button className="btn btn--danger" disabled={busy} onClick={() => decide("return")}>退回补充</button>}
          {canApprove && <button className="btn btn--primary" disabled={busy || errorCount > 0} title={errorCount > 0 ? "严重异常待处理" : "普通通过"} onClick={() => decide("approve")}>普通通过</button>}
          {errorCount > 0 && canOverride && <button className="btn btn--danger" disabled={busy} onClick={() => decide("approve", true)}>填写原因并强制通过</button>}
        </div>}
        <span className="save-state">{!editPermission ? "当前单据只读" : canReview ? errorCount > 0 ? "严重异常待处理，普通通过受限" : "修改后请保存再审核" : dirty ? "有未保存修改" : canSubmit ? "提交后由主管处理价格异常" : "修改已保存"}</span>

      </footer>
      <p className="recovery-footnote">未提交内容在本浏览器暂存最长12小时，保存、放弃或退出后清理。</p>

      {totalsOpen && <EditorSheet title="单据金额与合计" onClose={() => setTotalsOpen(false)}>{amountPanel}<button className="btn btn--primary" onClick={() => setTotalsOpen(false)}>完成</button></EditorSheet>}
      {infoOpen && !showSupplierDialog && <EditorSheet title="单据信息与供应商" onClose={() => setInfoOpen(false)}>{documentInfo}<button className="btn btn--primary line-sheet-done" onClick={() => setInfoOpen(false)}>完成</button></EditorSheet>}
      {imageOpen && <div className="modal-backdrop" onMouseDown={() => { setImageOpen(false); sourceFocus.current?.focus(); }}><section className="modal-card image-lightbox" role="dialog" aria-modal="true" aria-label="原图查看" onMouseDown={e => e.stopPropagation()}>
 <div className="modal-head"><h2>原图 第{selectedPage + 1}/{document.pages.length}页</h2><button className="icon-button" autoFocus aria-label="关闭原图" onClick={() => { setImageOpen(false); sourceFocus.current?.focus(); }}>×</button></div>
 <div className="page-tabs">{document.pages.map((p,i) => <button key={p.id} className={i === selectedPage ? "is-active" : ""} onClick={() => setSelectedPage(i)}>第{i + 1}页</button>)}<button onClick={() => setZoomed(value => !value)}>{zoomed ? "还原" : "放大"}</button></div>
 <div className={"image-stage " + (zoomed ? "is-zoomed" : "")}>{page && <DocumentImage src={page.url} alt={"送货单第" + (selectedPage + 1) + "页原图"} />}</div></section></div>}
 {showSupplierDialog ? (
        <div
          className="modal-backdrop"
          onMouseDown={() => setShowSupplierDialog(false)}
        >
          <div
            className="modal-card"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>新建供应商</h2>
              <button
                className="icon-button"
                type="button"
                onClick={() => setShowSupplierDialog(false)}
              >
                ×
              </button>
            </div>
            <p className="text-muted">
              系统已先推荐相近供应商。确认确实不在库中后再新建，避免错字产生重复主数据。
            </p>
            <div className="field">
              <label>规范供应商名称</label>
              <input
                className="input"
                value={newSupplierName}
                onChange={(event) => setNewSupplierName(event.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button
                className="btn btn--outline"
                type="button"
                onClick={() => setShowSupplierDialog(false)}
              >
                取消
              </button>
              <button
                className="btn btn--primary"
                type="button"
                onClick={createSupplier}
              >
                确认新建
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {newItem ? (
        <div className="modal-backdrop" onMouseDown={() => setNewItem(null)}>
          <div
            className="modal-card"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>新建原材料</h2>
              <button
                className="icon-button"
                type="button"
                onClick={() => setNewItem(null)}
              >
                ×
              </button>
            </div>
            <p className="text-muted">
              原材料必须填写单位。名称、规格和单位会用于后续合同价与跨供应商比价。
            </p>
            <div className="form-grid">
              <div className="field">
                <label>规范品名</label>
                <input
                  className="input"
                  value={newItem.name}
                  onChange={(event) =>
                    setNewItem({ ...newItem, name: event.target.value })
                  }
                />
              </div>
              <div className="field">
                <label>单位</label>
                <input
                  className="input"
                  value={newItem.unit}
                  placeholder="如 kg / 袋 / 桶"
                  onChange={(event) =>
                    setNewItem({
                      ...newItem,
                      unit: event.target.value,
                      spec: event.target.value,
                    })
                  }
                />
              </div>
              <div className="field">
                <label>规格</label>
                <input
                  className="input"
                  value={newItem.spec}
                  readOnly
                  aria-label="新材料规格（随单位填写）"
                />
              </div>
              <div className="field">
                <label>分类</label>
                <input
                  className="input"
                  value={newItem.category}
                  placeholder="蔬菜 / 肉禽 / 粮油"
                  onChange={(event) =>
                    setNewItem({ ...newItem, category: event.target.value })
                  }
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn--outline"
                type="button"
                onClick={() => setNewItem(null)}
              >
                取消
              </button>
              <button
                className="btn btn--primary"
                type="button"
                onClick={createIngredient}
              >
                确认新建
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="modal-backdrop" onMouseDown={() => {if (!deleting) setDeleteTarget(null);}}>
          <div className="modal-card" role="dialog" aria-modal="true"
            aria-label={deletesWholeDraft ? deleteLabel : "删除图片"}
            onMouseDown={event => event.stopPropagation()}>
            <div className="modal-head">
              <h2>{deletesWholeDraft ? deleteLabel : "删除图片"}</h2>
              <button className="icon-button" type="button" disabled={deleting}
                aria-label="关闭删除确认" onClick={() => setDeleteTarget(null)}>×</button>
            </div>
            {deletesWholeDraft ? (
              <p style={{overflowWrap: "anywhere"}}>将永久删除这张单据、{document.pages.length} 张图片和 {document.items.length} 条明细。
                {deleteTarget === "page" ? "这是最后一张图片，会同时删除整张单据。" : ""}
                不设回收站，删除后无法在页面恢复。</p>
            ) : (
              <div>
                <p style={{overflowWrap: "anywhere"}}>将删除第 {page.pageNo} 页“{page.fileName}”及其 {sourceItemCount} 条来源明细。
                  其余修改会先保存，剩余图片和明细保留；整单总价需要重新核对填写。不设回收站。</p>
                {hasUnknownSources ? <p>部分旧明细没有来源页，会保留，请人工核对并移除误传图片对应的明细。</p> : null}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn--outline" type="button" disabled={deleting}
                onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="btn btn--danger" type="button" disabled={deleting || saving}
                onClick={confirmDeletion}>
                {deleting ? "正在删除…" : deletesWholeDraft ? `确认${deleteLabel}` : "确认删除图片"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {withdrawOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={() => setWithdrawOpen(false)}
        >
          <div
            className="modal-card"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>撤回审核</h2>
              <button
                className="icon-button"
                type="button"
                onClick={() => setWithdrawOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="text-muted">
              撤回后单据会回到“待审核”状态，由主管修改后重新审核；本次操作与原因会写入操作记录。
            </p>
            <div className="field">
              <label>撤回原因</label>
              <textarea
                className="textarea"
                value={withdrawNote}
                onChange={(event) => setWithdrawNote(event.target.value)}
                placeholder="例如：单价录入错误，需修改后重新审核"
              />
            </div>
            <div className="modal-actions">
              <button
                className="btn btn--outline"
                type="button"
                onClick={() => setWithdrawOpen(false)}
              >
                取消
              </button>
              <button
                className="btn btn--primary"
                type="button"
                onClick={withdrawApproval}
                disabled={withdrawing}
              >
                {withdrawing ? "撤回中…" : "确认撤回"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
