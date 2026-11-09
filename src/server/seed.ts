import crypto from "node:crypto";
import type { Db } from "@/lib/prisma";
import { hashPassword } from "@/lib/passwords";
import { normalizeName, normalizeUnit, roundMoney } from "@/lib/text";
import { recomputeDocumentChecks } from "./checks";

const projectRows = [
  { id: "prj_sh", code: "SH-HQ", name: "上海总部食堂", region: "华东" },
  { id: "prj_hz", code: "HZ-PARK", name: "杭州园区食堂", region: "华东" },
  { id: "prj_sz", code: "SZ-FACTORY", name: "苏州工厂食堂", region: "华东" },
  { id: "prj_nj", code: "NJ-PROJECT", name: "南京项目点", region: "华东" },
];

const supplierRows = [
  {
    id: "sup_sh",
    name: "上海鲜禾农副产品有限公司",
    short: "鲜禾农副",
    contactName: "王经理",
    contactPhone: "13800001111",
  },
  {
    id: "sup_hz",
    name: "杭州绿源蔬菜配送有限公司",
    short: "绿源蔬菜",
    contactName: "李经理",
    contactPhone: "13800002222",
  },
  {
    id: "sup_js",
    name: "江苏丰味食品有限公司",
    short: "丰味食品",
    contactName: "陈经理",
    contactPhone: "13800003333",
  },
  {
    id: "sup_ly",
    name: "华东粮油供应链有限公司",
    short: "华东粮油",
    contactName: "赵经理",
    contactPhone: "13800004444",
  },
  {
    id: "sup_nj",
    name: "南京每日鲜肉业有限公司",
    short: "每日鲜肉",
    contactName: "周经理",
    contactPhone: "13800005555",
  },
];

const ingredientRows = [
  ["ing_qc", "青菜", "散装", "kg", "蔬菜", ["青莱", "小青菜", "上海青"]],
  ["ing_td", "土豆", "散装", "kg", "蔬菜", ["马铃薯", "洋芋", "士豆"]],
  ["ing_xhs", "西红柿", "散装", "kg", "蔬菜", ["番茄", "西红杮"]],
  ["ing_zwr", "猪五花肉", "冷鲜", "kg", "肉禽", ["五花肉", "猪五花"]],
  ["ing_jxr", "鸡胸肉", "冷鲜", "kg", "肉禽", ["鸡脯肉"]],
  ["ing_jd", "鸡蛋", "散装", "kg", "蛋类", ["鲜鸡蛋", "鸡旦"]],
  ["ing_dm", "大米", "25kg/袋", "袋", "粮油", ["珍珠米", "粳米"]],
  ["ing_sy", "食用油", "5L/桶", "桶", "粮油", ["大豆油", "色拉油"]],
  ["ing_mf", "面粉", "25kg/袋", "袋", "粮油", ["小麦粉"]],
  ["ing_df", "豆腐", "散装", "kg", "豆制品", ["豆付", "老豆腐"]],
  ["ing_ly", "鲈鱼", "鲜活", "kg", "水产", ["海鲈鱼"]],
  ["ing_sj", "生姜", "散装", "kg", "调味", ["老姜", "鲜姜"]],
] as const;

