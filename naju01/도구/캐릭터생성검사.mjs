// 캐릭터 생성 화면 자동 검사 (개발 서버가 떠 있어야 한다: npx vite naju01 → 5174)
//
//   실행:  node naju01/도구/캐릭터생성검사.mjs
//
// 눈으로 보기 어려운 것들만 기계로 확인한다 — 기본 착장, 성별별 초안 보존, 슬라이더가
// 실제 3D 를 바꾸는지, 늦게 온 이름 확인 답이 새 이름을 덮지 않는지, 완료 데이터의 내용,
// 초안을 initialValue 로 되돌렸을 때 복원되는지.
import { chromium } from "playwright";

const 주소 = process.env.주소 ?? "http://localhost:5174/캐릭터생성.html";
const 결과 = [];
const 참 = (이름, 조건, 덧 = "") => {
  결과.push({ 이름, 통과: Boolean(조건), 덧 });
  console.log(`${조건 ? "✓" : "✗"} ${이름}${덧 ? ` — ${덧}` : ""}`);
};

const 브 = await chromium.launch({ channel: "chrome", headless: false });
const 쪽 = await 브.newPage({ viewport: { width: 1600, height: 950 } });
const 콘솔오류 = [];
쪽.on("pageerror", (e) => 콘솔오류.push(e.message));
await 쪽.goto(주소, { waitUntil: "networkidle" });
await 쪽.waitForTimeout(9000);

const 초안읽기 = async () => {
  const 글 = await 쪽.locator("pre").nth(1).innerText();
  try {
    return JSON.parse(글);
  } catch {
    return null;
  }
};
const 완료읽기 = async () => {
  const 글 = await 쪽.locator("pre").nth(0).innerText();
  try {
    return JSON.parse(글);
  } catch {
    return null;
  }
};
// 캐릭터의 실제 높이(m) — 슬라이더가 3D 를 바꾸는지 보는 잣대.
const 키재기 = () => 쪽.evaluate(() => {
  const H = window.__캐릭터생성;
  if (!H) return null;
  const { scene } = H.get();
  let 무리 = null;
  scene.traverse((o) => { if (!무리 && o.name === "NAJU-chibi-avatar") 무리 = o; });
  if (!무리) return null;
  const 상자 = new H.THREE.Box3().setFromObject(무리);
  return 상자.max.y - 상자.min.y;
});
const 밀기 = async (이름, 값) => {
  await 쪽.getByLabel(이름, { exact: true }).fill(String(값));
  await 쪽.waitForTimeout(600);
};
const 단추 = (이름, 딱 = true) => 쪽.getByRole("button", { name: 이름, exact: 딱 }).first();

// 1. 신규 기본값은 속옷·맨발
const 처음 = await 초안읽기();
참(
  "신규 기본은 속옷·맨발",
  처음?.appearance.equipmentIds.top === "top.none"
  && 처음?.appearance.equipmentIds.bottom === "bottom.none"
  && 처음?.appearance.equipmentIds.shoes === "shoes.none",
  JSON.stringify(처음?.appearance.equipmentIds),
);
참("신규 기본 헤어는 그 성별의 실제 헤어", 처음?.appearance.hairId === "hair.m.crop", 처음?.appearance.hairId);
참("어깨·팔 길이 기본값은 보정된 값", 처음?.appearance.bodyParameters.shoulderWidth === 1.2 && 처음?.appearance.bodyParameters.armLength === 0.88);

// 2. 슬라이더가 실제 3D 를 바꾼다
await 단추("체형").click();
const 기본키 = await 키재기();
await 밀기("키", 1.3);
const 큰키 = await 키재기();
await 밀기("키", 0.7);
const 작은키 = await 키재기();
참("키 슬라이더가 실제 모델 높이를 바꾼다", 큰키 > 기본키 * 1.2 && 작은키 < 기본키 * 0.8, `${기본키?.toFixed(3)} → ${큰키?.toFixed(3)} / ${작은키?.toFixed(3)}`);
await 단추("키 초기화", false).first().click();
await 쪽.waitForTimeout(600);
const 되돌린키 = await 키재기();
참("항목 초기화가 기본값으로 되돌린다", Math.abs(되돌린키 - 기본키) < 0.005, `${되돌린키?.toFixed(3)}`);

