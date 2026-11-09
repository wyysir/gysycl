// 业务错误类型单独放在无 Next.js 运行时依赖的模块里，
// 以便 OCR Worker（scripts/worker.ts）等非 Next 进程也能安全复用。
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
