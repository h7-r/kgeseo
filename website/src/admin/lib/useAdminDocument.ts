import { useLayoutEffect } from "react";

/**
 * 관리자 화면에 있는 동안만 문서를 바꾼다. 떠나면 되돌린다.
 * - html[data-admin]: 사이트의 어두운 바탕 대신 관리자 밝은 바탕을 쓴다(admin.css).
 * - robots meta: 검색에 싣지 않는다. 응답 머리 X-Robots-Tag 는 vercel.json 이 따로 붙인다.
 */
export function useAdminDocument(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.admin = "";
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex,nofollow";
    document.head.appendChild(robots);
    return () => {
      delete root.dataset.admin;
      robots.remove();
    };
  }, []);
}
