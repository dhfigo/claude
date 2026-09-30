"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { RemoveResult, SaveResult } from "@/lib/portfolio/action-types";
import {
  addItem, addProject, confirmItem, moveItem, moveProject, parseSkills, removeItem, removeProject,
  setItemText, setProfile, setProjectField, setSkills, setSummary,
} from "@/lib/portfolio/edit";
import { countNeedsCheck, LIMITS, needsCheck, type ItemList, type Portfolio } from "@/lib/portfolio/schema";
import { countTokens, findTokens, replaceToken } from "@/lib/portfolio/tokens";
import "./portfolio.css";

export interface EditorProps {
  jobId: string;
  initial: Portfolio;
  initialVersion: number;
  onSave: (input: { jobId: string; expectedVersion: number; portfolio: Portfolio }) => Promise<SaveResult>;
  onReset: (jobId: string) => Promise<SaveResult>;
  onRemove: (jobId: string) => Promise<RemoveResult>;
  docxHref: string;
  printHref: string;
  /** 삭제 후 이동. 기본은 목록 화면 */
  afterRemoveHref?: string;
}

type Message = { tone: "ok" | "error"; text: string; conflict?: boolean };
const LIST_LABEL: Record<ItemList, string> = { actions: "수행 내용", results: "성과" };

