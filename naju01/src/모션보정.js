// 리타게팅한 클립에 걸어 주는 자세 보정 — 값과 계산을 한곳에 모아 둔다.
// gait.html 에서 켜고 끄며 원본 클립·원본 캐릭터와 나란히 비교할 수 있다.
import * as THREE from "three";

// 모델 기준 축 — Y 위, Z 앞, X 옆(glTF).
const 앞축 = new THREE.Vector3(0, 0, 1);
const 옆축 = new THREE.Vector3(1, 0, 0);
const 위축 = new THREE.Vector3(0, 1, 0);

export const 이동모션 = new Set(["Walk_Loop", "Walk_Formal_Loop", "Jog_Fwd_Loop", "Sprint_Loop", "Crouch_Fwd_Loop"]);
const 걷기모션 = new Set(["Walk_Loop", "Walk_Formal_Loop"]);

// 모션은 보통 체형에 맞춰 만들어진 것이라, 팔이 짧고 골반이 넓은 이 캐릭터에서는
// 팔이 몸통·허벅지를 파고들고 걸을 때 허리가 과하게 숙여진다. 클립을 고치는 대신
// 믹서가 끝난 뒤 본 몇 개를 조금 돌려 준다(모든 동작에 같은 양으로 더해진다).
// 값은 전부 여기 모아 둔다. gait.html 에서 켜고 끄며 원본 클립과 비교할 수 있다.
// 무릎은 건드리지 않는다. 원본 캐릭터의 걷기도 최소 굽힘이 10.8° 라 다리를 끝까지
// 펴지 않는다 — 억지로 펴 봤더니 발의 상하 이동이 원본의 1.5배가 되어 행진하듯 걸었다.
export const 기본보정 = {
  켬: true,
  팔벌림도: 10, // 위팔을 몸에서 바깥으로 — 몸에 닿지 않을 만큼만
  // 걷기·달리기에서는 팔을 도로 몸 쪽으로 붙인다(팔벌림도에서 뺀다). 대기에서는 팔이
  // 허벅지를 파고들어 벌려야 하지만, 걸을 때는 팔이 앞뒤로 흔들려 닿지 않는다.
  걷기팔붙임도: 8,
  // ※ 팔을 옆축(모델 X) 둘레로 돌리는 보정은 쓰지 않는다. 쉴 때 자세에서 팔은 X 를 향하므로
  //   그 축 회전은 굽힘이 아니라 **비틀림**이고, 비틀림 뼈(upperarm/lowerarm_twist)에 웨이트가
  //   하나도 없어 아래팔이 통째로 돌아 팔꿈치가 틀어져 보인다(팔짱 대기에서 실제로 그랬다).
  //   팔을 올리고 내리는 것은 앞축을 쓰는 `팔벌림도` 로 한다.
  // 걷기·달리기에서 위팔을 뒤로 돌린다(+ 뒤로). 클립은 팔을 몸 앞에서만 휘저어 뒤로도 가게 한다.
  걷기팔뒤로도: 10,
  // 걷기·달리기에서 위팔 흔들림 폭 배율(1 = 클립 그대로). 팔이 짧아 같은 각도가 더 크게 읽힌다.
  팔흔듦배율: 0.7,
  // 걷기·달리기에서 팔꿈치 굽힘에서 이만큼(도)을 뺀다(0 밑으로는 안 내려간다) — 편 느낌으로.
  팔꿈치펴기도: 10,
  // 걷기·달리기에서 골반·척추의 좌우 기울임(앞축 둘레 회전) 폭 배율. 1 = 클립 그대로.
  // 앞뒤 끄덕임·비틀림은 그대로 두고 좌우로 흔드는 성분만 줄인다.
  몸흔듦배율: 0.55,
  // 걷기·달리기에서 요추(spine_01)를 앞으로 숙인다(+ 앞으로). 성별별 값에서 정한다.
  걷기숙임도: 0,
  // 걷기·달리기에서 가슴(spine_03)·목(neck_01)을 뒤로 세운다(+ 뒤로). 요추를 숙이고 가슴·목을 세우면
  // 등이 아치가 되어 거북목처럼 구부정한 걸음이 펴진다.
  걷기가슴세움도: 0,
  걷기목세움도: 0,
  // 걷기·달리기에서 골반만 앞으로 기울인다(+ = 골반 위가 앞으로, 엉덩이 뒤로). 허벅지는 되돌려 다리는
  // 제자리, 요추도 되돌려 상체도 제자리 — 골반에 묶인 상의 밑단만 앞이 내려가고 뒤가 올라간다.
  걷기골반기울기도: 0,
  // 걷기·달리기에서 발 피치(+ 발끝 올림). 디딜 때 발이 쉴 때보다 들려 있으면 - 로 내린다.
  걷기발피치도: 0,
  // 걷기·달리기에서 허벅지를 앞으로 내민다(+ 앞으로) — 다리 전체가 앞으로 나온다.
  걷기다리앞도: 0,
  // 걷기·달리기에서 다리를 안쪽으로 모은다(+ 모음). 허벅지를 앞축 둘레로 안으로 돌리고
  // 발은 같은 양 되돌려 발바닥을 평평하게 둔다.
  걷기다리모음도: 4,
  // 골반 기울기·요추 곡선은 0 으로 둔다. 엉덩이를 빼려고 넣었던 값인데, 늘 켜져
  // 있으니 대기 자세에서 상체가 뒤로 젖혀져 다리가 뒤로 빠진 듯 보였다.
  // (엉덩이 빼기 자체는 이미 되돌리기로 했다.) 값은 남겨 두어 실험은 할 수 있다.
  골반기울기도: 0, // + 면 엉덩이가 뒤로(허벅지는 같은 양만큼 되돌려 다리는 제자리)
  허리곡선도: 0, // 요추(spine_01)를 골반 반대로
  // 가슴 세우기는 spine_03 에만 건다. spine_02 에 걸면 그 바로 아래 아랫배가 앞으로
  // 밀려 나온다(여성 몸체에서 확연했다). 가슴만 세우면 등은 펴지고 배는 그대로다.
  허리세움도: 8, // 걷기·달리기에서 가슴을 세운다(+ 뒤로, - 앞으로)
  // 보폭 확대는 끈다(1.0). 허벅지 각을 키우면 발이 **호를 그리며 올라가** 앞발이
  // 뒷발보다 높은 곳을 딛는 것처럼 보인다 — 실측 앞뒤발 바닥 높이차 최대: 원본 0.054,
  // 1.2 배 0.074, 1.0 배 0.051. 걸음 속도는 재생 배속으로만 맞춘다(공용.jsx WALK).
  //   → 접지 IK 를 넣은 뒤엔 반대로 **줄인다**(0.9). 다리가 짧아 클립 보폭에선 앞발이
  //     땅에서 뜨고, 그 틈을 다리로 메우려면 거의 뻗은 다리를 크게 굽혀야 한다.
  //     틈은 보폭에 비례하니 보폭을 줄이는 게 원인 쪽 해결이다.
  보폭배율: 0.8,
  // 발 피치. 쉴 때 자세에서 우리 몸체는 발끝은 땅에 닿고 뒤꿈치가 약 10° 떠 있다
  // (원본은 발바닥이 평평하다). 리타게팅은 뼈의 쉴 때 회전을 기준으로 얹으므로
  // 모든 프레임이 그 발끝-내림을 물려받아, 디딜 때 발끝부터 닿아 앞발이 더 높은
  // 곳을 딛는 듯 보인다. 발목을 그만큼 되돌린다(+ = 발끝 올림).
  발피치도: 10,
  // 무릎 굽힘에서 이만큼(도)을 빼되 0 밑으로는 안 내려간다. 곱하기가 아니라 빼기라서
  // 크게 굽은 구간(80°대)은 거의 그대로고, 거의 다 편 구간(11°)만 0 에 붙어
  // '디딜 때 다리가 쭉 펴지는 찰나'가 또렷해진다.
  //   ※ 예전에 배율로 줄였더니 굽은 구간까지 얕아져 행진하듯 걸었다. 빼기로 한 이유다.
  //   → 접지 IK 가 디딜 때 다리를 뻗어 주므로 4 로 낮춘다. 8 에 IK 까지 겹치니 다리가
  //     너무 반듯해졌다(원본은 뒤꿈치 접지 때 무릎 11~27°).
  무릎펴기도: 4,
  // 목을 뒤로 세운다(+). 원본은 머리가 앞으로 나와도 가슴이 뒤로 젖혀져 곧게 읽히는데,
  // 우리 몸체는 등이 평판처럼 곧은 채 앞으로 기울어 노인처럼 읽힌다.
  목세움도: 0,
  // 접지 IK(치비게임아바타 useFrame). 낮은 발이 땅에 있을 때 다른 발이 이 높이(키 비율)
  // 안에 있으면 그 다리 무릎을 펴서 발바닥을 땅에 붙인다. 앞발이 높은 곳을 딛는 것과
  // '다리가 끝내 안 펴지는' 두 문제가 이 한 가지 원인(발이 땅에 못 닿음)이다.
  접지창: 0.07,
  // 한 다리가 맡는 최대 높이(키 비율). 너무 크면 양발 지지 때 푹 꺼지거나 다리가 잠긴다.
  접지내림: 0.02,
  // 앞다리(엉덩이 회전 + 무릎 폄)가 맡을 수 있는 최대. 사실상 0 — 거의 뻗은 다리는
  // 1.5cm 만 더 내려도 무릎이 15°→2° 로 잠긴다(15° 의 굽힘이 길이로는 0.5cm). 앞다리로
  // 틈을 메우는 것 자체가 '힘줘 뻗는' 경직의 원인이라, 틈은 뒷다리 딥이 맡고 남는
  // 1cm 안팎은 그대로 둔다(원본도 뒤꿈치 접지 때 0.011 떠 있다).
  접지앞상한: 0.003,
  // (접지나눔은 더 쓰지 않는다 — 단계별로 앞다리가 상한까지 먼저, 나머지를 디딘 다리가 맡는다.)
  접지켬: true,
  // 무릎 벌리기(도). 무릎에 비해 발이 양옆으로 벌어져 보인다 — 관절 간격은 원본과 같은데
  // (무릎→발목 좌우 벌어짐 0.009·키, 원본도 0.009) 정강이가 짧아 같은 벌어짐이 더 가파르게
  // 읽힌다. 허벅지를 바깥으로 a, 정강이를 안쪽으로 2a 돌리면 무릎만 바깥으로 나가고
  // 발목은 제자리다(허벅지≈정강이 길이). 발은 a 되돌려 발바닥을 평평하게 둔다.
  무릎벌림도: 3,
  // 발 안쪽 돌림(도, + = 발끝을 안으로). 발뼈는 앞을 보는데 살이 바깥으로 틀어진 몸체에 쓴다.
  발안쪽돌림도: 0,
  // 발마다 다르게 돌릴 때(없으면 발안쪽돌림도). 팔자걸음이 좌우 비대칭인 클립에 쓴다.
  왼발안쪽돌림도: null,
  오른발안쪽돌림도: null,
};

