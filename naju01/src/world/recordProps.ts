// 기록·의례 소품 코드 모형(10/19) — 에이전트 시험에서 「라이브러리에 없음」으로 나온 계열(표지석·두루마리·새김판·목판·흰 천·끈·나무패…).
// 미르: 「라이브러리에 채워라」 + 비용 없이. 실제 에셋(생성 공정·공개 3D)이 들어오기 전까지 쓰는 **임시본**이다(needs_replacement).
// 단위 미터 · 밑동 y=0 · 가운데 정렬. 글씨는 새기지 않고 결(어두운 줄)만 — 퍼즐 글은 게임이 따로 얹는다.
import * as THREE from "three";

const mat = (color: string, roughness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
const PAPER = "#E9DFC4", INK = "#3A332B", WOOD = "#8A6440", WOOD_DARK = "#5E4228", STONE = "#9C9890", STONE_DARK = "#6E6A63", CLOTH = "#F2F0EA", ROPE = "#B39462";

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  g.position.set(x, y + h / 2, z);
  return g;
}
function cyl(r: number, h: number, m: THREE.Material, seg = 12) { return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); }
/** 먹 줄 몇 개 — 세로쓰기처럼 */
function inkLines(w: number, h: number, cols: number, m: THREE.Material, depth = 0.002) {
  const g = new THREE.Group();
  for (let i = 0; i < cols; i++) {
    const x = -w / 2 + (w / (cols + 1)) * (i + 1);
    const len = h * (0.55 + ((i * 37) % 30) / 100);
    const line = new THREE.Mesh(new THREE.BoxGeometry(w / (cols * 4), len, depth), m);
    line.position.set(x, h / 2 - len / 2 - h * 0.08, 0);
    g.add(line);
  }
  return g;
}
const rope = (points: THREE.Vector3[], r = 0.012) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, r, 6), mat(ROPE));

export interface RecordPropDef { slug: string; nameKo: string; category: string; tags: string[]; description: string; setting: string[]; build: () => THREE.Group }

