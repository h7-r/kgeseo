# 노면이 매끄러운가 — **걷는 폭만** 재고, 옛 지형과 견준다.
#   쓰는 법: Blender --background --factory-startup --python 도구/노면재기.py -- <옛높이.bin> [다듬기 되풀이…]
import numpy as np, math, sys
인자 = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
옛경로 = 인자[0]
되풀이들 = [int(v) for v in 인자[1:]] or [None]

원 = open("naju01/도구/지형짓기.py", encoding="utf-8").read()
원 = 원[:원.rindex("주()")]
nx, nz, 칸 = 321, 201, 0.25
o = np.fromfile(옛경로, dtype="<f4")
옛 = o[nx * nz:2 * nx * nz].reshape(nz, nx)

def 뜨기(판, x, z):
    u = np.clip(x / 칸, 0, nx - 1.001); v = np.clip(z / 칸, 0, nz - 1.001)
    i = u.astype(int); j = v.astype(int); fu = u - i; fv = v - j
    return (판[j, i] * (1 - fu) + 판[j, i + 1] * fu) * (1 - fv) + \
           (판[j + 1, i] * (1 - fu) + 판[j + 1, i + 1] * fu) * fv

def 재기(판, 통로들):
    줄 = []
    for 코드, 폭, 시작, 끝, 점 in 통로들:
        반 = 폭 / 2
        누 = [0.0]
        for i in range(len(점) - 1):
            누.append(누[-1] + math.hypot(점[i+1][0]-점[i][0], 점[i+1][1]-점[i][1]))
        전체 = 누[-1]; xs=[]; zs=[]; 램=[]; ws=[]
        for i in range(len(점) - 1):
            (x1,z1),(x2,z2) = 점[i], 점[i+1]
            L = math.hypot(x2-x1, z2-z1)
            if L < 1e-9: continue
            n = max(2, int(L / 0.12)); ux,uz = (x2-x1)/L,(z2-z1)/L; px,pz = -uz,ux
            for k in range(n):
                t = k/n; cx = x1+(x2-x1)*t; cz = z1+(z2-z1)*t
                for w in np.linspace(-반, 반, 11):
                    xs.append(cx+px*w); zs.append(cz+pz*w); ws.append(w)
                    램.append(시작 + (끝-시작) * ((누[i]+L*t)/전체))
        xs=np.array(xs); zs=np.array(zs); 램=np.array(램); ws=np.array(ws)
        # ★ 스위치백에서 **반대쪽 다리 위에 떨어진 표본**을 뺀다.
        #   한 다리에서 수직으로 훑으면 헤어핀 안쪽에서는 그 수선이 다른
        #   다리를 지난다. 그 점의 높이는 이쪽 램프가 아니라 저쪽 램프라,
        #   그대로 세면 「노면이 1.4 m 어긋난다」는 가짜 결론이 나온다.
        #   중심선까지의 **진짜 최단거리**가 |w| 와 같을 때만 이 다리의 노면이다.
        최단 = np.full(xs.shape, 1e9)
        for i in range(len(점) - 1):
            (ax,az),(bx,bz) = 점[i], 점[i+1]
            dx,dz = bx-ax, bz-az; L2 = dx*dx+dz*dz
            if L2 < 1e-12: continue
            t = np.clip(((xs-ax)*dx + (zs-az)*dz)/L2, 0, 1)
            최단 = np.minimum(최단, np.hypot(xs-(ax+t*dx), zs-(az+t*dz)))
        내것 = 최단 >= np.abs(ws) - 0.05
        xs, zs, 램 = xs[내것], zs[내것], 램[내것]
        y = 뜨기(판, xs, zs)
        줄.append((코드, 전체, float(np.abs(np.diff(y)).max()), float(np.abs(y-램).max()),
                   int((np.abs(y-램) > 0.05).sum()), len(램)))
    return 줄

for 되 in 되풀이들:
    g = {"__name__": "t"}
    src = 원 if 되 is None else 원.replace("되풀이=14", f"되풀이={되}")
    exec(compile(src, "t", "exec"), g)
    _, _, h, _, _, _ = g["높이짓기"]()
    옛줄 = 재기(옛, g["통로들"])
    새줄 = 재기(h, g["통로들"])
    print(f"  ── 다듬기 되풀이 {되 if 되 is not None else '(현재값)'} ──")
    print("  통로 | 길이(도면)   | 단차 옛→새   | 어긋남 옛→새 | 5cm 초과")
    도면 = {"T1": 9.5, "T2": 15.1, "T3": 22.5, "T4": 28.0}
    for (c, L, a1, a2, _, _), (_, _, b1, b2, n, 총) in zip(옛줄, 새줄):
        print(f"  {c}   | {L:5.1f} ({도면[c]:.1f}) | {a1:5.2f} → {b1:5.2f} | "
              f"{a2:5.2f} → {b2:5.2f} | {n:5d}/{총}")
