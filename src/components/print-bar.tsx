"use client";

export function PrintBar() {
  return (
    <div className="no-print pf-notice">
      <p style={{ margin: "0 0 8px" }}>
        아래 [인쇄 / PDF로 저장] 버튼을 누르고, 인쇄 창에서 프린터를 <strong>PDF로 저장</strong>으로 선택하면 PDF 파일이 만들어집니다.
        머리글·바닥글 표시는 끄시는 것을 권장합니다.
      </p>
      <button type="button" className="pf-primary" onClick={() => window.print()}>
        인쇄 / PDF로 저장
      </button>
    </div>
  );
}