// 성별별 덧값 — 같은 클립·같은 보정인데 몸체가 달라 자세가 다르게 읽힌다.
// 남성 몸체는 등이 곧은 판이라 가슴·목을 더 세워야 여성과 같은 인상이 된다.
// 목은 세우지 않는다: 원본도 걸을 때 목뼈가 27° 앞으로 나가 있다. 10° 를 넣어 봤더니
// 남성이 턱을 들고 하늘을 봤다. 남성이 노인처럼 읽히는 건 등 표면이 판처럼 평평해서다
// (원본은 허리·가슴에서 등이 4~7% 오목하다) — 뼈로는 그 굴곡을 못 만든다.
// 목세움도는 허리세움도의 반대 부호로 둔다: 가슴(spine_03)을 뒤로 세우면 자식인 목·머리가
// 같이 젖혀져 턱이 들리므로, 목을 같은 양 되돌려 머리는 클립 그대로 둔다.
// 남성 12 는 과했다: 걸을 때 몸통이 원본보다 4° 더 뒤로 젖혀져(8.2° vs 12.3°) 상체는
// 뒤, 하체는 앞으로 갈라져 보였다. 6 이면 원본 기울기에 붙는다.
export const 성별보정 = {
  // 남성은 골반을 앞으로 기울여(엉덩이 뒤로) 엉덩이 위 등허리가 앞으로 나오게 하고,
  // 그만큼 요추(spine_01)를 되돌려 가슴 높이의 기울기는 원본(≈11°)에 남긴다.
  // 여성 몸체는 살 자체에 그 굴곡이 있어 뼈로 만들 필요가 없다.
  // 남성 발 살은 뼈보다 5~8° 바깥으로 틀어져 있고(여성 1°) 발 중심이 발목보다 3cm 바깥이라
  // 발이 더 벌어져 보인다. 발끝을 그만큼 안으로 돌린다.
  // 남성 몸체는 어깨가 넓어 같은 벌림이 더 벌어져 읽힌다. 걸을 때 팔을 더 붙인다.
  // 무릎: 남녀 뼈 각도는 같은데(걷기 평균 42°) 남성은 허벅지가 길고 종아리가 짧아 같은 굽힘이
  // 더 구부정하게 읽힌다. 디딜 때 무릎을 더 펴고, 접지 IK 의 디딘 다리 내림도 줄인다.
  // 골반 기울기는 0 으로 되돌렸다. 10° 로 기울이니 고관절이 뒤로 밀려 몸이 발보다 뒤에 앉은
  // 꼴이 되어 걸을 때 무릎이 굽어 보였다(뼈 각도는 여성과 같은데도). 숙임은 요추(걷기숙임도)로 준다.
  masculine: { 허리세움도: 14, 목세움도: -10, 골반기울기도: 0, 허리곡선도: 0, 발안쪽돌림도: 4, 걷기팔붙임도: 12, 걷기숙임도: 5, 무릎펴기도: 10, 접지내림: 0.012 },
  feminine: { 허리세움도: 8, 목세움도: -8, 걷기숙임도: 4, 걷기다리앞도: 6 },
};