// 3. 성별을 오가도 각자 초안이 남는다
await 단추("체형").click();
await 밀기("머리 크기", 1.25);
await 단추("기본").click();
await 단추("여성").click();
await 쪽.waitForTimeout(5000);
await 단추("체형").click();
await 밀기("머리 크기", 0.85);
await 단추("기본").click();
await 단추("남성").click();
await 쪽.waitForTimeout(5000);
const 남자초안 = await 초안읽기();
참("남→여→남 에서 남성 초안이 복원된다", Math.abs((남자초안?.appearance.bodyParameters.headScale ?? 0) - 1.25) < 0.001, String(남자초안?.appearance.bodyParameters.headScale));
await 단추("기본").click();
await 단추("여성").click();
await 쪽.waitForTimeout(5000);
const 여자초안 = await 초안읽기();
참("여성 초안도 그대로 남는다", Math.abs((여자초안?.appearance.bodyParameters.headScale ?? 0) - 0.85) < 0.001, String(여자초안?.appearance.bodyParameters.headScale));
await 단추("기본").click();
await 단추("남성").click();
await 쪽.waitForTimeout(5000);

// 4. 옷을 갈아입어도 체형값은 그대로
await 단추("의상").click();
await 단추("흰 티셔츠", false).click();
await 쪽.waitForTimeout(3500);
await 단추("흰 운동화", false).click();
await 쪽.waitForTimeout(3500);
const 옷입은뒤 = await 초안읽기();
참("옷을 갈아입어도 체형값이 유지된다", Math.abs((옷입은뒤?.appearance.bodyParameters.headScale ?? 0) - 1.25) < 0.001);
참("의상 선택이 초안에 들어간다", 옷입은뒤?.appearance.equipmentIds.top === "top.tee.white" && 옷입은뒤?.appearance.equipmentIds.shoes === "shoes.sneaker.white");

// 5. 신발을 신어도 발 크기가 실제로 바뀐다(신발 GLB 에는 모프가 없어 따로 처리한다)
await 단추("체형").click();
await 밀기("발 크기", 0.7);
await 쪽.waitForTimeout(600);
// 스킨드 메시는 뼈가 움직여도 제 행렬이 안 바뀐다 — 스키닝된 정점을 직접 읽어 재야 한다.
const 신발재기 = () => 쪽.evaluate(() => {
  const H = window.__캐릭터생성;
  const { scene } = H.get();
  let 신발 = null;
  scene.traverse((o) => { if (!신발 && o.isSkinnedMesh && o.userData.slot === "shoes" && o.visible) 신발 = o; });
  if (!신발) return null;
  const 상자 = new H.THREE.Box3();
  const 점 = new H.THREE.Vector3();
  const 수 = 신발.geometry.getAttribute("position").count;
  for (let i = 0; i < 수; i += 7) {
    신발.getVertexPosition(i, 점);
    상자.expandByPoint(신발.localToWorld(점));
  }
  return 상자.getSize(new H.THREE.Vector3()).length();
});
const 작은발 = await 신발재기();
await 밀기("발 크기", 1.3);
await 쪽.waitForTimeout(600);
const 큰발 = await 신발재기();
참("신발을 신어도 발 크기 조절이 신발에 반영된다", 작은발 && 큰발 && 큰발 > 작은발 * 1.3, `${작은발?.toFixed(3)} → ${큰발?.toFixed(3)}`);
await 단추("발 크기 초기화", false).first().click();

// 5-2. 옷을 연달아 빨리 바꿔도 화면이 마지막 선택과 맞는다
await 단추("의상").click();
await 단추("입지 않음", false).first().click();
await 쪽.waitForTimeout(120);
await 단추("흰 티셔츠", false).click();
await 쪽.waitForTimeout(120);
await 단추("입지 않음", false).first().click();
await 쪽.waitForTimeout(120);
await 단추("흰 티셔츠", false).click();
await 쪽.waitForTimeout(9000);
const 마지막 = await 초안읽기();
const 화면열쇠 = await 쪽.evaluate(() => window.__캐릭터생성?.표시열쇠 ?? null);
참("옷을 연달아 바꿔도 화면이 마지막 선택과 맞는다",
  마지막?.appearance.equipmentIds.top === "top.tee.white" && 화면열쇠 === "masculine|0|-1|0",
  `선택 ${마지막?.appearance.equipmentIds.top} / 화면 ${화면열쇠}`);

// 6. 늦게 온 이름 확인 답이 새 이름을 덮지 않는다
await 단추("이름 입력으로", false).click();
await 단추("느린 응답 끔").click(); // 느리게 켬
const 이름칸 = 쪽.locator("input[placeholder]").first();
await 이름칸.fill("첫이름");
await 단추("중복확인").click();
await 쪽.waitForTimeout(400);
await 이름칸.fill("둘째이름");
await 쪽.waitForTimeout(3500);
const 늦은답뒤메시지 = await 쪽.locator("[role=status]").last().innerText();
const 완료단추 = 단추("캐릭터 생성 완료", false);
참(
  "확인 도중 이름을 바꾸면 옛 답이 '사용 가능'으로 남지 않는다",
  !늦은답뒤메시지.includes("사용할 수 있는") && (await 완료단추.isDisabled()),
  늦은답뒤메시지.trim(),
);
await 단추("느린 응답 켬(2.6초)").click(); // 도로 빠르게

