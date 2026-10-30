# tools/rooms — 실내 방 세트 생성기 (10/20 시험판 → 10/21 저장소 이식)

에이전트 시험의 **실내 공간**(공간: 실내 방 세트)이 쓰는 코드. 사람이 직접 돌릴 수도 있다.

| 파일 | 하는 일 |
|---|---|
| `room_gen.py` | 한옥 방 하나(벽·바닥·천장·문/창/벽장·시렁·횃대·부뚜막) GLB + 배치용 json |
| `rooms_set.py set.json out_dir/` | 독립된 방 여러 개 + 방 사이 연결 정보 + 연결 개연성 검사(`rooms_set.json`) |
| `place_room.py room.json plan.json out.json` | 실내 배치 규칙 v0(문 앞·통로 비우기, 벽·구석·바닥·올려놓기). `room_fit.json` = 방 성격별 물건 상식 |
| `build_view.py out_dir/` | 방별 플레이 정보(부딪힘·조명·처음 설 자리·문 이동) |
| `compose.mjs room.glb place.json out.glb` | 방 + 물건 → 한 GLB(텍스처 512 webp) |
| `viewer_template.html` | 걸어 다니며 보는 뷰어(나주맵과 같은 조작, 만화 v3 기본) |

필요한 것: `python3` + `pip3 install numpy trimesh pillow`, 저장소 `node_modules`(@gltf-transform·sharp).

재질 텍스처(`tex/`): 화성행궁 온돌(한국문화정보원 KCISA) · 신라 가옥(국가유산청 KHS) 공개 3D 에서 뽑음 — CC BY. 흙·미장·숯·그을음은 코드로 만듦.