// Tripo 클립(우리 몸체에 맞춰 만든 걷기·대기·달리기)에 거는 보정. 자세는 이미 맞으므로 대부분 0 이고,
// 팔만 바깥으로 벌린다 — Tripo 리그는 어깨가 좁아 걸을 때 팔이 골반을 뚫고 대기 때 손이 몸에 파묻힌다.
export const 트리포보정 = {
  ...기본보정,
  // 팔벌림 10: 어깨 기본값을 1.15 로 넓힌 뒤 그만큼 되돌렸다(넓히기 전엔 14).
  팔벌림도: 10, 걷기팔붙임도: 0, 걷기팔뒤로도: 0, 팔흔듦배율: 1, 팔꿈치펴기도: 0, 몸흔듦배율: 1,
  골반기울기도: 0, 허리곡선도: 0, 허리세움도: 0, 목세움도: 0, 보폭배율: 1, 발피치도: 0, 무릎펴기도: 0,
  무릎벌림도: 0, 걷기숙임도: 0, 걷기다리앞도: 0, 걷기다리모음도: 0,
  // 팔자걸음 교정 — Tripo 걷기는 디딜 때 발끝이 왼발 12°, 오른발 5.6° 바깥을 봤다(원본 캐릭터 0°).
  // 대기는 일부러 벌린 자세(28°/14°)라 이만큼 돌려도 열린 채 남는다.
  발안쪽돌림도: 0, 왼발안쪽돌림도: 10, 오른발안쪽돌림도: 4,
  // 걷기 자세는 성별별 덧값(트리포성별보정)에서 편다.
  걷기가슴세움도: 0, 걷기목세움도: 0, 걷기골반기울기도: 0,
  // 디딜 때 발이 쉴 때보다 7° 들려 발 앞이 떠 보였다(실측 쉴 때 -34.5°, 디딜 때 -27°). 6° 내린다.
  걷기발피치도: -6,
  // 접지 IK 는 끈다 — 발이 이미 땅에 있어 IK 가 디딘 다리를 굽히면 걸음마다 무릎이 한 번 튕겼다(실측 13°→25°).
  접지켬: false,
};