const contractRows: Array<[string, string, string, number, string, string]> = [
  ["prj_sh", "sup_sh", "ing_qc", 4.2, "散装", "kg"],
  ["prj_sh", "sup_sh", "ing_td", 3.1, "散装", "kg"],
  ["prj_sh", "sup_sh", "ing_xhs", 5.8, "散装", "kg"],
  ["prj_sh", "sup_ly", "ing_dm", 118, "25kg/袋", "袋"],
  ["prj_sh", "sup_ly", "ing_sy", 68, "5L/桶", "桶"],
  ["prj_hz", "sup_hz", "ing_qc", 4.35, "散装", "kg"],
  ["prj_hz", "sup_hz", "ing_td", 3.2, "散装", "kg"],
  ["prj_hz", "sup_ly", "ing_dm", 119, "25kg/袋", "袋"],
  ["prj_hz", "sup_js", "ing_zwr", 24.8, "冷鲜", "kg"],
  ["prj_sz", "sup_js", "ing_zwr", 24.5, "冷鲜", "kg"],
  ["prj_sz", "sup_js", "ing_jxr", 16.8, "冷鲜", "kg"],
  ["prj_sz", "sup_sh", "ing_qc", 4.25, "散装", "kg"],
  ["prj_nj", "sup_nj", "ing_zwr", 25.2, "冷鲜", "kg"],
  ["prj_nj", "sup_nj", "ing_jxr", 17.1, "冷鲜", "kg"],
  ["prj_nj", "sup_nj", "ing_ly", 32, "鲜活", "kg"],
  ["prj_nj", "sup_sh", "ing_qc", 4.3, "散装", "kg"],
];

type SampleDocument = {
  id: string;
  no: string;
  date: string;
  projectId: string;
  supplierId: string;
  status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "NEEDS_REVISION";
  items: Array<{
    ingredientId: string;
    name: string;
    spec: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    confidence: number;
    matchStatus?: "MATCHED" | "SIMILAR";
  }>;
  notes?: string;
  reviewNote?: string;
};

const sampleDocuments: SampleDocument[] = [
  {
    id: "doc_demo_001",
    no: "XH20261012001",
    date: "2026-10-12",
    projectId: "prj_sh",
    supplierId: "sup_sh",
    status: "APPROVED",
    notes: "验收正常",
    items: [
      { ingredientId: "ing_qc", name: "青菜", spec: "散装", unit: "kg", quantity: 50, unitPrice: 4.2, confidence: 0.98 },
      { ingredientId: "ing_td", name: "土豆", spec: "散装", unit: "kg", quantity: 80, unitPrice: 3.1, confidence: 0.97 },
    ],
  },
  {
    id: "doc_demo_002",
    no: "LY20261015008",
    date: "2026-10-15",
    projectId: "prj_hz",
    supplierId: "sup_hz",
    status: "PENDING_REVIEW",
    notes: "手写单，单价需重点复核",
    items: [
      { ingredientId: "ing_qc", name: "青菜", spec: "散装", unit: "kg", quantity: 40, unitPrice: 4.8, confidence: 0.79, matchStatus: "SIMILAR" },
      { ingredientId: "ing_td", name: "土豆", spec: "散装", unit: "kg", quantity: 60, unitPrice: 3.2, confidence: 0.91 },
    ],
  },
  {
    id: "doc_demo_003",
    no: "FW20261016003",
    date: "2026-10-16",
    projectId: "prj_sz",
    supplierId: "sup_js",
    status: "PENDING_REVIEW",
    items: [
      { ingredientId: "ing_zwr", name: "猪五花肉", spec: "冷鲜", unit: "kg", quantity: 120, unitPrice: 26.8, confidence: 0.94 },
      { ingredientId: "ing_jxr", name: "鸡胸肉", spec: "冷鲜", unit: "kg", quantity: 80, unitPrice: 16.8, confidence: 0.96 },
    ],
  },
  {
    id: "doc_demo_004",
    no: "HD20261011016",
    date: "2026-10-11",
    projectId: "prj_sh",
    supplierId: "sup_ly",
    status: "APPROVED",
    items: [
      { ingredientId: "ing_dm", name: "大米", spec: "25kg/袋", unit: "袋", quantity: 20, unitPrice: 118, confidence: 0.99 },
      { ingredientId: "ing_sy", name: "食用油", spec: "5L/桶", unit: "桶", quantity: 8, unitPrice: 68, confidence: 0.99 },
    ],
  },
  {
    id: "doc_demo_005",
    no: "XH20261018009",
    date: "2026-10-18",
    projectId: "prj_nj",
    supplierId: "sup_sh",
    status: "DRAFT",
    items: [
      { ingredientId: "ing_qc", name: "青菜", spec: "散装", unit: "kg", quantity: 30, unitPrice: 4.2, confidence: 0.88, matchStatus: "SIMILAR" },
      { ingredientId: "ing_td", name: "土豆", spec: "散装", unit: "kg", quantity: 50, unitPrice: 3.1, confidence: 0.93 },
    ],
  },
  {
    id: "doc_demo_006",
    no: "XH20260928003",
    date: "2026-09-28",
    projectId: "prj_sh",
    supplierId: "sup_sh",
    status: "APPROVED",
    items: [
      { ingredientId: "ing_qc", name: "青菜", spec: "散装", unit: "kg", quantity: 45, unitPrice: 4, confidence: 0.97 },
      { ingredientId: "ing_td", name: "土豆", spec: "散装", unit: "kg", quantity: 75, unitPrice: 3, confidence: 0.97 },
    ],
  },
  {
    id: "doc_demo_007",
    no: "NJ20261008021",
    date: "2026-10-08",
    projectId: "prj_nj",
    supplierId: "sup_nj",
    status: "APPROVED",
    items: [
      { ingredientId: "ing_zwr", name: "猪五花肉", spec: "冷鲜", unit: "kg", quantity: 70, unitPrice: 25.2, confidence: 0.97 },
      { ingredientId: "ing_jxr", name: "鸡胸肉", spec: "冷鲜", unit: "kg", quantity: 50, unitPrice: 17.1, confidence: 0.96 },
      { ingredientId: "ing_ly", name: "鲈鱼", spec: "鲜活", unit: "kg", quantity: 20, unitPrice: 32, confidence: 0.95 },
    ],
  },
  {
    id: "doc_demo_008",
    no: "LY20261009011",
    date: "2026-10-09",
    projectId: "prj_hz",
    supplierId: "sup_hz",
    status: "APPROVED",
    items: [
      { ingredientId: "ing_qc", name: "青菜", spec: "散装", unit: "kg", quantity: 42, unitPrice: 4.3, confidence: 0.96 },
      { ingredientId: "ing_td", name: "土豆", spec: "散装", unit: "kg", quantity: 66, unitPrice: 3.2, confidence: 0.96 },
    ],
  },
];

