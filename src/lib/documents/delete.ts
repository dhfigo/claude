export interface DeletionPorts {
  /** 스토리지 객체 삭제. 객체가 이미 없어도 성공으로 본다. */
  removeObject: (path: string) => Promise<boolean>;
  /** 행을 deleted 로 표시. */
  markDeleted: (id: string) => Promise<boolean>;
  /** expires_at 을 지금으로 당겨 크론 재시도 대상에 올린다. */
  scheduleNow: (id: string) => Promise<boolean>;
}

export interface DocumentRef {
  id: string;
  storage_path: string;
}

/**
 * 순서: 재시도 예약 → 객체 삭제 → 행 표시.
 * 중간에 실패해도 expires_at 이 지난 미삭제 행으로 남아 크론이 다시 시도하고, 각 단계는 멱등이다.
 */
export async function deleteOriginal(
  ports: DeletionPorts,
  doc: DocumentRef,
): Promise<{ deleted: boolean }> {
  if (!(await ports.scheduleNow(doc.id))) return { deleted: false };
  if (!(await ports.removeObject(doc.storage_path))) return { deleted: false };
  return { deleted: await ports.markDeleted(doc.id) };
}