// Tripo 걷기·달리기의 성별별 자세 덧값. 남성 걷기는 요추가 뒤로 10°, 목이 앞으로 13° 나가 거북목처럼
// 구부정했다(대기는 요추 앞 14°, 목 0°, 머리 뒤 7°). 대기 자세 쪽으로 요추를 숙이고 가슴·목을 세운다.
//   실측(구간 기울기, + 앞): 남성 걷기 요추→가슴 -4, 가슴→목 +13, 목→머리 +5 / 대기 0, 0, -7.
//   요추 회전은 요추→가슴 구간을, 가슴 회전은 가슴→목 구간을 바꾼다. 가슴을 15° 세우면 목 구간이
//   0 근처가 되고 머리는 대기처럼 살짝 뒤로 간다. 목은 따로 안 세운다(세우면 턱이 든다).
//   남성만 편다(여성 걷기는 문제가 없었다). 머리는 클립 그대로 둔다 — 가슴을 세우면 자식인 목·머리가
//   같이 젖혀져 턱이 들리므로, 요추 숙임 + 가슴 세움 만큼 목을 되돌린다(10 - 15 - (-5) = 0).
//   그 위에 상체 전체를 앞으로 조금 기울인다(요추 숙임 10 — 아치는 그대로, 방향만 앞으로).
export const 트리포성별보정 = {
  // 발: 남성은 발 살이 뼈보다 5~8° 바깥으로 틀어져 있어(성별보정 주석) 뼈 기준 0° 여도 팔자로 읽힌다. 4° 더 돌린다.
  // 골반: Tripo 걷기는 골반 위가 뒤로 10° 기울어(대기 앞 14°) 상의 밑단이 앞은 올라가고 뒤는 엉덩이까지
  // 내려왔다. 골반만 18° 앞으로 돌린다(다리·상체는 제자리).
  masculine: { 걷기숙임도: 10, 걷기가슴세움도: 15, 걷기목세움도: -5, 걷기골반기울기도: 18, 왼발안쪽돌림도: 14, 오른발안쪽돌림도: 8 },
  feminine: {},
};

