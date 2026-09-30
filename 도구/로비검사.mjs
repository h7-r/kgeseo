// 로비검사.mjs — 로비를 **실제로 띄워 놓고** 조작·상호작용·프레임을 재는 자동 검사
//
// [왜 필요한가]
//   이 씬은 빌드가 되어도, lint 가 깨끗해도 **화면에서 틀릴 수 있다.**
//   걸음 속도, 벽 뚫기, 물건 집기, 시점 전환 때 물건이 튀는 것 — 전부
//   "띄워 보고 숫자를 재야" 알 수 있는 것들이다. 눈으로 확인하는 데 매번
//   몇십 분이 들어서, 손대는 곳마다 다시 재 보지 않게 된다. 그게 사고를 냈다.
//
// [쓰는 법]
//   1) 개발 서버를 띄운다:  cd ~/kgeseo && npx vite --port 5173
//   2) 검사를 돌린다:       node 도구/로비검사.mjs
//      · 브라우저 창이 실제로 뜬다(아래 「왜 headless 가 아닌가」).
//      · 통과하면 종료 코드 0, 하나라도 실패하면 1 이다.
//
// [왜 headless 가 아닌가]
//   headless Chromium 의 WebGL 은 SwiftShader(소프트웨어 렌더러)다. 프레임
//   숫자가 실제 GPU 와 아무 상관이 없다 — 재 봐야 거짓말이다.
//
// [왜 ?조작=항상 인가]
//   조작은 **포인터 잠금**이 걸려야 켜진다. 그런데 자동화에서 잠금은 OS 창
//   포커스에 달려 있어서, 같은 스크립트가 어떤 판엔 잠기고 어떤 판엔
//   "The root document of this element is not valid for pointer lock" 으로
//   죽는다(여러 번 겪었다). 그래서 App.jsx 에 검사 전용 쿼리를 뒀다.
//   시점 회전은 여전히 PointerLockControls 몫이라 안 돌아가지만, 키로 하는
//   것(걷기·E·V)은 전부 된다 — 검사에는 그거면 된다.
//
// [왜 vsync 를 끄는가]
//   안 끄면 프레임 시간이 16.7 / 33.3ms 로 **양자화**된다. 1ms 를 아껴도
//   숫자가 안 움직이고, 반대로 아무 관계 없는 변화가 큰 차이로 보인다.
//
// [숫자를 읽는 법]
//   · 속도는 평균이 아니라 **구간 속도의 상위 25% 중앙값**을 본다.
//     로비는 소품이 많아서 어딘가에 긁히는 구간이 반드시 섞이고, 평균을
//     쓰면 그게 통째로 섞여 들어와 "느려졌다"는 거짓 경보가 난다.
//   · 프레임 시간은 **같은 판 안에서만** 견준다. 맥은 열로 baseline 이
//     18 → 23ms 까지 밀린다(실측).

import { chromium } from "playwright";

// ★ **기본 몸체(meshy)로 돌린다.** `?avatar=chibi` 로 돌리면 안 된다 —
//   chibi-*.glb 에는 **주먹 모프가 0개**다(치비게임아바타 「몸체별 모프」).
//   손가락·손목을 건드린 변경을 그 몸체로 검사하면 **원리적으로 아무것도 안
//   보인다.** 실제로 그렇게 돌리다가 손 모양 회귀를 통째로 놓쳤다.
//   chibi 쪽도 보고 싶으면 주소를 인자로 넘겨라:
//     node 도구/로비검사.mjs "http://localhost:5173/?avatar=chibi&조작=항상"
const 주소 = process.argv[2] ?? "http://localhost:5173/?조작=항상";
const 유닛당미터 = 0.3; // 조작설정.js 의 축척

let 실패 = 0;
const 잰값 = [];
function 확인(이름, 괜찮나, 적을말) {
  const 표 = 괜찮나 ? "✔" : "✖";
  if (!괜찮나) 실패 += 1;
  console.log(`${표} ${이름} — ${적을말}`);
}