export function PortfolioEditor({ jobId, initial, initialVersion, onSave, onReset, onRemove, docxHref, printHref, afterRemoveHref = "/portfolios" }: EditorProps) {
  const [p, setP] = useState<Portfolio>(initial);
  const [version, setVersion] = useState(initialVersion);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [message, setMessage] = useState<Message | null>(null);
  const [skillsText, setSkillsText] = useState(initial.skills.join(", "));
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const dirty = useMemo(() => JSON.stringify(p) !== saved, [p, saved]);
  const tokens = useMemo(() => findTokens(p), [p]);
  const tokenTotal = useMemo(() => countTokens(p), [p]);
  const checkTotal = useMemo(() => countNeedsCheck(p), [p]);

  // 저장하지 않은 변경이 있는 채로 창을 닫거나 이동하면 경고한다.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function save() {
    start(async () => {
      const res = await onSave({ jobId, expectedVersion: version, portfolio: p });
      if (res.ok) {
        setVersion(res.version);
        setSaved(JSON.stringify(p));
        setMessage({ tone: "ok", text: "저장했습니다." });
      } else {
        setMessage({ tone: "error", text: res.message, conflict: res.reason === "conflict" });
      }
    });
  }

  function reset() {
    if (!window.confirm("수정한 내용이 모두 사라지고 AI가 처음 작성한 초안으로 돌아갑니다. 계속하시겠습니까?")) return;
    start(async () => {
      const res = await onReset(jobId);
      if (res.ok) window.location.reload();
      else setMessage({ tone: "error", text: res.message });
    });
  }

  function remove() {
    if (!window.confirm("이 포트폴리오와 AI 분석 결과를 모두 삭제합니다. 삭제하면 되돌릴 수 없습니다. 계속하시겠습니까?")) return;
    start(async () => {
      const res = await onRemove(jobId);
      if (res.ok) window.location.assign(afterRemoveHref);
      else setMessage({ tone: "error", text: res.message });
    });
  }

  const linkProps = (href: string) => ({ href, "aria-disabled": dirty, onClick: (e: React.MouseEvent) => dirty && e.preventDefault() });

  return (
    <div className="pf">
      <div className="pf-bar">
        <button type="button" className="pf-primary" onClick={save} disabled={pending || !dirty}>저장</button>
        <a className="pf-link" {...linkProps(docxHref)} download>Word(DOCX) 내려받기</a>
        <a className="pf-link" {...linkProps(printHref)} target="_blank" rel="noreferrer">인쇄 / PDF</a>
        <span className="pf-status" role="status">{dirty ? "저장하지 않은 변경이 있습니다" : "저장됨"}</span>
      </div>
      {dirty && <p className="pf-notice">내려받기와 인쇄는 <strong>저장된 내용</strong>을 기준으로 합니다. 먼저 저장해 주십시오.</p>}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "ok" ? "pf-msg-ok" : "pf-msg-error"}>
          {message.text} {message.conflict && <button type="button" onClick={() => window.location.reload()}>새로 불러오기</button>}
        </p>
      )}

      <div className="pf-notice">
        AI가 작성한 <strong>초안</strong>입니다. 내용을 확인하고 자유롭게 고쳐 주십시오.
        {checkTotal > 0 && <> 문서에서 근거를 찾지 못한 항목이 <strong>{checkTotal}개</strong> 있습니다. 사실과 맞는지 확인하신 뒤 [확인함]을 눌러 주십시오.</>}
        {tokenTotal > 0 && <> 기밀 보호로 가려진 값이 <strong>{tokenTotal}곳</strong> 남아 있습니다. 아래에서 바꿔 써 주십시오.</>}
      </div>

      <h2>기본 정보</h2>
      <p className="pf-meta">이름·연락처는 문서에서 가져오지 않습니다. 넣고 싶으시면 직접 입력해 주십시오. 입력한 내용은 이 포트폴리오에 저장됩니다.</p>
      <label htmlFor="pf-title">제목</label>
      <input id="pf-title" type="text" maxLength={LIMITS.title} value={p.profile.title} onChange={(e) => setP(setProfile(p, "title", e.target.value))} />
      <label htmlFor="pf-name">이름</label>
      <input id="pf-name" type="text" maxLength={LIMITS.profileName} value={p.profile.name} onChange={(e) => setP(setProfile(p, "name", e.target.value))} />
      <label htmlFor="pf-contact">연락처</label>
      <input id="pf-contact" type="text" maxLength={LIMITS.profileContact} value={p.profile.contact} onChange={(e) => setP(setProfile(p, "contact", e.target.value))} />

      <h2>요약</h2>
      <label htmlFor="pf-summary">한눈에 보는 요약 ({p.summary.length}/{LIMITS.summary}자)</label>
      <textarea id="pf-summary" rows={4} maxLength={LIMITS.summary} value={p.summary} onChange={(e) => setP(setSummary(p, e.target.value))} />

      {tokens.length > 0 && (
        <>
          <h2>가려진 값 바꾸기</h2>
          <p className="pf-meta">[이름_1]처럼 표시된 곳은 기밀 보호를 위해 가려진 값입니다. 바꿀 문구를 입력하면 포트폴리오 전체에 한 번에 적용됩니다. 예: A사, 담당 과장</p>
          {tokens.map(({ token, count }) => (
            <div className="pf-token" key={token}>
              <code>{token}</code>
              <span>{count}곳</span>
              <input
                type="text"
                aria-label={`${token}을(를) 바꿀 문구`}
                maxLength={100}
                value={replacements[token] ?? ""}
                onChange={(e) => setReplacements({ ...replacements, [token]: e.target.value })}
              />
              <button
                type="button"
                disabled={!(replacements[token] ?? "").trim()}
                onClick={() => {
                  setP(replaceToken(p, token, replacements[token] ?? ""));
                  setReplacements({ ...replacements, [token]: "" });
                }}
              >
                바꾸기
              </button>
            </div>
          ))}
        </>
      )}

      <h2>주요 프로젝트</h2>
      {p.projects.length === 0 && <p>프로젝트가 없습니다. 아래 버튼으로 추가해 주십시오.</p>}
      {p.projects.map((pr, i) => (
        <section className="pf-card" key={i} aria-label={`프로젝트 ${i + 1}`}>
          <div className="pf-actions">
            <strong>프로젝트 {i + 1}</strong>
            <button type="button" onClick={() => setP(moveProject(p, i, -1))} disabled={i === 0} aria-label="위로">↑</button>
            <button type="button" onClick={() => setP(moveProject(p, i, 1))} disabled={i === p.projects.length - 1} aria-label="아래로">↓</button>
            <button type="button" className="pf-danger" onClick={() => window.confirm("이 프로젝트를 삭제하시겠습니까?") && setP(removeProject(p, i))}>프로젝트 삭제</button>
          </div>
          <label htmlFor={`t${i}`}>프로젝트명</label>
          <input id={`t${i}`} type="text" maxLength={LIMITS.projectTitle} value={pr.title} onChange={(e) => setP(setProjectField(p, i, "title", e.target.value))} />
          <label htmlFor={`pe${i}`}>기간</label>
          <input id={`pe${i}`} type="text" maxLength={LIMITS.projectMeta} value={pr.period ?? ""} onChange={(e) => setP(setProjectField(p, i, "period", e.target.value))} />
          <label htmlFor={`ro${i}`}>역할</label>
          <input id={`ro${i}`} type="text" maxLength={LIMITS.projectMeta} value={pr.role ?? ""} onChange={(e) => setP(setProjectField(p, i, "role", e.target.value))} />
          <label htmlFor={`bg${i}`}>배경</label>
          <textarea id={`bg${i}`} rows={2} maxLength={LIMITS.background} value={pr.background ?? ""} onChange={(e) => setP(setProjectField(p, i, "background", e.target.value))} />

          {(["actions", "results"] as const).map((list) => (
            <div key={list}>
              <h3 style={{ marginTop: 14 }}>{LIST_LABEL[list]}</h3>
              {pr[list].map((it, j) => (
                <div key={j}>
                  <div className="pf-row">
                    <textarea
                      rows={2}
                      maxLength={LIMITS.item}
                      aria-label={`${LIST_LABEL[list]} ${j + 1}`}
                      value={it.text}
                      onChange={(e) => setP(setItemText(p, i, list, j, e.target.value))}
                    />
                    <div className="pf-actions" style={{ marginTop: 0 }}>
                      <button type="button" onClick={() => setP(moveItem(p, i, list, j, -1))} disabled={j === 0} aria-label="위로">↑</button>
                      <button type="button" onClick={() => setP(moveItem(p, i, list, j, 1))} disabled={j === pr[list].length - 1} aria-label="아래로">↓</button>
                      <button type="button" className="pf-danger" onClick={() => setP(removeItem(p, i, list, j))} aria-label="항목 삭제">삭제</button>
                    </div>
                  </div>
                  {needsCheck(it) && (
                    <p style={{ margin: "0 0 6px" }}>
                      <span className="pf-badge">근거 확인 필요</span>{" "}
                      <button type="button" onClick={() => setP(confirmItem(p, i, list, j))}>확인함</button>
                    </p>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setP(addItem(p, i, list))} disabled={pr[list].length >= LIMITS.items}>
                {LIST_LABEL[list]} 추가
              </button>
            </div>
          ))}
        </section>
      ))}
      <button type="button" onClick={() => setP(addProject(p))} disabled={p.projects.length >= LIMITS.projects}>프로젝트 추가</button>

      <h2>역량</h2>
      <label htmlFor="pf-skills">쉼표로 구분해 입력해 주십시오</label>
      <input
        id="pf-skills"
        type="text"
        value={skillsText}
        onChange={(e) => {
          setSkillsText(e.target.value);
          setP(setSkills(p, parseSkills(e.target.value)));
        }}
      />

      <h2>기타</h2>
      <div className="pf-actions">
        <button type="button" onClick={reset} disabled={pending}>AI 초안으로 되돌리기</button>
        <button type="button" className="pf-danger" onClick={remove} disabled={pending}>포트폴리오 삭제</button>
      </div>
      <p className="pf-meta">삭제하면 이 포트폴리오와 AI 분석 결과가 함께 지워지며 되돌릴 수 없습니다.</p>
    </div>
  );
}