const 무릎본 = ["calf_l", "calf_r"];

const 보폭본 = ["thigh_l", "thigh_r"];
const 팔꿈치본 = ["lowerarm_l", "lowerarm_r"];
const 몸흔듦본 = ["pelvis", "spine_01", "spine_02", "spine_03"];
const 팔흔듦본 = ["upperarm_l", "upperarm_r"];

// 보정은 런타임에 본을 돌리지 않고 **리타게팅된 클립의 키프레임에 한 번** 넣는다.
// 매 프레임 본을 돌리면 믹서가 값을 다시 쓰지 않는 프레임에 보정이 겹쳐 쌓여
// 팔이 머리 위로 올라가 버린다(실제로 그랬다).
//   [뼈 이름, 모델 기준 축, 각도, 이동 동작에만 적용할지]
const 자세보정 = (값) => [
  ["upperarm_l", 앞축, 값.팔벌림도, false],
  ["upperarm_r", 앞축, -값.팔벌림도, false],
  ["upperarm_l", 앞축, -값.걷기팔붙임도, true],
  ["upperarm_r", 앞축, 값.걷기팔붙임도, true],
  ["upperarm_l", 옆축, 값.걷기팔뒤로도, true],
  ["upperarm_r", 옆축, 값.걷기팔뒤로도, true],
  ["foot_l", 옆축, -값.걷기발피치도, true],
  ["foot_r", 옆축, -값.걷기발피치도, true],
  ["pelvis", 옆축, 값.걷기골반기울기도, true],
  ["thigh_l", 옆축, -값.걷기골반기울기도, true],
  ["thigh_r", 옆축, -값.걷기골반기울기도, true],
  ["spine_01", 옆축, 값.걷기숙임도 - 값.걷기골반기울기도, true],
  ["spine_03", 옆축, -값.걷기가슴세움도, true],
  ["neck_01", 옆축, -값.걷기목세움도, true],
  ["thigh_l", 옆축, -값.걷기다리앞도, true],
  ["thigh_r", 옆축, -값.걷기다리앞도, true],
  // 왼다리는 앞축 둘레 +가 바깥(무릎벌림도와 같은 부호 규칙).
  ["thigh_l", 앞축, -값.걷기다리모음도, true],
  ["thigh_r", 앞축, 값.걷기다리모음도, true],
  ["foot_l", 앞축, 값.걷기다리모음도, true],
  ["foot_r", 앞축, -값.걷기다리모음도, true],
  ["pelvis", 옆축, 값.골반기울기도, false],
  // 골반을 기울이면 자식인 다리까지 같이 뒤로 돈다 → 몸이 앞으로 쏠린 듯 보인다.
  // 허벅지를 같은 양만큼 되돌려 다리는 제자리에 두고 골반·엉덩이만 기울인다.
  ["thigh_l", 옆축, -값.골반기울기도, false],
  ["thigh_r", 옆축, -값.골반기울기도, false],
  ["spine_01", 옆축, -값.허리곡선도, false],
  // 가슴·목 세우기는 모든 동작에 건다. 걷기에만 걸었더니 대기·걷기 사이에 자세가 튀었다.
  ["spine_03", 옆축, -값.허리세움도, false],
  ["neck_01", 옆축, -값.목세움도, false],
  ["foot_l", 옆축, -값.발피치도, false],
  ["foot_r", 옆축, -값.발피치도, false],
  // 무릎 벌리기 — 앞축 둘레. 왼다리는 +가 바깥.
  ["thigh_l", 앞축, 값.무릎벌림도, false],
  ["thigh_r", 앞축, -값.무릎벌림도, false],
  ["calf_l", 앞축, -2 * 값.무릎벌림도, false],
  ["calf_r", 앞축, 2 * 값.무릎벌림도, false],
  ["foot_l", 앞축, 값.무릎벌림도, false],
  ["foot_r", 앞축, -값.무릎벌림도, false],
  // 발끝 안쪽 돌림 — 위축 둘레. 왼발은 +가 바깥(발끝이 +x 로)이라 부호를 뒤집는다.
  ["foot_l", 위축, -(값.왼발안쪽돌림도 ?? 값.발안쪽돌림도), false],
  ["foot_r", 위축, 값.오른발안쪽돌림도 ?? 값.발안쪽돌림도, false],
];

