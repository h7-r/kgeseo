/**
 * 웹사이트 테스트용 모듈 풀이 — `@/…` 를 website/src 로 잇는다(vite 의 alias 와 같은 규칙).
 * 순수 모듈(services/account/meProfile 처럼 `@/lib/…` 만 쓰는 것)을 node --test 에서 그대로 읽게 한다.
 * import.meta.env 를 읽는 모듈(config/env)은 여기로도 못 읽는다 — 그런 건 Playwright 로 본다.
 *
 *   node --import ./tools/website/alias-hook.mjs --test tools/website/*.test.mjs
 */
import { register } from "node:module";

register("./alias-resolver.mjs", import.meta.url);