export const RECORD_PROPS: RecordPropDef[] = [
  {
    slug: "scroll-rolled", nameKo: "두루마리(말림)", category: "study", tags: ["두루마리", "기록", "문서", "명부", "장부", "종이"], setting: ["village", "interior"],
    description: "끈으로 묶어 말아 둔 종이 두루마리. 양끝에 나무 축. 길이 약 0.4 m",
    build() { const g = new THREE.Group(); const p = cyl(0.035, 0.34, mat(PAPER)); p.rotation.z = Math.PI / 2; p.position.y = 0.04; g.add(p);
      for (const s of [-1, 1]) { const a = cyl(0.012, 0.05, mat(WOOD_DARK)); a.rotation.z = Math.PI / 2; a.position.set(s * 0.19, 0.04, 0); g.add(a); }
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.037, 0.004, 6, 16), mat("#7A2E24")); t.rotation.y = Math.PI / 2; t.position.y = 0.04; g.add(t); return g; },
  },
  {
    slug: "scroll-open", nameKo: "두루마리(펼침)", category: "study", tags: ["두루마리", "기록", "문서", "명부", "장부", "펼친 문서"], setting: ["village", "interior"],
    description: "바닥이나 상 위에 펼쳐 둔 두루마리. 세로로 쓴 먹 글줄. 폭 약 0.6 m",
    build() { const g = new THREE.Group(); const sheet = box(0.6, 0.004, 0.3, mat(PAPER)); g.add(sheet);
      const lines = inkLines(0.56, 0.26, 9, mat(INK)); lines.rotation.x = -Math.PI / 2; lines.position.y = 0.005; g.add(lines);
      for (const s of [-1, 1]) { const r = cyl(0.03, 0.32, mat(PAPER)); r.rotation.x = Math.PI / 2; r.position.set(s * 0.31, 0.03, 0); g.add(r); } return g; },
  },
  {
    slug: "ledger-books", nameKo: "장부·책 묶음", category: "study", tags: ["장부", "일지", "책", "기록", "명부", "마을 기록"], setting: ["village", "interior", "bureau"],
    description: "실로 맨 옛 책 서너 권을 쌓아 둔 것. 표지는 누런 빛. 약 0.3×0.2 m",
    build() { const g = new THREE.Group(); const cols = ["#C9A86A", "#B8955A", "#D4B57A", "#A88650"];
      cols.forEach((c, i) => { const b = box(0.28 - i * 0.01, 0.025, 0.2, mat(c)); b.position.y += i * 0.027; b.rotation.y = (i % 2 ? 1 : -1) * 0.06; g.add(b); }); return g; },
  },
  {
    slug: "wood-tablet-carved", nameKo: "나무 새김판", category: "ritual", tags: ["새김판", "목판", "기록판", "증언", "전승", "판자", "글"], setting: ["village", "shrine"],
    description: "글을 새긴 두꺼운 나무판. 벽이나 바위에 기대어 세운다. 높이 약 0.7 m",
    build() { const g = new THREE.Group(); const b = box(0.45, 0.7, 0.05, mat(WOOD)); b.rotation.x = -0.12; g.add(b);
      const l = inkLines(0.4, 0.6, 6, mat(WOOD_DARK), 0.01); l.position.set(0, 0.36, 0.03); l.rotation.x = -0.12; g.add(l); return g; },
  },
  {
    slug: "notice-board", nameKo: "방문 게시판(쪽지 붙은 판)", category: "building", tags: ["게시판", "쪽지", "소문", "방", "알림", "마을 골목", "담벼락"], setting: ["village", "market"],
    description: "기둥 둘에 판자를 대고 종이 쪽지 여러 장을 붙인 마을 알림판. 높이 약 1.8 m",
    build() { const g = new THREE.Group(); for (const s of [-1, 1]) g.add(box(0.08, 1.8, 0.08, mat(WOOD_DARK), s * 0.55)); g.add(box(1.2, 0.7, 0.04, mat(WOOD), 0, 0.9));
      const notes = [[-0.35, 1.35, 0.1], [0.05, 1.3, -0.08], [0.38, 1.38, 0.05], [-0.15, 1.08, 0.04], [0.28, 1.05, -0.1]];
      for (const [x, y, r] of notes) { const n = box(0.22, 0.28, 0.006, mat(PAPER), x, y - 0.14, 0.025); n.rotation.z = r; g.add(n); const l = inkLines(0.18, 0.24, 3, mat(INK)); l.position.set(x, y, 0.03); l.rotation.z = r; g.add(l); }
      g.add(box(1.3, 0.06, 0.12, mat(WOOD_DARK), 0, 1.6)); return g; },
  },
  {
    slug: "marker-stone", nameKo: "표지석(새긴 선돌)", category: "ritual", tags: ["표지석", "선돌", "비석", "이정표", "새김돌", "지명", "돌판"], setting: ["village", "river", "mountain_temple"],
    description: "자연석을 세우고 앞면을 다듬어 글을 새긴 표지석. 높이 약 1.1 m",
    build() { const g = new THREE.Group(); const geo = new THREE.BoxGeometry(0.5, 1.1, 0.28, 3, 6, 2); const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); const k = 1 - Math.max(0, y - 0.3) * 0.5; pos.setX(i, pos.getX(i) * k + Math.sin(i * 12.9) * 0.02); pos.setZ(i, pos.getZ(i) * (pos.getZ(i) > 0 ? 1 : 1 + Math.cos(i * 7.3) * 0.15)); }
      geo.computeVertexNormals(); const s = new THREE.Mesh(geo, mat(STONE)); s.position.y = 0.55; g.add(s);
      const face = box(0.28, 0.6, 0.01, mat(STONE_DARK), 0, 0.3, 0.14); g.add(face); const l = inkLines(0.24, 0.5, 3, mat("#4A4741"), 0.012); l.position.set(0, 0.6, 0.15); g.add(l);
      g.add(box(0.7, 0.08, 0.45, mat(STONE_DARK))); return g; },
  },
  {
    slug: "stone-slab-carved", nameKo: "새긴 돌판", category: "ritual", tags: ["돌판", "새김판", "기록", "전승", "증언", "바위 새김"], setting: ["village", "river", "shrine"],
    description: "땅에 비스듬히 기대 둔 납작한 돌판. 겉에 글줄을 새김. 높이 약 0.6 m",
    build() { const g = new THREE.Group(); const b = box(0.6, 0.6, 0.1, mat(STONE)); b.rotation.x = -0.35; b.position.z -= 0.05; g.add(b);
      const l = inkLines(0.5, 0.5, 5, mat(STONE_DARK), 0.012); l.position.set(0, 0.3, 0.02); l.rotation.x = -0.35; g.add(l); return g; },
  },
  {
    slug: "wooden-tags-string", nameKo: "나무패 꿰미", category: "ritual", tags: ["나무패", "꿰미", "패", "끈", "목판 조각", "노래 조각", "순서"], setting: ["village", "shrine"],
    description: "새끼줄에 글을 쓴 작은 나무패 여러 개를 꿴 것. 걸어 두거나 바닥에 놓는다. 길이 약 0.8 m",
    build() { const g = new THREE.Group(); const pts = [-0.4, -0.2, 0, 0.2, 0.4].map((x, i) => new THREE.Vector3(x, 0.03 + (i % 2) * 0.01, Math.sin(i) * 0.03)); g.add(rope(pts, 0.008));
      [-0.3, -0.1, 0.1, 0.3].forEach((x, i) => { const t = box(0.07, 0.012, 0.13, mat(i % 2 ? WOOD : "#9D7550"), x, 0.012, 0.08); t.rotation.y = (i - 1.5) * 0.15; g.add(t); }); return g; },
  },
  {
    slug: "rope-broken", nameKo: "끊어진 끈", category: "household", tags: ["끈", "새끼줄", "끊어진 끈", "흔적", "줄"], setting: ["village", "river", "mountain"],
    description: "바닥에 떨어진 끊어진 새끼줄 두 토막. 길이 약 0.6 m",
    build() { const g = new THREE.Group(); g.add(rope([new THREE.Vector3(-0.3, 0.012, 0), new THREE.Vector3(-0.15, 0.012, 0.08), new THREE.Vector3(0, 0.012, 0.02)], 0.012));
      g.add(rope([new THREE.Vector3(0.05, 0.012, -0.05), new THREE.Vector3(0.18, 0.012, -0.12), new THREE.Vector3(0.3, 0.012, -0.04)], 0.012)); return g; },
  },
  {
    slug: "white-cloth-line", nameKo: "흰 천 건 줄(의례)", category: "ritual", tags: ["흰 천", "굿", "씻김굿", "의례", "천", "줄", "제상 터"], setting: ["river", "shrine", "village"],
    description: "대나무 장대 둘 사이에 줄을 걸고 흰 천 자락을 늘어뜨린 굿판 장식. 높이 약 2 m",
    build() { const g = new THREE.Group(); for (const s of [-1, 1]) { const p = cyl(0.03, 2.1, mat("#A8A06A")); p.position.set(s * 1.1, 1.05, 0); g.add(p); }
      g.add(rope([new THREE.Vector3(-1.1, 1.95, 0), new THREE.Vector3(0, 1.82, 0), new THREE.Vector3(1.1, 1.95, 0)], 0.01));
      [-0.75, -0.35, 0.05, 0.45, 0.8].forEach((x, i) => { const len = 0.8 + (i % 3) * 0.25; const c = box(0.22, len, 0.01, mat(CLOTH), x, 1.86 - len, 0); c.rotation.y = (i - 2) * 0.12; g.add(c); }); return g; },
  },
  {
    slug: "white-cloth-folded", nameKo: "흰 천(개어 둠)", category: "ritual", tags: ["흰 천", "천", "무명", "의례", "제구"], setting: ["shrine", "village"],
    description: "개어 둔 흰 무명천 한 필. 약 0.4×0.3 m",
    build() { const g = new THREE.Group(); for (let i = 0; i < 4; i++) { const b = box(0.4 - i * 0.01, 0.025, 0.3, mat(i % 2 ? CLOTH : "#E6E2D8")); b.position.y += i * 0.025; g.add(b); } return g; },
  },
  {
    slug: "ritual-table", nameKo: "제상(굿상)", category: "ritual", tags: ["제상", "굿상", "의례", "상", "제물", "씻김굿"], setting: ["river", "shrine", "village"],
    description: "다리 짧은 나무 제상 위에 제기 그릇 몇 개. 폭 약 1 m",
    build() { const g = new THREE.Group(); g.add(box(1.0, 0.05, 0.5, mat(WOOD), 0, 0.35)); for (const x of [-0.45, 0.45]) for (const z of [-0.2, 0.2]) g.add(box(0.05, 0.35, 0.05, mat(WOOD_DARK), x, 0, z));
      [-0.3, 0, 0.3].forEach((x, i) => { const b = cyl(0.07, 0.06 + i * 0.01, mat(["#C8C2B4", "#8F6B48", "#D9D2C2"][i])); b.position.set(x, 0.43, 0); g.add(b); }); return g; },
  },
  {
    slug: "record-shelf", nameKo: "기록 선반", category: "household", tags: ["선반", "기록", "두루마리", "책", "보관", "모음"], setting: ["interior", "village", "bureau"],
    description: "두루마리와 책을 얹은 낮은 나무 선반. 높이 약 1 m",
    build() { const g = new THREE.Group(); for (const x of [-0.45, 0.45]) g.add(box(0.05, 1.0, 0.3, mat(WOOD_DARK), x)); for (const y of [0.05, 0.5, 0.95]) g.add(box(0.95, 0.03, 0.3, mat(WOOD), 0, y));
      for (let i = 0; i < 5; i++) { const s = cyl(0.03, 0.26, mat(PAPER)); s.rotation.x = Math.PI / 2; s.position.set(-0.35 + i * 0.12, 0.56, 0); g.add(s); }
      for (let i = 0; i < 3; i++) g.add(box(0.2, 0.025, 0.22, mat("#C2A065"), -0.2 + i * 0.03, 0.08 + i * 0.027)); return g; },
  },
];

/** 무리처럼 하나로 — 바닥 y=0 · 가운데 */
export function centered(group: THREE.Group) {
  const box = new THREE.Box3().setFromObject(group);
  group.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const root = new THREE.Group();
  root.add(group);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return { root, boundsM: [size.x, size.y, size.z].map((v) => Math.round(v * 100) / 100) };
}