// 쉴 때 자세에서 그 뼈의 부모까지 쌓인 회전 — 모델 기준 축을 부모 기준으로 옮길 때 쓴다.
function 부모쉴때회전(bone) {
  const out = new THREE.Quaternion();
  for (let node = bone.parent; node && node.isBone; node = node.parent) out.premultiply(node.quaternion);
  return out;
}

export function 보정쿼터니언(skin, 값) {
  skin.skeleton.pose();
  const out = new Map();
  자세보정(값).forEach(([name, 축, 도, 이동만]) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (!bone || !도) return;
    const axis = 축.clone().applyQuaternion(부모쉴때회전(bone).invert()).normalize();
    const 회전 = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(도));
    // 같은 뼈에 여러 축의 보정이 걸리면 곱해 쌓는다(덮어쓰면 앞 항목이 사라진다).
    // '늘'과 '이동 중에만'은 따로 쌓는다 — 한 뼈에 둘 다 걸릴 수 있다(팔벌림 + 걷기팔붙임).
    const 칸 = out.get(name) ?? {};
    const 키 = 이동만 ? "이동회전" : "회전";
    칸[키] = 칸[키] ? 회전.multiply(칸[키]) : 회전;
    out.set(name, 칸);
  });
  무릎본.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (bone) out.set(name, { ...(out.get(name) ?? {}), 무릎: bone.quaternion.clone() });
  });
  보폭본.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (bone) out.set(name, { ...(out.get(name) ?? {}), 보폭: bone.quaternion.clone() });
  });
  팔꿈치본.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (bone) out.set(name, { ...(out.get(name) ?? {}), 팔꿈치: bone.quaternion.clone() });
  });
  팔흔듦본.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (bone) out.set(name, { ...(out.get(name) ?? {}), 팔흔듦: true });
  });
  몸흔듦본.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (!bone) return;
    // 모델 앞축을 이 뼈의 쉴 때 로컬 프레임으로 옮긴다(뼈 세계 회전의 역).
    const 세계 = 부모쉴때회전(bone).multiply(bone.quaternion);
    const 축 = 앞축.clone().applyQuaternion(세계.invert()).normalize();
    out.set(name, { ...(out.get(name) ?? {}), 흔듦축: 축 });
  });
  return out;
}

// 클립 전체의 평균 회전 — 보폭을 키울 때 '가운데'로 삼는다.
// 쉴 때 자세를 가운데로 쓰면 안 된다: 걷기 클립의 허벅지는 평균이 앞으로 치우쳐
// 있어서, 쉴 때 기준으로 키우면 **앞으로만 더 나가고 뒤로는 안 뻗는다**.
function 평균회전(track) {
  const 합 = new THREE.Quaternion(0, 0, 0, 0);
  const q = new THREE.Quaternion();
  const 기준 = new THREE.Quaternion().fromArray(track.values, 0);
  let n = 0;
  for (let i = 0; i < track.values.length; i += 4) {
    q.fromArray(track.values, i);
    const 부호 = q.dot(기준) < 0 ? -1 : 1;
    합.x += q.x * 부호;
    합.y += q.y * 부호;
    합.z += q.z * 부호;
    합.w += q.w * 부호;
    n += 1;
  }
  if (!n) return 기준;
  합.set(합.x / n, 합.y / n, 합.z / n, 합.w / n);
  return 합.normalize();
}

// 중심 자세에서 벗어난 각을 배율만큼 키우거나 줄인다(축은 그대로).
function 각도배율(track, 중심, 배율) {
  const 쉴때 = 중심;
  const 쉴때역 = 쉴때.clone().invert();
  const q = new THREE.Quaternion();
  const 축 = new THREE.Vector3();
  for (let i = 0; i < track.values.length; i += 4) {
    const r = 쉴때역.clone().multiply(q.fromArray(track.values, i));
    // w < 0 이면 같은 회전의 '긴 쪽' 표현이다. 먼저 -r 로 바꿔 w ≥ 0 으로 둔 뒤 축·각을 읽는다.
    //   ※ 예전엔 축과 각에 부호를 따로 곱했는데 그러면 회전이 **거꾸로**(역회전) 나온다 —
    //     조깅·질주에서 무릎이 120° 넘게 굽는 키(w<0)만 뒤집혀 다리가 순간 뒤틀렸다.
    if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w);
    const 각 = 2 * Math.acos(THREE.MathUtils.clamp(r.w, -1, 1));
    if (각 < 1e-5) continue;
    const sin = Math.sqrt(Math.max(0, 1 - r.w * r.w));
    축.set(r.x, r.y, r.z).divideScalar(sin);
    r.setFromAxisAngle(축.normalize(), 각 * 배율);
    쉴때.clone().multiply(r).toArray(track.values, i);
  }
}