const 브라우저 = await chromium.launch({
  headless: false,
  args: ["--use-angle=metal", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const 쪽 = await 브라우저.newPage({ viewport: { width: 1280, height: 720 } });

// 콘솔 오류 모으기 — 포인터 잠금 경고는 위 설명대로 **정상**이라 뺀다.
const 오류 = [];
const 잠금경고 = /pointer lock|Pointer Lock/i;
쪽.on("pageerror", (e) => { if (!잠금경고.test(e.message)) 오류.push(`pageerror: ${e.message}`); });
쪽.on("console", (m) => {
  if (m.type() === "error" && !잠금경고.test(m.text())) 오류.push(`console: ${m.text().slice(0, 200)}`);
});

console.log(`▶ ${주소}`);
// ★ 다시 시도한다 — 누군가 소스를 고치는 중이면 개발 서버가 페이지를
//   통째로 새로 고친다(HMR 무효화). 그 순간에 걸리면 `goto` 가 그냥 죽는다.
//   `load` 대신 `domcontentloaded` 를 기다리고, 콘솔 창구가 실제로 생겼는지
//   확인해서 「정말 다 떴는가」를 판단한다.
let 떴나 = false;
for (let 판 = 1; 판 <= 5 && !떴나; 판 += 1) {
  try {
    await 쪽.goto(주소, { waitUntil: "domcontentloaded", timeout: 60000 });
    await 쪽.waitForSelector("canvas", { state: "attached", timeout: 60000 });
    await 쪽.waitForTimeout(18000); // 에셋·GLB 가 다 붙을 때까지
    떴나 = await 쪽.evaluate(
      () => !!(window.__내자리 && window.__카메라 && window.__로비 && window.__이동진단),
    );
  } catch (e) {
    console.log(`  못 떴다 — 다시 시도 ${판}/5 (${String(e.message).slice(0, 50)})`);
  }
  if (!떴나) await 쪽.waitForTimeout(3000);
}
if (!떴나) {
  console.log("✖ 페이지를 안정적으로 못 띄웠다 — 개발 서버나 소스가 바뀌는 중인지 보라");
  await 브라우저.close();
  process.exit(2);
}
await 쪽.bringToFront();

const 시점 = () => 쪽.evaluate(() => window.__내자리.삼인칭);
const 든것 = () => 쪽.evaluate(() => window.__로비.로비상태.값().든것);
/** 지금 시점이 원하는 쪽이 아니면 V 를 눌러 맞춘다 */
async function 시점맞추기(삼인칭) {
  if ((await 시점()) === 삼인칭) return;
  await 쪽.keyboard.press("KeyV");
  await 쪽.waitForTimeout(1300);
}

/** 키를 누른 채 걸으며 자리를 프레임마다 적는다 */
async function 걷기(키들, 초, 시작 = [0, 0]) {
  await 쪽.evaluate(([x, z]) => window.__순간이동(x, z), 시작);
  await 쪽.waitForTimeout(500);
  for (const k of 키들) await 쪽.keyboard.down(k);
  const 기록 = await 쪽.evaluate(
    (ms) =>
      new Promise((끝) => {
        const 줄 = [];
        const t0 = performance.now();
        (function 한칸(지금) {
          줄.push([지금 - t0, window.__내자리.눈.x, window.__내자리.눈.z]);
          if (지금 - t0 < ms) requestAnimationFrame(한칸);
          else 끝(줄);
        })(performance.now());
      }),
    초 * 1000,
  );
  for (const k of 키들) await 쪽.keyboard.up(k);
  await 쪽.waitForTimeout(300);
  return 기록;
}

/** 게임 **안에서** 잰 걸음 속도 — `__이동진단` 을 읽는다.
 *
 * [왜 바깥에서 자리를 훑으면 안 되나]
 *   `플레이어시점.눈` 을 rAF 로 훑어 거리/시간을 내는 방식은 3인칭에서
 *   **절반 가까이 낮게** 나왔다(내부 4.5 vs 바깥 2.27 유닛/초). 눈 값이 한
 *   프레임 늦게 적히고, 3인칭은 프레임이 길어 그 한 프레임이 크게 먹힌다.
 *   내부 진단은 이동 적분 바로 그 자리에서 **명령 속력과 실제 이동**을 함께
 *   재므로 둘이 어긋날 수가 없다. 막힌 걸음 수까지 같이 나온다.
 */
async function 걸음속도(키들, 초 = 1.5, 시작 = [0, 0]) {
  await 쪽.evaluate(() => { window.__이동진단.켬 = true; });
  await 쪽.evaluate(([x, z]) => window.__순간이동(x, z), 시작);
  await 쪽.waitForTimeout(600);
  for (const k of 키들) await 쪽.keyboard.down(k);
  const 줄 = await 쪽.evaluate(
    (ms) =>
      new Promise((끝) => {
        const 모음 = [];
        const t0 = performance.now();
        (function 한칸(지금) {
          const d = window.__이동진단;
          if (d.명령속력 > 0)
            모음.push([d.명령속력, d.실제속력 ?? 0, d.막힘x ?? 0, d.막힘z ?? 0]);
          if (지금 - t0 < ms) requestAnimationFrame(한칸);
          else 끝(모음);
        })(performance.now());
      }),
    초 * 1000,
  );
  for (const k of 키들) await 쪽.keyboard.up(k);
  await 쪽.evaluate(() => { window.__이동진단.켬 = false; });
  await 쪽.waitForTimeout(300);
  if (!줄.length) return { 명령: 0, 실제: 0, 막힌비율: 1 };
  const 실제 = 줄.map((x) => x[1]).sort((a, b) => a - b);
  return {
    명령: 줄[줄.length >> 1][0],
    실제: 실제[실제.length >> 1],
    막힌비율: 줄.filter((x) => x[2] > 0 || x[3] > 0).length / 줄.length,
  };
}

/** 구간 속도의 상위 25% 중앙값 — 위 「숫자를 읽는 법」 참고 */
function 막히지않은속도(기록) {
  const 구간 = [];
  for (let i = 1; i < 기록.length; i += 1) {
    const dt = (기록[i][0] - 기록[i - 1][0]) / 1000;
    if (dt > 0.004)
      구간.push(Math.hypot(기록[i][1] - 기록[i - 1][1], 기록[i][2] - 기록[i - 1][2]) / dt);
  }
  if (!구간.length) return 0;
  구간.sort((a, b) => a - b);
  const 상위 = 구간.slice(Math.floor(구간.length * 0.75));
  return 상위[Math.floor(상위.length / 2)];
}
const 프레임중앙 = (기록) => {
  const f = [];
  for (let i = 1; i < 기록.length; i += 1) f.push(기록[i][0] - 기록[i - 1][0]);
  f.sort((a, b) => a - b);
  return f[Math.floor(f.length / 2)] ?? 0;
};

// ── ① 1인칭 걸음·달리기 속도 ──────────────────────────────
await 시점맞추기(false);
const 일걷 = await 걸음속도(["KeyW"]);
const 일달 = await 걸음속도(["KeyW", "ShiftLeft"]);
const 걷 = 일걷.명령;
const 달 = 일달.명령;
잰값.push(["1인칭 걷기", `명령 ${걷.toFixed(2)} · 실제 ${일걷.실제.toFixed(2)} 유닛/초 = ${(일걷.실제 * 유닛당미터).toFixed(2)} m/s`]);
잰값.push(["1인칭 달리기", `명령 ${달.toFixed(2)} · 실제 ${일달.실제.toFixed(2)} 유닛/초 = ${(일달.실제 * 유닛당미터).toFixed(2)} m/s`]);
// 사람 보통 걸음 1.4 m/s 언저리를 벗어나면 조작감이 통째로 달라진다.
//   ★ 두 시점을 **같은 값**으로 맞췄다(공용.jsx 「일인칭」 주석). 그래서
//     1인칭·3인칭 문턱도 같다. 한쪽만 고치면 다시 어긋난다.
확인("1인칭 걷기 속도", 걷 > 3.2 && 걷 < 5.5, `${(걷 * 유닛당미터).toFixed(2)} m/s (0.96~1.65 m/s 여야 함)`);
확인("1인칭 달리기 속도", 달 > 걷 * 1.3, `걷기의 ${(달 / 걷).toFixed(2)}배 (1.3배 이상이어야 함)`);
// 명령한 속력이 실제로 나오는가 — 막혀 있으면 이게 벌어진다
확인("1인칭 명령대로 움직인다", 일걷.실제 > 걷 * 0.9,
      `명령 ${걷.toFixed(2)} → 실제 ${일걷.실제.toFixed(2)} 유닛/초 (막힌 프레임 ${(일걷.막힌비율*100).toFixed(0)}%)`);

// ── ①-2 3인칭 걸음 속도 ───────────────────────────────────
// 3인칭은 아바타가 보이므로 걷기 클립 보폭과 맞아야 한다(배속 상한 2.2).
//   그래서 1인칭보다 낮게 잡는다 — 그래도 V 를 눌렀을 때 속도가 확 떨어지면
//   그것만으로 「시점 바꾸면 느려진다」가 된다. 둘의 차이를 같이 본다.
await 시점맞추기(true);
const 삼걷셈 = await 걸음속도(["KeyW"]);
const 삼걷 = 삼걷셈.명령;
잰값.push(["3인칭 걷기", `명령 ${삼걷.toFixed(2)} · 실제 ${삼걷셈.실제.toFixed(2)} 유닛/초 = ${(삼걷셈.실제 * 유닛당미터).toFixed(2)} m/s`]);
확인("3인칭 걷기 속도", 삼걷 > 4 && 삼걷 < 7,
      `${(삼걷 * 유닛당미터).toFixed(2)} m/s (1.2~2.1 m/s 여야 함)`);
확인("3인칭 명령대로 움직인다", 삼걷셈.실제 > 삼걷 * 0.9,
      `명령 ${삼걷.toFixed(2)} → 실제 ${삼걷셈.실제.toFixed(2)} 유닛/초 (막힌 프레임 ${(삼걷셈.막힌비율*100).toFixed(0)}%)`);
// 아바타 클립 배속이 상한(2.2)을 넘으면 발이 미끄러진다
const 배속 = await 쪽.evaluate(() => window.__CHIBI_DEBUG?.timeScale ?? null);
확인("아바타 클립 배속이 상한 안", 배속 === null || 배속 <= 2.2,
      배속 === null ? "이 몸체엔 계기가 없다(건너뜀)" : `${배속.toFixed(2)} (상한 2.2)`);
// 시점을 바꿀 때 속도가 절반 아래로 떨어지지 않아야 한다
// ★ 둘을 **같은 숫자로 두면 안 된다**(공용.jsx 「일인칭」 주석 — 같은 m/s 라도
//   1인칭이 더 빠르게 느껴진다). 대신 **3인칭이 1인칭보다 빨라야** 맞고,
//   그 차이가 지나치면(1.6배 넘게) 시점을 바꿀 때 속도가 튀어 어색하다.
확인("3인칭이 1인칭보다 빠르다", 삼걷 > 걷,
      `1인칭 ${걷.toFixed(2)} · 3인칭 ${삼걷.toFixed(2)} 유닛/초`);
확인("두 시점 차이가 과하지 않다", 삼걷 < 걷 * 1.6,
      `3인칭 / 1인칭 = ${(삼걷 / 걷).toFixed(2)}배 (1.6배 미만이어야 함)`);
await 시점맞추기(false);

// ── ② 벽 뚫기 — 여덟 방향 전력질주 ────────────────────────
const 조합 = [["KeyW"], ["KeyS"], ["KeyA"], ["KeyD"],
               ["KeyW", "KeyA"], ["KeyW", "KeyD"], ["KeyS", "KeyA"], ["KeyS", "KeyD"]];
let 이탈 = [];
for (const c of 조합) {
  const 끝 = (await 걷기([...c, "ShiftLeft"], 3)).at(-1);
  // 역은 x −24~24 · z −18~18, 복도는 −x 쪽으로만 더 뻗는다. 넉넉히 잡는다.
  if (끝[1] > 26 || 끝[1] < -64 || Math.abs(끝[2]) > 26)
    이탈.push(`${c.join("+")} → (${끝[1].toFixed(1)}, ${끝[2].toFixed(1)})`);
}
확인("벽 뚫기(8방향 전력질주 3초)", 이탈.length === 0, 이탈.length ? 이탈.join(" · ") : "전부 방 안");

// ── ③ 물건 집기 · 놓기 ────────────────────────────────────
// ★ **한 손 물건 하나만 보면 안 된다.**
//   머그(두손:false)만 시험했다가, 두 손으로 받치는 물건(노트북·키보드·상자)을
//   3인칭에서 놓을 때마다 예외가 22건씩 나는 것을 통째로 놓쳤다. 두 손 물건은
//   가슴 앵커·양팔 IK 라는 **완전히 다른 경로**를 탄다. 한 개는 꼭 넣어라.
const 볼물건 = ["집기:mug0", "집기:laptop0"];

/** 그 물건 앞에 서서 1인칭으로 겨냥한다 — 3인칭은 카메라가 붐 끝이라 lookAt 이 안 맞는다 */
async function 겨누기(위치) {
  await 쪽.evaluate(([x, y, z]) => {
    window.__순간이동(x + 1.1, z + 1.1);
    const c = window.__카메라;
    c.position.set(x + 1.1, c.position.y, z + 1.1);
    c.lookAt(x, y, z);
    c.updateMatrixWorld(true);
  }, 위치);
  await 쪽.waitForTimeout(700);
}

let 집힘 = null;
let 마지막물건 = null;
for (const id of 볼물건) {
  const 물건 = await 쪽.evaluate((아이디) => window.__대상목록().find((x) => x.id === 아이디), id);
  if (!물건) { 확인(`${id} 등록`, false, "대상 목록에 없다"); continue; }
  await 시점맞추기(false);
  await 겨누기(물건.위치);
  const 겨냥 = await 쪽.evaluate(() => window.__로비.겨냥.값());
  확인(`겨냥(${id})`, 겨냥 === id, `겨냥된 것 = ${겨냥}`);
  if (겨냥 !== id) continue;
  await 쪽.keyboard.press("KeyE");
  await 쪽.waitForTimeout(900);
  const 든 = await 든것();
  확인(`집기(${id})`, 든 !== null, `든것 = ${든}`);
  if (!든) continue;

  // 3인칭으로 옮겨 놓는다 — 양팔 IK·가슴 앵커가 실제로 도는 곳이 여기다.
  await 시점맞추기(true);
  const 예전오류 = 오류.length;
  await 쪽.keyboard.press("KeyE"); // 놓기
  await 쪽.waitForTimeout(1200);
  확인(`3인칭에서 놓기(${id})`, (await 든것()) === null, `든것 = ${await 든것()}`);
  확인(`놓는 동안 예외 없음(${id})`, 오류.length === 예전오류,
        오류.length === 예전오류 ? "0건" : `${오류.length - 예전오류}건`);
  마지막물건 = 물건;
}

// 아래 ④⑤ 에서 쓸 물건을 하나 다시 집어 둔다
if (마지막물건) {
  await 시점맞추기(false);
  await 겨누기(마지막물건.위치);
  await 쪽.keyboard.press("KeyE");
  await 쪽.waitForTimeout(900);
  집힘 = await 든것();
}

// ── ④ 시점 전환 때 든 물건이 튀지 않는가 ──────────────────
if (집힘) {
  const 자리기록 = 쪽.evaluate(
    () =>
      new Promise((끝) => {
        const 줄 = [];
        const t0 = performance.now();
        (function 한칸() {
          const o = window.__씬.getObjectByName("손에든것");
          if (o) 줄.push([o.position.x, o.position.y, o.position.z]);
          if (performance.now() - t0 < 1500) requestAnimationFrame(한칸);
          else 끝(줄);
        })();
      }),
  );
  await 쪽.waitForTimeout(250);
  await 쪽.keyboard.press("KeyV"); // 1인칭 → 3인칭
  const 줄 = await 자리기록;
  let 최대 = 0;
  for (let i = 1; i < 줄.length; i += 1)
    최대 = Math.max(최대, Math.hypot(줄[i][0] - 줄[i - 1][0], 줄[i][1] - 줄[i - 1][1], 줄[i][2] - 줄[i - 1][2]));
  잰값.push(["시점 전환 때 물건 튐", `${최대.toFixed(3)} 유닛/프레임`]);
  // 0.3 유닛 ≈ 9cm. 이보다 크면 '따라온다'가 아니라 순간이동으로 보인다.
  확인("시점 전환 때 물건이 안 튄다", 최대 < 0.3, `한 프레임 최대 ${최대.toFixed(3)} 유닛`);
  await 쪽.waitForTimeout(900);

  // ── ⑤ 3인칭에서 놓을 때 팔 IK 가 서서히 꺼지는가 ─────────
  await 시점맞추기(true);
  const IK기록 = 쪽.evaluate(
    () =>
      new Promise((끝) => {
        const 줄 = [];
        const t0 = performance.now();
        (function 한칸() {
          // ★ 시각도 같이 적는다. 프레임당 변화량만 보면 **프레임이 길어진
          //   판에서 거짓 경보**가 난다. 팔 뻗기(0.16초 램프)는 벽시계 시간
          //   기준이라, 70ms 짜리 프레임 하나면 정상 동작인데도 0.43 이 찍힌다.
          //   우리가 보려는 것은 "한 프레임에 튀었나"가 아니라 **얼마나 빠른가**다.
          줄.push([performance.now() - t0, window.__팔IK?.힘 ?? 0]);
          if (performance.now() - t0 < 1200) requestAnimationFrame(한칸);
          else 끝(줄);
        })();
      }),
  );
  await 쪽.waitForTimeout(150);
  await 쪽.keyboard.press("KeyE"); // 놓기
  const IK = await IK기록;
  let IK속도 = 0; // 초당 변화량
  let IK튐 = 0; // 한 프레임 변화량(참고용)
  for (let i = 1; i < IK.length; i += 1) {
    const dt = (IK[i][0] - IK[i - 1][0]) / 1000;
    const d = Math.abs(IK[i][1] - IK[i - 1][1]);
    IK튐 = Math.max(IK튐, d);
    if (dt > 0.004) IK속도 = Math.max(IK속도, d / dt);
  }
  잰값.push(["팔 IK 세기 변화 속도", `${IK속도.toFixed(1)}/초 (한 프레임 최대 ${IK튐.toFixed(3)})`]);
  // 예전에는 0.85 가 **한 프레임에** 떨어졌다 — 60fps 기준 51/초다.
  //   지금은 뻗기 램프(0.16초에 0→1 = 6.3/초)가 가장 빠른 축이라 그 언저리여야 한다.
  확인("팔 IK 가 서서히 꺼진다", IK속도 < 15, `${IK속도.toFixed(1)}/초 (예전 51/초)`);
  확인("물건 놓기", (await 든것()) === null, `든것 = ${await 든것()}`);
}

// ── ⑥ 의자 끌기 — 손 모양과 「놓은 뒤 빈손 헛자세」 ────────
// [왜 따로 보나]
//   의자는 `든id` 가 null 인데 `듦` 은 true 인 **유일한 경우**다. 그래서
//   「손에 든 것」 기준으로 짠 조건에 걸려 조용히 어긋나기 쉽다. 실제로
//   두 번 어긋났다: ① 끄는 내내 손이 안 감겼고 ② 놓은 뒤 0.37초 동안
//   빈손인데 뭘 든 자세가 나왔다. 둘 다 눈으로는 잘 안 보인다 — 그래서 잰다.
const 주먹모프 = () =>
  쪽.evaluate(() => {
    let v = null;
    window.__씬.traverse((o) => {
      const i = o.morphTargetDictionary?.fistHands;
      if (i != null && o.morphTargetInfluences) v = o.morphTargetInfluences[i];
    });
    return v;
  });

const 의자 = await 쪽.evaluate(() => window.__대상목록().find((x) => x.id === "chair0"));
if (의자) {
  await 시점맞추기(false);
  await 겨누기(의자.위치);
  const 겨냥 = await 쪽.evaluate(() => window.__로비.겨냥.값());
  if (겨냥 !== "chair0") 확인("의자 겨냥", false, `겨냥된 것 = ${겨냥}`);
  else {
    await 쪽.keyboard.press("KeyE"); // 잡기
    await 쪽.waitForTimeout(900);
    await 시점맞추기(true); // 아바타가 실제로 도는 곳
    await 쪽.waitForTimeout(600);
    const 감김 = await 주먹모프();
    // 평소 손 0.6 · 무언가 쥔 손 0.7(기본쥠). meshy 몸체에만 모프가 있다.
    확인(
      "의자 끄는 동안 손이 쥐어져 있다",
      감김 === null || 감김 > 0.65,
      감김 === null ? "이 몸체엔 주먹 모프가 없다(건너뜀)" : `모프 ${감김.toFixed(3)} (평소 0.6 · 쥔 손 0.7)`,
    );

    // 아무것도 안 겨냥한 채 놓는다 → 팔이 클립 자세로 돌아가야 한다
    await 쪽.evaluate(() => {
      const c = window.__카메라;
      c.lookAt(c.position.x, c.position.y + 20, c.position.z);
      c.updateMatrixWorld(true);
    });
    await 쪽.waitForTimeout(300);
    await 쪽.keyboard.press("KeyE"); // 놓기
    await 쪽.waitForTimeout(700); // 뻗기(0.6초)가 끝난 뒤
    const 뒤 = await 쪽.evaluate(() => ({
      목표: window.__팔IK?.목표있나 ?? null,
      힘: window.__팔IK?.힘 ?? null,
    }));
    확인(
      "의자 놓은 뒤 빈손 헛자세가 없다",
      뒤.목표 === false || (뒤.힘 ?? 1) < 0.02,
      `팔IK 목표있나=${뒤.목표} 힘=${(뒤.힘 ?? 0).toFixed(3)}`,
    );
  }
}

// ── ⑦ 두 시점 프레임 시간 ─────────────────────────────────
for (const 삼 of [false, true]) {
  await 시점맞추기(삼);
  const ms = 프레임중앙(await 걷기(["KeyW"], 2));
  잰값.push([`${삼 ? "3인칭" : "1인칭"} 걷는 중 프레임`, `${ms.toFixed(2)} ms (${(1000 / ms).toFixed(0)} fps)`]);
}

// ── ⑧ 콘솔 오류 ───────────────────────────────────────────
확인("콘솔 오류", 오류.length === 0, 오류.length ? `${오류.length}건\n    ${오류.slice(0, 6).join("\n    ")}` : "없음");

console.log("\n── 잰 값 ──");
for (const [이름, 값] of 잰값) console.log(`   ${이름}: ${값}`);
console.log(실패 ? `\n✖ ${실패}건 실패` : "\n✔ 전부 통과");

await 브라우저.close();
process.exit(실패 ? 1 : 0);
