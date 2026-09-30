import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.resolve(__dirname, "../../../supabase/migrations");
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(dir, f), "utf-8"))
  .join("\n");

describe("마이그레이션 정적 검사 (실제 DB 접근 차단은 검증하지 않음)", () => {
  it("모든 public 테이블에 RLS가 활성화되어 있다", () => {
    const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(sql, t).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
    }
  });

  it("모든 public 테이블에 최소 1개의 정책이 있다", () => {
    const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    for (const t of tables) {
      expect(sql, t).toMatch(new RegExp(`create policy \\w+ on public\\.${t}\\b`));
    }
  });

  it("originals 버킷은 private 이다", () => {
    expect(sql).toMatch(/values \('originals', 'originals', false\)/);
    expect(sql).not.toMatch(/values \('originals', 'originals', true\)/);
  });

  it("스토리지 정책은 경로 첫 세그먼트가 본인 ID 일 때만 허용한다", () => {
    const policies = [...sql.matchAll(/create policy originals_\w+ on storage\.objects[\s\S]*?;/g)];
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) expect(p[0]).toContain("(storage.foldername(name))[1] = auth.uid()::text");
  });

  it("마스킹·원본 삭제 기본값은 true 이다", () => {
    expect(sql).toMatch(/mask_enabled boolean not null default true/);
    expect(sql).toMatch(/delete_original boolean not null default true/);
  });

  it("문서 원문·마스킹 매핑 컬럼이 없다", () => {
    expect(sql).not.toMatch(/\b(raw_text|content|mask_map|masking_map)\b/);
  });

  it("0002: 사용자가 만료·상태·동의·스토리지를 직접 쓰는 정책을 제거한다", () => {
    for (const name of [
      "documents_insert_own",
      "documents_update_own",
      "documents_delete_own",
      "consent_logs_insert_own",
      "originals_insert_own",
    ]) {
      expect(sql, name).toMatch(new RegExp(`drop policy ${name} on`));
    }
  });

  it("0002: 버킷 용량 상한은 20MB 이다", () => {
    expect(sql).toMatch(/file_size_limit = 20971520/);
  });
});