// 7. 중복 이름
await 이름칸.fill("조사관");
await 단추("중복확인").click();
await 쪽.waitForTimeout(1200);
참("이미 쓰는 이름은 중복으로 표시된다", (await 쪽.locator("[role=status]").last().innerText()).includes("이미 사용 중"));
참("확인 전에는 완료가 막힌다", await 완료단추.isDisabled());

// 8. 형식 오류
await 이름칸.fill("가");
await 단추("중복확인").click();
await 쪽.waitForTimeout(600);
참("짧은 이름은 형식 오류로 걸린다", (await 쪽.locator("[role=status]").last().innerText()).includes("2자 이상"));

// 9. 완료 데이터
await 이름칸.fill("김나루");
await 단추("중복확인").click();
await 쪽.waitForTimeout(1200);
참("확인이 끝나면 완료가 열린다", await 완료단추.isEnabled());
await 완료단추.click();
await 쪽.waitForTimeout(1500);
const 보낸것 = await 완료읽기();
참("완료 데이터에 화면의 외형과 이름이 들어간다",
  보낸것?.displayName === "김나루"
  && 보낸것?.appearance.gender === "masculine"
  && 보낸것?.appearance.equipmentIds.top === "top.tee.white"
  && 보낸것?.appearance.equipmentIds.shoes === "shoes.sneaker.white"
  && 보낸것?.appearance.catalogVersion
  && 보낸것?.appearance.bodyAssetVersion,
  JSON.stringify(보낸것?.appearance.equipmentIds));
참("완료해도 화면이 저절로 넘어가지 않는다", await 쪽.locator("input[placeholder]").first().isVisible());
참("완료 뒤 다시 누를 수 없다", await 완료단추.isDisabled());

// 10. 초안을 initialValue 로 다시 열면 복원된다
const 보낼초안 = await 초안읽기();
await 단추("초안을 initialValue 로 다시 열기").click();
await 쪽.waitForTimeout(9000);
const 복원 = await 초안읽기();
참("초안을 initialValue 로 넣으면 외형이 복원된다",
  JSON.stringify(복원?.appearance) === JSON.stringify(보낼초안?.appearance),
  `${복원?.appearance.equipmentIds.top} / 머리 ${복원?.appearance.bodyParameters.headScale}`);
참("복원된 이름도 남는다", 복원?.displayName === "김나루", 복원?.displayName);
await 단추("이름 입력으로", false).click();
참("복원된 이름은 다시 확인해야 한다", await 단추("캐릭터 생성 완료", false).isDisabled());

// 11. 키보드만으로 슬라이더를 움직인다(W3C 슬라이더 규칙: 방향키 한 칸, Home/End 범위 끝)
await 단추("← 외형 수정", false).click();
await 단추("체형").click();
const 키슬라이더 = 쪽.getByLabel("키", { exact: true });
await 키슬라이더.focus();
const 포커스갔나 = await 쪽.evaluate(() => document.activeElement?.type === "range");
await 키슬라이더.press("Home");
const 홈값 = await 키슬라이더.inputValue();
await 키슬라이더.press("End");
const 엔드값 = await 키슬라이더.inputValue();
await 키슬라이더.press("ArrowLeft");
const 한칸값 = await 키슬라이더.inputValue();
참("키보드로 슬라이더를 움직일 수 있다(Home/End/방향키)",
  포커스갔나 && Number(홈값) === 0.7 && Number(엔드값) === 1.3 && Math.abs(Number(한칸값) - 1.29) < 0.001,
  `${홈값} / ${엔드값} / ${한칸값}`);
const 이름표있나 = await 쪽.evaluate(() => {
  const 칸 = [...document.querySelectorAll('input[type=range]')];
  return 칸.every((el) => el.id && document.querySelector(`label[for="${el.id}"]`));
});
참("모든 슬라이더에 라벨이 붙어 있다", 이름표있나);

참("페이지 오류 없음", 콘솔오류.length === 0, 콘솔오류.join(" | "));

await 브.close();
const 실패 = 결과.filter((r) => !r.통과);
console.log(`\n${결과.length - 실패.length}/${결과.length} 통과`);
process.exit(실패.length ? 1 : 0);
