import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type SinkOptions = { directory: string; service: string; maxBytes: number; maxFiles: number; retentionDays: number; maxQueue?: number };
export class FileLogSink {
  private queue: string[] = [];
  private draining: Promise<void> | null = null;
  private file = "";
  private day = "";
  private bytes = 0;
  private sequence = 0;
  private lastPrune = 0;
  private instance = randomUUID().slice(0, 8);
  dropped = 0;
  failures = 0;
  lastErrorCode = "";

  constructor(private options: SinkOptions) {
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(options.service)) throw new Error("Invalid log service name");
  }
  write(line: string) {
    if (this.queue.length >= (this.options.maxQueue || 2048)) {
      this.dropped++;
      if (this.dropped === 1 || this.dropped % 1000 === 0) process.stderr.write(JSON.stringify({ event: "logging.dropped", dropped: this.dropped, service: this.options.service }) + "\n");
      return;
    }
    this.queue.push(line);
    if (!this.draining) this.draining = this.drain().finally(() => { this.draining = null; if (this.queue.length) this.writePending(); });
  }
  private writePending() {
    if (!this.draining) this.draining = this.drain().finally(() => { this.draining = null; if (this.queue.length) this.writePending(); });
  }
  async flush() {
    while (this.draining || this.queue.length) {
      if (!this.draining) this.writePending();
      await this.draining;
    }
  }
  private async drain() {
    while (this.queue.length) {
      const lines = this.queue.splice(0, 64);
      try {
        await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
        let batch = "";
        for (const line of lines) {
          const day = new Date().toISOString().slice(0, 10), size = Buffer.byteLength(line);
          if (this.day !== day || this.bytes + size > this.options.maxBytes) {
            if (batch) { await appendFile(this.file, batch, { mode: 0o600 }); batch = ""; }
            this.day = day; this.bytes = 0;
            this.file = path.join(this.options.directory, `${this.options.service}-${day}-${this.instance}-${++this.sequence}.jsonl`);
          }
          batch += line;
          this.bytes += size;
          if (this.bytes === size) {
            await appendFile(this.file, batch, { mode: 0o600 }); batch = "";
            await this.prune(); this.lastPrune = Date.now();
          }
        }
        if (batch) await appendFile(this.file, batch, { mode: 0o600 });
        if (Date.now() - this.lastPrune > 60_000) { await this.prune(); this.lastPrune = Date.now(); }
        this.lastErrorCode = "";
      } catch (error) {
        this.failures++;
        this.lastErrorCode = String((error as NodeJS.ErrnoException).code || "LOG_WRITE_FAILED");
        process.stderr.write(JSON.stringify({ event: "logging.write_failed", service: this.options.service, code: this.lastErrorCode, failures: this.failures }) + "\n");
        // Fall back to the container journal while the durable volume is unavailable.
        for (const line of lines) process.stderr.write(line);
      }
    }
  }
  private async prune() {
    const directory = path.resolve(this.options.directory);
    const pattern = new RegExp(`^${this.options.service}-\\d{4}-\\d{2}-\\d{2}-[a-f0-9]{8}-\\d+\\.jsonl$`);
    const files = [];
    for (const name of await readdir(directory)) {
      if (!pattern.test(name)) continue;
      const file = path.resolve(directory, name);
      if (path.dirname(file) !== directory) continue;
      const info = await stat(file);
      if (info.isFile()) files.push({ file, modified: info.mtimeMs });
    }
    files.sort((a, b) => Number(b.file === path.resolve(this.file)) - Number(a.file === path.resolve(this.file)) || b.modified - a.modified);
    const cutoff = Date.now() - this.options.retentionDays * 86_400_000;
    for (const [index, entry] of files.entries()) {
      if (entry.file !== path.resolve(this.file) && (index >= this.options.maxFiles || entry.modified < cutoff)) await unlink(entry.file);
    }
  }
}
