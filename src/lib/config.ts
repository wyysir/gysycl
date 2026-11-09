import { z } from "zod";

const envSchema = z.object({
  APP_URL: z.string().default("http://localhost:3000"),
  SESSION_SECRET: z
    .string()
    .min(16)
    .default("local-development-secret-change-me"),
  DATABASE_URL: z.string().optional().default(""),
  REDIS_URL: z.string().optional().default(""),
  OCR_MODE: z.enum(["mock", "aliyun"]).default("mock"),
  OCR_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
  DASHSCOPE_API_KEY: z.string().optional().default(""),
  DASHSCOPE_BASE_URL: z
    .string()
    .default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  QWEN_VL_MODEL: z.string().default("qwen3.6-flash"),
  STORAGE_DRIVER: z.enum(["local", "oss"]).default("local"),
  OSS_REGION: z.string().optional().default(""),
  OSS_BUCKET: z.string().optional().default(""),
  OSS_ENDPOINT: z.string().optional().default(""),
  OSS_ACCESS_KEY_ID: z.string().optional().default(""),
  OSS_ACCESS_KEY_SECRET: z.string().optional().default(""),
  WECHAT_APP_ID: z.string().optional().default(""),
  WECHAT_APP_SECRET: z.string().optional().default(""),
  CROSS_PRICE_TOLERANCE: z.coerce.number().min(0).default(0.1),
  HISTORY_PRICE_TOLERANCE: z.coerce.number().min(0).default(0.1),
  QUANTITY_OUTLIER_MULTIPLIER: z.coerce.number().min(1).default(2),
  MIN_BENCHMARK_SAMPLES: z.coerce.number().int().min(1).default(3),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DEMO_MODE: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined ? process.env.NODE_ENV !== "production" : value === "true",
    ),
});

export const env = envSchema.parse(process.env);

export const thresholds = {
  crossPriceTolerance: env.CROSS_PRICE_TOLERANCE,
  historyPriceTolerance: env.HISTORY_PRICE_TOLERANCE,
  quantityOutlierMultiplier: env.QUANTITY_OUTLIER_MULTIPLIER,
  minBenchmarkSamples: env.MIN_BENCHMARK_SAMPLES,
  ocrConfidence: env.OCR_CONFIDENCE_THRESHOLD,
};

export const isLocalDatabase = !env.DATABASE_URL;
export const isLocalStorage = env.STORAGE_DRIVER === "local";
export const isWechatConfigured = Boolean(
  env.WECHAT_APP_ID && env.WECHAT_APP_SECRET,
);

/**
 * 生产环境（NODE_ENV=production 且 DEMO_MODE=false）启动前的配置防误配检查。
 * 演示/试用部署（DEMO_MODE=true）与开发、测试环境直接跳过，不做强校验。
 * 必须在进程内首次初始化数据库（getDb/seedDatabase）之前调用一次。
 */
export function assertProductionConfig(): void {
  if (env.NODE_ENV !== "production" || env.DEMO_MODE) {
    return;
  }

  const placeholderSecrets = new Set([
    "local-development-secret-change-me",
    "local-docker-secret-change-before-production",
  ]);

  if (env.SESSION_SECRET.length < 32 || placeholderSecrets.has(env.SESSION_SECRET)) {
    throw new Error(
      "生产环境配置错误：DEMO_MODE=false 时必须设置至少 32 位的随机 SESSION_SECRET，" +
        "且不能使用开发/部署模板中的占位密钥；请检查环境变量后重新启动。",
    );
  }

  if (env.OCR_MODE !== "aliyun") {
    console.warn(
      `生产环境配置提醒：当前 OCR_MODE=${env.OCR_MODE}，正式识别需要 OCR_MODE=aliyun 并配置百炼 DASHSCOPE_API_KEY（仅视觉模型识别），否则将使用 Mock 演示识别。`,
    );
  }

  if (env.STORAGE_DRIVER !== "oss") {
    console.warn(
      `生产环境配置提醒：当前 STORAGE_DRIVER=${env.STORAGE_DRIVER}，正式部署需要 STORAGE_DRIVER=oss 并配置 OSS_* 参数，否则文件保存在本地存储。`,
    );
  }
}
