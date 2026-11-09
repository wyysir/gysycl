import sharp from "sharp";
import { env } from "@/lib/config";
import { ApiError } from "./errors";
import { dateOnly, normalizeName, normalizeUnit, parseDateOnly, parseMoney, roundMoney } from "@/lib/text";

export type ExtractedItem = {
  lineNo: number;
  rawName: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  confidence: number;
  rawOcr: Record<string, unknown>;
};

export type ExtractedDocument = {
  provider: string;
  supplierName: string;
  docNo: string;
  docDate: Date | null;
  subtotal: number;
  totalAmount: number;
  items: ExtractedItem[];
  warnings: string[];
  raw: Record<string, unknown>;
};

export type PreprocessedImage = {
  buffer: Buffer;
  mime: "image/jpeg";
  width: number;
  height: number;
};

let preprocessing = 0;
const waiting: Array<() => void> = [];
export async function preprocessImage(buffer: Buffer): Promise<PreprocessedImage> {
  if (preprocessing >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  else preprocessing++;
  try { return await preprocessLimited(buffer); }
  finally { const next = waiting.shift(); if(next) next(); else preprocessing--; }
}
async function preprocessLimited(buffer: Buffer): Promise<PreprocessedImage> {
  const image = sharp(buffer, { failOn: "none" }).rotate();
  const result = await image
    .resize({
      width: 3000,
      height: 3000,
      fit: "inside",
      withoutEnlargement: true,
    })
    .grayscale()
    .normalize()
    .jpeg({ quality: 91, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: result.data,
    mime: "image/jpeg",
    width: result.info.width,
    height: result.info.height,
  };
}

const VLM_PROMPT = `你是餐饮供应链送货单录入专家。请读取图片中的送货单，严格输出 JSON，不要输出 Markdown。
单号由系统生成，不要识别或返回图片中的单号。需要支持手写和表格。无法确定的字段必须降低 confidence，不要猜测后给高置信度。
返回：
{
  "supplierName": "",
  "docDateText": "纸上日期原文，未写年份不要补",
  "docDate": "YYYY-MM-DD或空字符串",
  "dateConfidence": 0.0,
  "writingType": "printed或handwritten或mixed",
  "subtotal": 0,
  "totalAmount": 0,
  "items": [
    {
      "lineNo": 1,
      "rawName": "",
      "spec": "",
      "unit": "",
      "quantity": 0,
      "unitPrice": 0,
      "amount": 0,
      "nameConfidence": 0.0,
      "unitConfidence": 0.0,
      "confidence": 0.0
    }
  ],
  "warnings": []
}
字段规则：
1. quantity 只填实际数量数值，unit 只填计量单位。例如“5斤”拆为 quantity=5、unit="斤"。
2. 按本系统业务要求，spec 必须与 unit 相同。例如“5斤”填 spec="斤"；“5包 x 4 = 20”填 quantity=5、unit="包"、spec="包"，不能将数量、单价或算式写入规格。
3. 没有识别到单位时，unit 和 spec 留空，不要猜测或把数量当作单位。
4. 手写内容可能横跨印刷表格的多个列，也可能全部写在“品名”栏。必须从整行“品名 数量单位 × 单价 = 金额”提取字段，不要因为印刷的单位栏为空就漏掉行内单位。
   例如“干香菇1斤×38=38”→quantity=1,unit="斤",spec="斤",unitPrice=38,amount=38；“小圆子5包×4=20”→quantity=5,unit="包",spec="包"；“梅干菜5斤×12=60”→quantity=5,unit="斤",spec="斤",unitPrice=12,amount=60，不要把单价12填成数量。
5. 单位以该行数量格定位，沿同一个上下边框读取紧邻单位格。折痕使格线弯曲时沿真实格线追踪，不按品名的水平高度配单位，不按商品惯用单位猜。
6. 手写品名按笔画逐字读取，勿替换成更熟悉的商品；看不清的字用?，降低nameConfidence。品名不要包含数量单位或算式，单位保留明确写出的“大桶”等。
7. docDateText只抄纸上送货/开单日期，忽略相机水印及手机时间。年月日明确齐全才填docDate与高dateConfidence；两位年份按20xx。只有月日或年份空白则docDate留空，不用当前年份补全；区分“3日”与“31”。
金额必须忠实于单据，不要把 amount 强制改成 quantity × unitPrice；金额不一致正是需要人工复核的异常。
请在一次响应中完成全部字段，不请求或依赖第二次校读。`;

async function runQwenVl(images: PreprocessedImage[], pageNo = 1, pageCount = 1) {
  if (!env.DASHSCOPE_API_KEY) throw new Error("未配置 DASHSCOPE_API_KEY");
  const response = await fetch(`${env.DASHSCOPE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.QWEN_VL_MODEL,
      enable_thinking: false,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: VLM_PROMPT + (pageCount > 1
                ? `\n当前仅提供同一供应商一批图片的第 ${pageNo}/${pageCount} 页，可能是原单续页，也可能有不同日期或单号。只提取本页全部明细和本页原单信息，不要选择主单据，不要补写其他页或只保留最后一页。原图没有的供应商、单号、日期留空；subtotal/totalAmount 没有明确印写时填 null。另返回 totalScope（document 表示明确本张原单整单总计，page 表示明确本页小计，unknown 表示不明确），每张图片的 totalAmount 提取该张原单印写的总价，系统会将各张总价相加；不要返回其他图片的金额。`
                : ""),
            },
            ...images.map((image) => ({
              type: "image_url",
              image_url: {
                url: `data:${image.mime};base64,${image.buffer.toString("base64")}`,
                detail: "high",
              },
            })),
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(
      `Qwen-VL 识别失败 (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = payload.choices?.[0]?.message?.content || "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("视觉模型未返回结构化 JSON");
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

function normalizeConfidence(value: unknown): number {
  const number = parseMoney(value);
  if (number > 1) return Math.min(1, number / 100);
  return value == null || value === "" ? 0.72 : Math.max(0, Math.min(1, number));
}

function normalizeItem(value: unknown, index: number): ExtractedItem {
  const item =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const quantityText = String(item.quantity ?? "").normalize("NFKC").trim();
  const quantityWithUnit = quantityText.match(/^([+-]?\d[\d,]*(?:\.\d+)?)\s*(公斤|千克|kg|斤|克|g|两|吨|包|袋|箱|件|盒|桶|瓶|罐|个|支|捆|把|板|盘|份|套|毫升|升|ml|l)$/i);
  // Some model responses keep the entire handwritten arithmetic in spec while
  // leaving unit blank. Recover the written unit without replacing quantity.
  const specWithUnit = String(item.spec || "").normalize("NFKC").trim().match(/^(?:[+-]?\d[\d,]*(?:\.\d+)?\s*)?(公斤|千克|kg|斤|克|g|两|吨|包|袋|箱|件|盒|桶|瓶|罐|个|支|捆|把|板|盘|份|套|毫升|升|ml|l)\s*(?:[x×*＝=].*)?$/i);
  let rawName = String(item.rawName || item.name || "").trim();
  const suffix = rawName.normalize("NFKC").match(/^(.*?)\s*(\d+(?:\.\d+)?)\s*(大桶|公斤|千克|kg|斤|克|g|两|吨|包|袋|代|箱|件|盒|桶|瓶|罐|个|支|捆|把|板|盘|份|套)(?:\s*[x×*＝=].*)?[.,，。]?$/i);
  const matchingSuffix = suffix && suffix[1].trim() && parseMoney(suffix[2]) === parseMoney(quantityWithUnit?.[1] ?? item.quantity);
  if (matchingSuffix) rawName = suffix[1].trim();
  const unit = normalizeUnit(String(item.unit || quantityWithUnit?.[2] || specWithUnit?.[1] || (matchingSuffix ? suffix[3] : "")).trim());
  const quantity = parseMoney(quantityWithUnit?.[1] ?? item.quantity);
  // A multi-character package unit can leak into the name even when quantity
  // and unit were already extracted. Keep the model's original text for review.
  // Never strip single-character units (e.g. the 桶 in 水桶), or an unmatched unit.
  const duplicatedPackage = quantity > 0 && /^[大小][桶袋包箱盒瓶罐]$/u.test(unit)
    && rawName.endsWith(unit) && rawName.slice(0, -unit.length).trim().length > 0;
  if (duplicatedPackage) rawName = rawName.slice(0, -unit.length).trim();
  return {
    lineNo: Number(item.lineNo) || index + 1,
    rawName,
    spec: unit,
    unit,
    quantity,
    unitPrice: parseMoney(item.unitPrice),
    amount: parseMoney(item.amount),
    confidence: Math.min(normalizeConfidence(item.confidence), duplicatedPackage ? 0.85 : 1),
    rawOcr: duplicatedPackage ? { ...item, nameNormalization: { reason: "duplicated_package_unit", unit } } : item,
  };
}

// Require literal date evidence, rather than accepting a model-invented year.
function readDocumentDate(vlm: Record<string, unknown>): Date | null {
  if (normalizeConfidence(vlm.dateConfidence) < 0.9) return null;
  const text = String(vlm.docDateText ?? "").normalize("NFKC").trim();
  const match = text.match(/^(?:(?:送货|开单|单据)?日期[:：]?\s*)?(\d{4}|\d{2})[年./-]\s*(\d{1,2})[月./-]\s*(\d{1,2})日?$/);
  if (!match) return null;
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  const written = parseDateOnly(`${year}-${match[2]}-${match[3]}`);
  const claimed = parseDateOnly(vlm.docDate);
  return written && claimed && dateOnly(written) === dateOnly(claimed) ? written : null;
}

function mockExtract(): ExtractedDocument {
  const items = [
    {
      lineNo: 1,
      rawName: "青莱",
      spec: "kg",
      unit: "kg",
      quantity: 36,
      unitPrice: 4.25,
      amount: 153,
      confidence: 0.78,
      rawOcr: { source: "mock" },
    },
    {
      lineNo: 2,
      rawName: "士豆",
      spec: "kg",
      unit: "kg",
      quantity: 58,
      unitPrice: 3.15,
      amount: 182.7,
      confidence: 0.74,
      rawOcr: { source: "mock" },
    },
  ];
  return {
    provider: "mock",
    supplierName: "上海鲜禾农副产品有限公司",
    docNo: "",
    docDate: new Date(),
    subtotal: 335.7,
    totalAmount: 335.7,
    items,
    warnings: [
      "当前为演示识别模式，结果不读取图片内容；配置 DashScope 后可切换真实识别。",
      "演示结果故意保留了手写错字，用于测试相近品名高亮与确认流程。",
    ],
    raw: { mode: "mock", items },
  };
}

async function extractPage(
  rawImage: Buffer,
  pageNo: number,
  pageCount: number,
  prepared?: PreprocessedImage,
): Promise<ExtractedDocument> {
  const images = [prepared ?? await preprocessImage(rawImage)];
  const warnings: string[] = [];
  // Exactly one model request per source image. Local normalization and date
  // validation do not trigger another paid inference.
  const vlm = await runQwenVl(images, pageNo, pageCount);
  if (!vlm || typeof vlm !== "object" || Array.isArray(vlm)) {
    throw new Error("视觉模型未返回有效结构化结果");
  }
  const rawItems = Array.isArray(vlm.items) ? vlm.items : [];
  // Missing writing type is treated as uncertain, never as a clean printed row.
  const handwritten = vlm.writingType !== "printed";
  const items = rawItems.map((item, index) => {
    const normalized = normalizeItem(item, index);
    const nameUncertain = normalizeConfidence(normalized.rawOcr.nameConfidence) < 0.9;
    const unitUncertain = normalizeConfidence(normalized.rawOcr.unitConfidence) < 0.9;
    if (normalized.rawOcr.nameNormalization) {
      warnings.push(`第 ${normalized.lineNo} 行品名中重复的包装单位已分离，请对照原图确认名称。`);
    }
    if (handwritten || nameUncertain || normalized.rawName.includes("?")) {
      warnings.push(`第 ${normalized.lineNo} 行手写或不确定品名，请对照原图核对。`);
    }
    if (!normalized.unit || unitUncertain) {
      warnings.push(`第 ${normalized.lineNo} 行单位缺失或不确定，请沿原图行格核对。`);
    }
    let confidence = Math.min(normalized.confidence,
      handwritten || nameUncertain || unitUncertain || !normalized.unit || normalized.rawName.includes("?") ? 0.85 : 1);
    if (
      normalized.quantity > 0 &&
      normalized.unitPrice > 0 &&
      Math.abs(
        roundMoney(normalized.quantity * normalized.unitPrice) -
          normalized.amount,
      ) > 0.02
    ) {
      confidence -= 0.16;
      warnings.push(`第 ${normalized.lineNo} 行金额不勾稽，已降低置信度。`);
    }
    return {
      ...normalized,
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  });

  if (!items.length) {
    warnings.push("未从图片中提取到明细，请人工录入。");
  }
  const subtotal = vlm.subtotal == null
    ? roundMoney(items.reduce((sum, item) => sum + item.amount, 0))
    : parseMoney(vlm.subtotal);
  const totalAmount = parseMoney(vlm.totalAmount ?? vlm.total ?? subtotal);
  const docDate = readDocumentDate(vlm);
  if (!docDate) warnings.push("原单日期缺失、不完整或不确定，请核对送货日期；暂保留新建单据时选择的日期。");
  else if (handwritten) warnings.push("原单为手写或混合单据，已读取的送货日期仍需对照原图核对。");
  return {
    provider: env.QWEN_VL_MODEL,
    supplierName: String(vlm.supplierName || vlm.supplier || "").trim(),
    docNo: "",
    docDate,
    subtotal,
    totalAmount,
    items,
    warnings: [
      ...warnings,
      ...(Array.isArray(vlm.warnings) ? vlm.warnings.map(String) : []),
    ],
    raw: { vlm, recognitionVersion: "qwen-single-v4-package" },
  };
}

export async function extractDocuments(rawImages: Buffer[], preparedImages?: Array<PreprocessedImage | undefined>): Promise<ExtractedDocument> {
  if (!rawImages.length || rawImages.length > 5) {
    throw new ApiError(400, "识别必须包含 1–5 页图片");
  }
  if (env.OCR_MODE === "mock") return mockExtract();
  if (rawImages.length === 1) return extractPage(rawImages[0], 1, 1, preparedImages?.[0]);

  // One image per request makes page coverage deterministic. A missing page
  // must not turn a partial response into a completed document.
  const pages: ExtractedDocument[] = [];
  for (const [index, image] of rawImages.entries()) {
    try {
      const page = await extractPage(image, index + 1, rawImages.length, preparedImages?.[index]);
      if (!page.items.length) {
        const message = page.warnings.join("；") || "未识别出明细";
        throw new ApiError(422, message);
      }
      pages.push(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ApiError) {
        throw new ApiError(error.status, `第 ${index + 1} 页识别未完成：${message}`);
      }
      throw new Error(`第 ${index + 1} 页识别未完成：${message}`);
    }
  }

  // User-approved grouping: same supplier, including multiple original notes.
  // Different suppliers must still be uploaded in separate batches.
  const suppliers = pages.map(page => normalizeName(page.supplierName)).filter(Boolean);
  if (new Set(suppliers).size > 1) {
    throw new ApiError(422, "图片中的供应商不一致，请按供应商分批上传；原图已保留");
  }
  const items = pages.flatMap((page, index) => page.items.map(item => ({
    ...item,
    rawOcr: { ...item.rawOcr, pageNo: index + 1, pageLineNo: item.lineNo },
  }))).map((item, index) => ({ ...item, lineNo: index + 1 }));
  const warnings = pages.flatMap((page, index) => page.warnings.map(warning => `第 ${index + 1} 页：${warning}`));
  // Each uploaded image is counted once using its explicitly printed total.
  // Missing totals must not be replaced with recognized line sums.
  const pageTotals = pages.map(page => {
    const vlm = page.raw.vlm as Record<string, unknown>;
    const value = vlm.totalAmount ?? vlm.total;
    return value == null ? null : parseMoney(value);
  });
  const missingPages = pageTotals.flatMap((value, index) => value === null ? [index + 1] : []);
  const totalAmount = missingPages.length ? 0 : roundMoney(pageTotals.reduce<number>((sum, value) => sum + (value ?? 0), 0));
  if (missingPages.length) {
    warnings.push(`第 ${missingPages.join("、")} 张未识别到原单总价，请补录全部原单总价的合计；未用明细合计替代`);
  }
  const docNos = [...new Set(pages.map(page => page.docNo).filter(Boolean))];
  if (docNos.length > 1) warnings.push("包含不同原单号，合并单号留空，各页原单号已保留");
  warnings.push("多页按上传时选择的日期归档，各页原日期已保留，请核对合并总价");
  return {
    provider: pages[0].provider,
    supplierName: pages.find(page => page.supplierName)?.supplierName || "",
    docNo: docNos.length === 1 ? docNos[0] : "",
    docDate: null,
    subtotal: roundMoney(items.reduce((sum, item) => sum + item.amount, 0)),
    totalAmount,
    items,
    warnings,
    raw: {
      pages: pages.map((page, index) => ({
        pageNo: index + 1, itemCount: page.items.length,
        sourceDocNo: page.docNo, sourceDocDate: page.docDate ? dateOnly(page.docDate) : "",
        sourceTotal: (page.raw.vlm as Record<string, unknown>).totalAmount ?? null,
        ...page.raw,
      })),
      recognitionVersion: "qwen-single-v4-package",
    },
  };
}
