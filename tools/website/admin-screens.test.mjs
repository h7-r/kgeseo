/**
 * 관리자 화면 설정(screens.ts) 하나에서 메뉴 · 주소 · 화면 찾기가 빠짐없이 나오는지 본다.
 * 화면마다 그릴 코드가 다 붙었는지는 routes.tsx 의 Record<ScreenId, …> 를 타입 검사(web:typecheck)가 본다.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

const { ADMIN_SCREENS, MENU_SCREENS, buildAdminPaths, findScreen, menuScreenOf, screenHref } =
  await import("../../website/src/admin/screens.ts");

const BASE = "/admin";
const paths = buildAdminPaths(BASE);

test("메뉴 — 정한 순서 그대로 열두 칸(구독 관리는 미르 11/13 결정으로 뺌)", () => {
  assert.deepEqual(
    MENU_SCREENS.map((screen) => screen.label),
    [
      "대시보드",
      "베타 기록",
      "접속 통계",
      "회원 관리",
      "회원 통계",
      "게임 데이터",
      "활동 로그",
      "보안",
      "공지사항",
      "콘텐츠",
      "CS 관리",
      "설정",
    ],
  );
});

test("화면 — id · 경로가 겹치지 않고, 이름 · 설명이 비어 있지 않다", () => {
  const ids = ADMIN_SCREENS.map((screen) => screen.id);
  const routePaths = ADMIN_SCREENS.map((screen) => screen.path);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(routePaths).size, routePaths.length);
  for (const screen of ADMIN_SCREENS) {
    assert.ok(screen.label.trim(), `${screen.id} 이름`);
    assert.ok(screen.description.trim(), `${screen.id} 설명`);
  }
});

test("상세 화면 — 메뉴에 안 나오고, 있는 메뉴를 따른다", () => {
  for (const screen of ADMIN_SCREENS.filter((item) => item.parent)) {
    assert.ok(!MENU_SCREENS.includes(screen), `${screen.id} 은 메뉴에 없어야 한다`);
    assert.ok(
      MENU_SCREENS.some((item) => item.id === screen.parent),
      `${screen.id} 의 부모 ${screen.parent}`,
    );
  }
});

test("준비 중 안내 — 막는 화면에만, 비어 있지 않게", () => {
  for (const screen of ADMIN_SCREENS) {
    if (screen.pendingNote !== undefined) {
      assert.equal(screen.status, "pending", `${screen.id} 은 pending 이어야 안내가 쓰인다`);
      assert.ok(screen.pendingNote.trim(), `${screen.id} 안내 문구`);
    }
  }
});

test("주소 — 메뉴 칸마다 링크가 있고, 그 주소로 다시 그 화면을 찾는다", () => {
  for (const screen of MENU_SCREENS) {
    const href = paths[screen.id];
    assert.equal(href, screenHref(BASE, screen));
    assert.ok(href === BASE || href.startsWith(`${BASE}/`), href);
    assert.equal(findScreen(href, BASE)?.id, screen.id);
  }
  assert.equal(paths.dashboard, "/admin");
  assert.equal(paths.login, "/admin/login");
});

test("회원 상세 주소 — 값은 인코딩하고, 메뉴는 「회원 관리」를 따른다", () => {
  assert.equal(paths.userDetail("a b/c"), "/admin/users/a%20b%2Fc");
  const detail = findScreen("/admin/users/abc", BASE);
  assert.equal(detail?.id, "userDetail");
  assert.equal(menuScreenOf(detail).label, "회원 관리");
});

test("모르는 주소 — 화면을 찾지 않는다", () => {
  assert.equal(findScreen("/admin/nope", BASE), undefined);
  assert.equal(findScreen("/administrator", BASE), undefined);
  assert.equal(findScreen("/admin/users/abc/edit", BASE), undefined);
});
