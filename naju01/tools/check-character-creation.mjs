// 캐릭터 생성 화면 자동 검사 (개발 서버가 떠 있어야 한다: npx vite naju01 → 5174)
//
//   실행:  node naju01/tools/check-character-creation.mjs     (주소를 바꾸려면 NAJU_URL)
//
// 눈으로 보기 어려운 것들만 기계로 확인한다 — 기본 착장, 성별별 초안 보존, 슬라이더가
// 실제 3D 를 바꾸는지, 늦게 온 이름 확인 답이 새 이름을 덮지 않는지, 완료 데이터의 내용,
// 초안을 initialValue 로 되돌렸을 때 복원되는지.
import { chromium } from "playwright";

const url = process.env.NAJU_URL ?? "http://localhost:5174/character-creation.html";
const results = [];
const recordCheck = (name, condition, note = "") => {
  results.push({ name, passed: Boolean(condition), note });
  console.log(`${condition ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`);
};

const browser = await chromium.launch({ channel: "chrome", headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(9000);
// 개발 도구(가짜 서버 조종판)는 기본으로 접혀 있다 — 검사에 필요하니 편다
await page.getByRole("button", { name: "개발 도구 열기" }).click();
await page.waitForTimeout(500);

// 개발 도구의 첫 <pre> 는 완료 데이터, 둘째는 지금 초안이다
const readPreJson = async (index) => {
  const text = await page.locator("pre").nth(index).innerText();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const readDraft = () => readPreJson(1);
const readCompleted = () => readPreJson(0);
// 캐릭터의 실제 높이(m) — 슬라이더가 3D 를 바꾸는지 보는 잣대
const measureHeight = () =>
  page.evaluate(() => {
    const hook = window.__game?.characterCreation;
    if (!hook) return null;
    const { scene } = hook.get();
    let avatar = null;
    scene.traverse((o) => {
      if (!avatar && o.name === "NAJU-chibi-avatar") avatar = o;
    });
    if (!avatar) return null;
    const box = new hook.THREE.Box3().setFromObject(avatar);
    return box.max.y - box.min.y;
  });
// 체형 슬라이더 값은 눈금 칸 번호(0~4)이고 가운데(2)가 기본값이다. 칸이 가리키는 실수는 항목마다 다르다
const setSlider = async (label, step) => {
  await page.getByLabel(label, { exact: true }).fill(String(step));
  await page.waitForTimeout(600);
};
const getButton = (name, exact = true) => page.getByRole("button", { name, exact }).first();

// 1. 신규 기본값
const initial = await readDraft();
recordCheck(
  "신규 기본은 티셔츠·반바지·운동화 차림",
  initial?.appearance.equipmentIds.top === "top.tee.white" &&
    initial?.appearance.equipmentIds.bottom === "bottom.shorts.black" &&
    initial?.appearance.equipmentIds.shoes === "shoes.sneaker.white",
  JSON.stringify(initial?.appearance.equipmentIds),
);
recordCheck(
  "신규 기본 체형은 머리 최소·팔 85%·마름 20%(남성 다리는 100%)",
  initial?.appearance.bodyParameters.headScale === 0.8 &&
    initial?.appearance.bodyParameters.armThickness === 0.85 &&
    initial?.appearance.bodyParameters.legThickness === 1 &&
    initial?.appearance.bodyParameters.build === -0.2,
  `다리 두께 ${initial?.appearance.bodyParameters.legThickness}`,
);
recordCheck("신규 기본 헤어는 그 성별의 실제 헤어", initial?.appearance.hairId === "hair.m.crop", initial?.appearance.hairId);
recordCheck(
  "어깨·팔 길이 기본값은 보정된 값",
  initial?.appearance.bodyParameters.shoulderWidth === 1.2 && initial?.appearance.bodyParameters.armLength === 0.88,
);

// 2. 슬라이더가 실제 3D 를 바꾼다
await getButton("체형").click();
const baseHeight = await measureHeight();
await setSlider("키", 4); // 가장 큰 칸
const tallHeight = await measureHeight();
await setSlider("키", 0); // 가장 작은 칸
const shortHeight = await measureHeight();
recordCheck(
  "키 슬라이더가 실제 모델 높이를 바꾼다",
  tallHeight > baseHeight * 1.2 && shortHeight < baseHeight * 0.8,
  `${baseHeight?.toFixed(3)} → ${tallHeight?.toFixed(3)} / ${shortHeight?.toFixed(3)}`,
);
await getButton("키 초기화", false).first().click();
await page.waitForTimeout(600);
const resetHeight = await measureHeight();
recordCheck("항목 초기화가 기본값으로 되돌린다", Math.abs(resetHeight - baseHeight) < 0.005, `${resetHeight?.toFixed(3)}`);

// 2-2. 다리 길이도 실제 모델을 바꾼다(뼈 배율).
// 스킨드 메시는 뼈 배율이 경계 상자에 안 잡혀서, 다리가 길어지면 올라가는 골반 높이로 잰다
const pelvisHeight = () =>
  page.evaluate(() => {
    const hook = window.__game.characterCreation;
    const { scene } = hook.get();
    let skeleton = null;
    scene.traverse((o) => {
      if (!skeleton && o.isSkinnedMesh && o.skeleton?.getBoneByName("pelvis")) skeleton = o.skeleton;
    });
    if (!skeleton) return null;
    return new hook.THREE.Vector3().setFromMatrixPosition(skeleton.getBoneByName("pelvis").matrixWorld).y;
  });
// 다리 길이는 '몸 비율' 묶음 안에 있다 — 접혀 있으면 먼저 편다
await page.getByRole("button", { name: "몸 비율" }).click();
await page.waitForTimeout(400);
await setSlider("다리 길이", 4);
const longLegs = await pelvisHeight();
await setSlider("다리 길이", 0);
const shortLegs = await pelvisHeight();
recordCheck(
  "다리 길이 슬라이더가 실제 모델을 바꾼다",
  longLegs > shortLegs * 1.1,
  `골반 높이 ${longLegs?.toFixed(3)} / ${shortLegs?.toFixed(3)}`,
);
await getButton("다리 길이 초기화", false).first().click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: "기본 크기" }).click();
await page.waitForTimeout(400);

// 3. 성별을 오가도 각자 초안이 남는다
await getButton("체형").click();
await setSlider("머리 크기", 3); // 머리 눈금 3칸 = 1.18
await getButton("기본").click();
await getButton("여성").click();
await page.waitForTimeout(5000);
await getButton("체형").click();
await setSlider("머리 크기", 1); // 머리 눈금 1칸 = 0.93
await getButton("기본").click();
await getButton("남성").click();
await page.waitForTimeout(5000);
const maleDraft = await readDraft();
recordCheck(
  "남→여→남 에서 남성 초안이 복원된다",
  Math.abs((maleDraft?.appearance.bodyParameters.headScale ?? 0) - 1.18) < 0.001,
  String(maleDraft?.appearance.bodyParameters.headScale),
);
await getButton("기본").click();
await getButton("여성").click();
await page.waitForTimeout(5000);
const femaleDraft = await readDraft();
recordCheck(
  "여성 초안도 그대로 남는다",
  Math.abs((femaleDraft?.appearance.bodyParameters.headScale ?? 0) - 0.93) < 0.001,
  String(femaleDraft?.appearance.bodyParameters.headScale),
);
await getButton("기본").click();
await getButton("남성").click();
await page.waitForTimeout(5000);

// 4. 옷을 갈아입어도 체형값은 그대로
await getButton("의상").click();
await getButton("흰 티셔츠", false).click();
await page.waitForTimeout(3500);
await getButton("흰 운동화", false).click();
await page.waitForTimeout(3500);
const afterOutfit = await readDraft();
recordCheck(
  "옷을 갈아입어도 체형값이 유지된다",
  Math.abs((afterOutfit?.appearance.bodyParameters.headScale ?? 0) - 1.18) < 0.001,
);
recordCheck(
  "의상 선택이 초안에 들어간다",
  afterOutfit?.appearance.equipmentIds.top === "top.tee.white" &&
    afterOutfit?.appearance.equipmentIds.shoes === "shoes.sneaker.white",
);

// 5. 신발을 신어도 발 크기가 실제로 바뀐다(신발 GLB 에는 모프가 없어 따로 처리한다)
await getButton("체형").click();
await setSlider("발 크기", 0);
await page.waitForTimeout(600);
// 스킨드 메시는 뼈가 움직여도 제 행렬이 안 바뀐다 — 스키닝된 정점을 직접 읽어 잰다
const measureShoe = () =>
  page.evaluate(() => {
    const hook = window.__game.characterCreation;
    const { scene } = hook.get();
    let shoe = null;
    scene.traverse((o) => {
      if (!shoe && o.isSkinnedMesh && o.userData.slot === "shoes" && o.visible) shoe = o;
    });
    if (!shoe) return null;
    const box = new hook.THREE.Box3();
    const point = new hook.THREE.Vector3();
    const count = shoe.geometry.getAttribute("position").count;
    for (let i = 0; i < count; i += 7) {
      shoe.getVertexPosition(i, point);
      box.expandByPoint(shoe.localToWorld(point));
    }
    return box.getSize(new hook.THREE.Vector3()).length();
  });
const smallFoot = await measureShoe();
await setSlider("발 크기", 4);
await page.waitForTimeout(600);
const bigFoot = await measureShoe();
recordCheck(
  "신발을 신어도 발 크기 조절이 신발에 반영된다",
  smallFoot && bigFoot && bigFoot > smallFoot * 1.3,
  `${smallFoot?.toFixed(3)} → ${bigFoot?.toFixed(3)}`,
);
await getButton("발 크기 초기화", false).first().click();

// 5-2. 옷을 연달아 빨리 바꿔도 화면이 마지막 선택과 맞는다
await getButton("의상").click();
await getButton("입지 않음", false).first().click();
await page.waitForTimeout(120);
await getButton("흰 티셔츠", false).click();
await page.waitForTimeout(120);
await getButton("입지 않음", false).first().click();
await page.waitForTimeout(120);
await getButton("흰 티셔츠", false).click();
await page.waitForTimeout(9000);
const lastDraft = await readDraft();
const shownKey = await page.evaluate(() => window.__game?.characterCreation?.displayKey ?? null);
recordCheck(
  "옷을 연달아 바꿔도 화면이 마지막 선택과 맞는다",
  lastDraft?.appearance.equipmentIds.top === "top.tee.white" && shownKey === "masculine|0|0|0",
  `선택 ${lastDraft?.appearance.equipmentIds.top} / 화면 ${shownKey}`,
);

// 6. 늦게 온 이름 확인 답이 새 이름을 덮지 않는다
await getButton("이름 입력으로", false).click();
await getButton("느린 응답 끔").click(); // 느리게 켬
const nameInput = page.locator("input[placeholder]").first();
await nameInput.fill("첫이름");
await getButton("중복확인").click();
await page.waitForTimeout(400);
await nameInput.fill("둘째이름");
await page.waitForTimeout(3500);
const lateReplyMessage = await page.locator("[role=status]").last().innerText();
const completeButton = getButton("캐릭터 생성 완료", false);
recordCheck(
  "확인 도중 이름을 바꾸면 옛 답이 '사용 가능'으로 남지 않는다",
  !lateReplyMessage.includes("사용할 수 있는") && (await completeButton.isDisabled()),
  lateReplyMessage.trim(),
);
await getButton("느린 응답 켬(2.6초)").click(); // 도로 빠르게

// 7. 중복 이름
await nameInput.fill("조사관");
await getButton("중복확인").click();
await page.waitForTimeout(1200);
recordCheck(
  "이미 쓰는 이름은 중복으로 표시된다",
  (await page.locator("[role=status]").last().innerText()).includes("이미 사용 중"),
);
recordCheck("확인 전에는 완료가 막힌다", await completeButton.isDisabled());

// 8. 형식 오류
await nameInput.fill("가");
await getButton("중복확인").click();
await page.waitForTimeout(600);
recordCheck("짧은 이름은 형식 오류로 걸린다", (await page.locator("[role=status]").last().innerText()).includes("2자 이상"));

// 9. 완료 데이터
await nameInput.fill("김나루");
await getButton("중복확인").click();
await page.waitForTimeout(1200);
recordCheck("확인이 끝나면 완료가 열린다", await completeButton.isEnabled());
await completeButton.click();
await page.waitForTimeout(1500);
const submitted = await readCompleted();
recordCheck(
  "완료 데이터에 화면의 외형과 이름이 들어간다",
  submitted?.displayName === "김나루" &&
    submitted?.appearance.gender === "masculine" &&
    submitted?.appearance.equipmentIds.top === "top.tee.white" &&
    submitted?.appearance.equipmentIds.shoes === "shoes.sneaker.white" &&
    submitted?.appearance.catalogVersion &&
    submitted?.appearance.bodyAssetVersion,
  JSON.stringify(submitted?.appearance.equipmentIds),
);
recordCheck("완료해도 화면이 저절로 넘어가지 않는다", await page.locator("input[placeholder]").first().isVisible());
recordCheck("완료 뒤 다시 누를 수 없다", await completeButton.isDisabled());

// 10. 초안을 initialValue 로 다시 열면 복원된다
const draftToSend = await readDraft();
await getButton("초안을 initialValue 로 다시 열기").click();
await page.waitForTimeout(9000);
const restored = await readDraft();
recordCheck(
  "초안을 initialValue 로 넣으면 외형이 복원된다",
  JSON.stringify(restored?.appearance) === JSON.stringify(draftToSend?.appearance),
  `${restored?.appearance.equipmentIds.top} / 머리 ${restored?.appearance.bodyParameters.headScale}`,
);
recordCheck("복원된 이름도 남는다", restored?.displayName === "김나루", restored?.displayName);
await getButton("이름 입력으로", false).click();
recordCheck("복원된 이름은 다시 확인해야 한다", await getButton("캐릭터 생성 완료", false).isDisabled());

// 11. 키보드만으로 슬라이더를 움직인다(W3C 슬라이더 규칙: 방향키 한 칸, Home/End 범위 끝)
await getButton("← 외형 수정", false).click();
await getButton("체형").click();
const heightSlider = page.getByLabel("키", { exact: true });
await heightSlider.focus();
const focused = await page.evaluate(() => document.activeElement?.type === "range");
await heightSlider.press("Home");
const homeValue = await heightSlider.inputValue();
await heightSlider.press("End");
const endValue = await heightSlider.inputValue();
await heightSlider.press("ArrowLeft");
const oneStepValue = await heightSlider.inputValue();
// 눈금이 다섯 칸이므로 Home=0 · End=4 · 왼쪽 화살표는 한 칸 아래인 3 이다
recordCheck(
  "키보드로 슬라이더를 움직일 수 있다(Home/End/방향키)",
  focused && Number(homeValue) === 0 && Number(endValue) === 4 && Number(oneStepValue) === 3,
  `${homeValue} / ${endValue} / ${oneStepValue}`,
);
// 읽어 주는 값이 숫자가 아니라 칸 이름이어야 한다(화면에 보이는 것과 같게)
const stepName = await heightSlider.getAttribute("aria-valuetext");
recordCheck(
  "슬라이더가 칸 이름을 읽어 준다",
  typeof stepName === "string" && stepName.length > 0 && !/^[0-9.]+$/.test(stepName),
  String(stepName),
);
const allLabeled = await page.evaluate(() => {
  const sliders = [...document.querySelectorAll("input[type=range]")];
  return sliders.every((el) => el.id && document.querySelector(`label[for="${el.id}"]`));
});
recordCheck("모든 슬라이더에 라벨이 붙어 있다", allLabeled);

// 12. UI 를 끌어도 카메라가 돌지 않는다(오버레이가 전면이라 특히 중요하다)
const cameraPosition = () =>
  page.evaluate(() => {
    const { camera } = window.__game.characterCreation.get();
    return [camera.position.x, camera.position.y, camera.position.z];
  });
await getButton("체형").click();
await page.waitForTimeout(500);
const beforeDrag = await cameraPosition();
const handSlider = page.getByLabel("손 크기", { exact: true });
const box = await handSlider.boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2 - 40, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(700);
const afterDrag = await cameraPosition();
const drift = Math.max(...beforeDrag.map((v, i) => Math.abs(v - afterDrag[i])));
// 끌림이 카메라로 새면 40px 드래그에 0.32 라디안(1m 이상) 움직인다. 몇 cm 는 구도 정돈·호흡이다
recordCheck("슬라이더를 끌어도 카메라가 돌지 않는다", drift < 0.15, `카메라 이동 ${drift.toFixed(3)} m`);

// 13. 팝오버를 Esc 로 닫으면 포커스가 부른 단추로 돌아온다
await getButton("관찰 옵션").click();
await page.waitForTimeout(300);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const focusReturned = await page.evaluate(() => document.activeElement?.textContent?.includes("관찰 옵션") ?? false);
recordCheck("팝오버를 닫으면 포커스가 부른 단추로 돌아온다", focusReturned);

// 14. 카메라 안전영역 — 머리·발이 오른쪽 패널이나 왼쪽 레일 뒤로 숨지 않는다
const screenPoints = () =>
  page.evaluate(() => {
    const hook = window.__game.characterCreation;
    const { camera, scene, size } = hook.get();
    let skeleton = null;
    scene.traverse((o) => {
      if (!skeleton && o.isSkinnedMesh && o.skeleton?.getBoneByName("head")) skeleton = o.skeleton;
    });
    const project = (boneName) => {
      const v = new hook.THREE.Vector3()
        .setFromMatrixPosition(skeleton.getBoneByName(boneName).matrixWorld)
        .project(camera);
      return { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height };
    };
    return { head: project("head"), foot: project("foot_l"), width: size.width, height: size.height };
  });
const points = await screenPoints();
const panelLeft = await page.evaluate(() => {
  const panel = document.querySelector('aside[aria-label="조절 패널"]');
  return panel ? panel.getBoundingClientRect().left : Infinity;
});
recordCheck(
  "머리·발이 조절 패널 뒤로 숨지 않는다",
  points.head.x < panelLeft - 8 && points.foot.x < panelLeft - 8 && points.head.y > 0 && points.foot.y < points.height,
  `머리 ${Math.round(points.head.x)},${Math.round(points.head.y)} 발 ${Math.round(points.foot.x)} 패널 ${Math.round(panelLeft)}`,
);

recordCheck("페이지 오류 없음", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
