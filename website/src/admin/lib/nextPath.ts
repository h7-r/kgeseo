/**
 * 로그인 뒤 돌아갈 주소. 관리자 안의 같은 사이트 주소만 받는다.
 * 웹 사이트의 safeNextPath 와 같은 규칙에 두 가지를 더 막는다 — 관리자 밖 주소, 로그인 화면으로 되도는 고리.
 * "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 */
export function safeAdminNext(value: string | null, base: string, loginPath: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return base;
  // 역슬래시 · 공백 · 제어 문자는 브라우저가 다르게 읽어 밖으로 새는 길이 된다.
  const hasControl = [...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);
  const pathname = value.split(/[?#]/)[0];
  if (hasControl || value.includes("\\") || /\s/.test(pathname) || pathname.includes("/..")) return base;
  const isInside = pathname === base || pathname.startsWith(`${base}/`);
  const isLogin = pathname === loginPath || pathname.startsWith(`${loginPath}/`);
  return isInside && !isLogin ? value : base;
}