// 중심 자세에서 벗어난 회전 중 `축` 둘레 성분(비틀림)만 배율로 줄인다. 나머지(흔듦)는 그대로.
//   swing-twist 분해: r = swing · twist, twist = 축 성분만 남긴 사원수.
function 축성분배율(track, 중심, 축, 배율) {
  const 중심역 = 중심.clone().invert();
  const q = new THREE.Quaternion();
  const twist = new THREE.Quaternion();
  for (let i = 0; i < track.values.length; i += 4) {
    const r = 중심역.clone().multiply(q.fromArray(track.values, i));
    if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w);
    const 투영 = r.x * 축.x + r.y * 축.y + r.z * 축.z;
    twist.set(축.x * 투영, 축.y * 투영, 축.z * 투영, r.w).normalize();
    const swing = r.clone().multiply(twist.clone().invert());
    // twist 각을 배율만큼 줄인다.
    const 각 = 2 * Math.atan2(투영, r.w);
    const 줄인 = new THREE.Quaternion().setFromAxisAngle(축, 각 * 배율);
    중심.clone().multiply(swing.multiply(줄인)).toArray(track.values, i);
  }
}

// 허벅지가 앞으로 나간 정도(0~1) — 키마다. 쉴 때 대비 옆축 회전의 앞 성분으로 본다.
function 앞뻗음(thighTrack, 쉴때) {
  const 쉴때역 = 쉴때.clone().invert();
  const q = new THREE.Quaternion();
  const out = new Float32Array(thighTrack.values.length / 4);
  for (let i = 0, k = 0; i < thighTrack.values.length; i += 4, k += 1) {
    const r = 쉴때역.clone().multiply(q.fromArray(thighTrack.values, i));
    // 옆축(x) 둘레 회전각. 다리를 앞으로 차올리면 이 값이 한쪽 부호가 된다.
    const 각 = 2 * Math.atan2(r.x, r.w) * (180 / Math.PI);
    out[k] = 각;
  }
  // 부호가 어느 쪽이 '앞'인지는 클립마다 재지 않고, 평균보다 앞으로 간 쪽을 앞으로 본다.
  const 평균 = out.reduce((a, b) => a + b, 0) / out.length;
  const 폭 = Math.max(1e-3, ...out.map((v) => Math.abs(v - 평균)));
  return { 값: out, 평균, 폭 };
}

// 쉴 때 자세에서 벗어난 각에서 일정 각도를 뺀다(0 밑으로는 안 내려간다).
//   `가중` 을 주면 키마다 그 비율만큼만 뺀다 — 앞으로 뻗은 다리만 펴고
//   뒤로 미는 다리는 그대로 둬야 뒤꿈치가 제때 떨어지고 체중이 앞발로 넘어간다.
//   (전부 폈더니 뒷발에 오래 실려 몸이 딛은 발보다 앞에 머물렀다.)
function 각도빼기(track, 쉴때, 도, 가중 = null) {
  if (!도) return;
  const 뺄각 = THREE.MathUtils.degToRad(도);
  const 쉴때역 = 쉴때.clone().invert();
  const q = new THREE.Quaternion();
  const 축 = new THREE.Vector3();
  for (let i = 0, k = 0; i < track.values.length; i += 4, k += 1) {
    const r = 쉴때역.clone().multiply(q.fromArray(track.values, i));
    // w < 0 이면 -r 로 바꿔 짧은 쪽 표현으로(각도배율과 같은 이유 — 부호를 따로 곱하면 역회전).
    if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w);
    const 각 = 2 * Math.acos(THREE.MathUtils.clamp(r.w, -1, 1));
    if (각 < 1e-5) continue;
    const 비율 = 가중 ? 가중[k] : 1;
    if (비율 <= 0) continue;
    const sin = Math.sqrt(Math.max(0, 1 - r.w * r.w));
    축.set(r.x, r.y, r.z).divideScalar(sin);
    r.setFromAxisAngle(축.normalize(), Math.max(0, 각 - 뺄각 * 비율));
    쉴때.clone().multiply(r).toArray(track.values, i);
  }
}

