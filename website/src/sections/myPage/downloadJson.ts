/** 비밀번호 해시를 뺀 내 데이터를 JSON 파일로 내려받는다. */
export function downloadJson(data: unknown, fileName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  // 문서에 붙였다 떼야 download 파일 이름이 먹는 브라우저가 있다.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
