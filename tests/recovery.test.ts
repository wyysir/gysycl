import { describe, expect, it } from "vitest";
import { DRAFT_TTL, draftKey, validDraft, type DraftRecord } from "@/lib/client/draft-store";
import { canRestoreDocument, documentRecovery } from "@/lib/client/document-recovery";
import type { DocumentDto } from "@/lib/client/types";
const document = { id: "document-a", version: 4, status: "DRAFT", notes: "未提交备注", items: [], pages: [{ url: "/private/image" }], checks: [], totalAmount: 0 } as unknown as DocumentDto;
describe("temporary editing recovery boundaries", () => {
  const record: DraftRecord = { key: "key", owner: "alice", tab: "tab-a", scope: "/upload", expiresAt: 1000 + DRAFT_TTL, value: {} };
  it("isolates identities, tabs and document paths without ambiguous keys", () => {
    expect(draftKey("a/b", "c", "d")).not.toBe(draftKey("a", "b/c", "d"));
    expect(draftKey("alice", "tab-a", "/upload")).not.toBe(draftKey("bob", "tab-a", "/upload"));
    expect(validDraft(record, "bob", "tab-a", 1001)).toBe(false);
    expect(validDraft(record, "alice", "tab-b", 1001)).toBe(false);
  });
  it("expires recovery instead of retaining business content indefinitely", () => {
    expect(validDraft(record, "alice", "tab-a", 1001)).toBe(true);
    expect(validDraft(record, "alice", "tab-a", record.expiresAt)).toBe(false);
    expect(validDraft(undefined, "alice", "tab-a")).toBe(false);
  });
  it("recovers zeros and notes while excluding image URLs and audit/check data", () => {
    const saved = documentRecovery(document, true, "审核说明草稿");
    expect(saved.fields.totalAmount).toBe(0); expect(saved.fields.notes).toBe("未提交备注");
    expect(saved.reviewNote).toBe("审核说明草稿");
    expect(saved.fields).not.toHaveProperty("pages"); expect(saved.fields).not.toHaveProperty("checks");
    expect(canRestoreDocument(saved, document, true)).toBe(true);
  });
  it("never rebases an old draft over a newer server version, approval or another document", () => {
    const saved = documentRecovery(document, true, "");
    expect(canRestoreDocument(saved, { ...document, version: 5 }, true)).toBe(false);
    expect(canRestoreDocument(saved, { ...document, status: "APPROVED" }, true)).toBe(false);
    expect(canRestoreDocument(saved, { ...document, id: "document-b" }, true)).toBe(false);
    expect(canRestoreDocument(saved, document, false)).toBe(false);
  });
});