export async function seedDatabase(db: Db): Promise<boolean> {
  const existing = await db.user.count();
  if (existing > 0) return false;

  await db.$transaction(async (tx) => {
    for (const project of projectRows) {
      await tx.project.create({ data: project });
    }
    for (const supplier of supplierRows) {
      await tx.supplier.create({
        data: {
          id: supplier.id,
          name: supplier.name,
          normalizedName: normalizeName(supplier.name),
          contactName: supplier.contactName,
          contactPhone: supplier.contactPhone,
          aliases: {
            create: [
              {
                alias: supplier.short,
                normalizedAlias: normalizeName(supplier.short),
              },
            ],
          },
        },
      });
    }
    for (const [id, name, spec, unit, category, aliases] of ingredientRows) {
      await tx.ingredient.create({
        data: {
          id,
          name,
          normalizedName: normalizeName(name),
          spec,
          normalizedSpec: normalizeName(spec),
          unit,
          category,
          aliases: {
            create: aliases.map((alias) => ({
              alias,
              normalizedAlias: normalizeName(alias),
            })),
          },
        },
      });
    }
  });

  const projects = await db.project.findMany();
  const projectIdByCode = new Map(projects.map((project) => [project.code, project.id]));
  const projectIdMap: Record<string, string> = {
    prj_sh: projectIdByCode.get("SH-HQ")!,
    prj_hz: projectIdByCode.get("HZ-PARK")!,
    prj_sz: projectIdByCode.get("SZ-FACTORY")!,
    prj_nj: projectIdByCode.get("NJ-PROJECT")!,
  };

  const users = [
    {
      id: "usr_admin",
      employeeNo: "admin",
      name: "系统管理员",
      password: "admin123",
      globalRole: "ADMIN" as const,
    },
    {
      id: "usr_finance",
      employeeNo: "finance",
      name: "财务主管",
      password: "finance123",
      globalRole: "FINANCE" as const,
    },
    {
      id: "usr_super",
      employeeNo: "supervisor",
      name: "华东项目主管",
      password: "super123",
      globalRole: "STAFF" as const,
    },
    {
      id: "usr_site_sh",
      employeeNo: "site_sh",
      name: "上海采购员",
      password: "site123",
      globalRole: "STAFF" as const,
    },
    {
      id: "usr_site_hz",
      employeeNo: "site_hz",
      name: "杭州采购员",
      password: "site123",
      globalRole: "STAFF" as const,
    },
  ];

  await db.$transaction(async (tx) => {
    for (const user of users) {
      await tx.user.create({
        data: {
          id: user.id,
          employeeNo: user.employeeNo,
          name: user.name,
          passwordHash: hashPassword(user.password),
          globalRole: user.globalRole,
        },
      });
    }
    for (const projectId of ["prj_sh", "prj_hz", "prj_sz", "prj_nj"]) {
      await tx.projectMembership.create({
        data: {
          userId: "usr_super",
          projectId: projectIdMap[projectId],
          role: "SUPERVISOR",
        },
      });
    }
    await tx.projectMembership.create({
      data: {
        userId: "usr_site_sh",
        projectId: projectIdMap.prj_sh,
        role: "SUBMITTER",
      },
    });
    await tx.projectMembership.create({
      data: {
        userId: "usr_site_hz",
        projectId: projectIdMap.prj_hz,
        role: "SUBMITTER",
      },
    });
  });

  for (const [projectSlug, supplierId, ingredientId, price, spec, unit] of contractRows) {
    await db.contract.create({
      data: {
        projectId: projectIdMap[projectSlug],
        supplierId,
        ingredientId,
        unitPrice: price,
        spec,
        unit: normalizeUnit(unit),
        startsOn: new Date("2026-01-01T00:00:00+08:00"),
        endsOn: new Date("2026-12-31T23:59:59+08:00"),
      },
    });
  }

  const now = new Date();
  for (const sample of sampleDocuments) {
    const subtotal = roundMoney(
      sample.items.reduce(
        (sum, item) => sum + roundMoney(item.quantity * item.unitPrice),
        0,
      ),
    );
    const approved = sample.status === "APPROVED";
    const pending = ["PENDING_REVIEW", "APPROVED"].includes(sample.status);
    await db.document.create({
      data: {
        id: sample.id,
        docNo: sample.no,
        docDate: new Date(`${sample.date}T00:00:00+08:00`),
        projectId: projectIdMap[sample.projectId],
        supplierId: sample.supplierId,
        status: sample.status,
        supplierMatchStatus: "MATCHED",
        supplierMatchScore: 1,
        subtotal,
        totalAmount: subtotal,
        notes: sample.notes || "",
        reviewNote: sample.reviewNote || "",
        version: 1,
        createdById: sample.projectId === "prj_hz" ? "usr_site_hz" : "usr_site_sh",
        reviewedById: approved ? "usr_finance" : null,
        submittedAt: pending ? new Date(`${sample.date}T10:00:00+08:00`) : null,
        reviewedAt: approved ? new Date(`${sample.date}T15:00:00+08:00`) : null,
        createdAt: now,
        updatedAt: now,
        pages: {
          create: {
            pageNo: 1,
            objectKey: "demo/sample-delivery.svg",
            mime: "image/svg+xml",
            fileName: "示例手写送货单.svg",
            sha256: crypto
              .createHash("sha256")
              .update(`sample-${sample.id}`)
              .digest("hex"),
            status: "COMPLETED",
          },
        },
        items: {
          create: sample.items.map((item, index) => ({
            lineNo: index + 1,
            rawName: item.name,
            name: item.name,
            spec: item.spec,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: roundMoney(item.quantity * item.unitPrice),
            confidence: item.confidence,
            ingredientId: item.ingredientId,
            matchStatus: item.matchStatus || "MATCHED",
            matchScore: 1,
          })),
        },
      },
    });
    await recomputeDocumentChecks(db, sample.id);
  }
  return true;
}