// 트랙 이름은 "upperarm_l.quaternion" 일 수도 ".bones[upperarm_l].quaternion" 일 수도 있다.
const 트랙본이름 = /(?:\.bones\[)?([^.[\]]+)\]?\.quaternion$/;

export function 클립보정(clip, 보정, 이름, 값) {
  const 이동중 = 이동모션.has(이름);
  const 걷는중 = 걷기모션.has(이름);
  // 뼈 이름 → 트랙. 무릎은 같은 쪽 허벅지 트랙을 봐야 앞뒤를 안다.
  const 트랙표 = new Map();
  clip.tracks.forEach((track) => {
    const m = 트랙본이름.exec(track.name);
    if (m) 트랙표.set(m[1], track);
  });
  // 허벅지는 보폭 확대 뒤의 값으로 앞뒤를 재야 하므로 무릎보다 먼저 처리한다.
  const 순서 = [...clip.tracks].sort((a, b) => {
    const ka = 트랙본이름.exec(a.name)?.[1] ?? "";
    const kb = 트랙본이름.exec(b.name)?.[1] ?? "";
    return (ka.startsWith("calf") ? 1 : 0) - (kb.startsWith("calf") ? 1 : 0);
  });
  순서.forEach((track) => {
    const 이름 = 트랙본이름.exec(track.name);
    if (!이름) return;
    const 규칙 = 보정.get(이름[1]);
    if (!규칙) return;
    const q = new THREE.Quaternion();
    if (규칙.무릎 && 이동중) {
      const 옆 = 이름[1].endsWith("_l") ? "l" : "r";
      const 허벅지 = 트랙표.get(`thigh_${옆}`);
      const 허벅지규칙 = 보정.get(`thigh_${옆}`);
      let 가중 = null;
      if (허벅지 && 허벅지규칙?.보폭 && 허벅지.values.length === track.values.length) {
        const { 값: 각들, 평균, 폭 } = 앞뻗음(허벅지, 허벅지규칙.보폭);
        // 어느 부호가 '앞'인가는 클립에서 읽는다: 무릎이 가장 곧은 키(디디는 순간)에
        // 허벅지가 평균에서 벗어난 방향이 앞이다.
        const 쉴때역 = 규칙.무릎.clone().invert();
        let 곧은키 = 0;
        let 최소 = Infinity;
        for (let i = 0, k = 0; i < track.values.length; i += 4, k += 1) {
          const r = 쉴때역.clone().multiply(q.fromArray(track.values, i));
          const 굽힘 = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(r.w), -1, 1));
          if (굽힘 < 최소) { 최소 = 굽힘; 곧은키 = k; }
        }
        const 방향 = Math.sign(각들[곧은키] - 평균) || 1;
        // 평균보다 앞으로 나간 만큼 0~1. 뒤로 간 키는 0 — 그대로 둔다.
        가중 = Float32Array.from(각들, (v) => THREE.MathUtils.clamp((방향 * (v - 평균)) / 폭, 0, 1));
      }
      각도빼기(track, 규칙.무릎, 값.무릎펴기도, 가중);
      // 여기서 끝내면 안 된다 — 무릎에도 축 회전(무릎벌림도)이 걸린다. 아래로 이어 간다.
    }
    // 허벅지는 보폭 확대(걷기 클립만)와 골반 되돌림(늘)이 같이 걸린다.
    if (규칙.보폭 && 걷는중) 각도배율(track, 평균회전(track), 값.보폭배율);
    // 팔: 흔들림 폭은 클립 평균을 가운데로 줄이고, 팔꿈치는 쉴 때 대비 굽힘에서 뺀다(이동 중만).
    if (규칙.팔흔듦 && 이동중 && 값.팔흔듦배율 !== 1) 각도배율(track, 평균회전(track), 값.팔흔듦배율);
    if (규칙.팔꿈치 && 이동중) 각도빼기(track, 규칙.팔꿈치, 값.팔꿈치펴기도);
    if (규칙.흔듦축 && 이동중 && 값.몸흔듦배율 !== 1) 축성분배율(track, 평균회전(track), 규칙.흔듦축, 값.몸흔듦배율);
    let 적용 = 규칙.회전 ?? null;
    if (이동중 && 규칙.이동회전) 적용 = 적용 ? 적용.clone().premultiply(규칙.이동회전) : 규칙.이동회전;
    if (!적용) return;
    for (let i = 0; i < track.values.length; i += 4) {
      q.fromArray(track.values, i).premultiply(적용);
      q.toArray(track.values, i);
    }
  });
  return clip;
}
