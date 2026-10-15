export async function api(path, options = {}) {
  const response = await fetch(`/__review${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error?.message || (typeof data.error === 'string' ? data.error : '') || `요청 실패 (${response.status})`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

export const gates = [
  { id: 'source', label: '설화와 기획', short: '설화', checks: [['fidelity', '입력 자료의 사실·미확인 사항을 대조했습니다.'], ['adaptation', '설화 내용과 게임의 창작·각색을 구분했습니다.']] },
  { id: 'assets', label: '에셋 선택·검수', short: '에셋', checks: [['shape', '선택한 에셋의 실제 형태를 모두 확인했습니다.'], ['fit', '시대·화풍·용도와 씬의 적합성을 확인했습니다.']] },
  { id: 'space', label: '공간 검수', short: '공간', checks: [['movement', '게임에서 직접 이동하며 동선과 충돌을 확인했습니다.'], ['placement', '실제 배치와 설화·씬 기획의 대응을 확인했습니다.']] },
  { id: 'play', label: '퍼즐 연결 현황', short: '퍼즐', checks: [['logic', '실제 연결된 퍼즐의 풀이·연결·완주를 확인했습니다.'], ['story', '퍼즐과 스토리의 개연성을 확인했습니다.'], ['fun', '재미와 난이도를 직접 검토했습니다.']] },
];
export const statusText = { approved: '승인', rejected: '반려', held: '보류', pending: '검수 전', invalidated: '재검수 필요', stale: '버전 변경', blocked: '연결 대기', unreviewed: '검수 전' };
export const date = value => value ? new Date(value).toLocaleString('ko-KR') : '—';
export const shortHash = value => value ? value.slice(0, 10) : '—';
export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
