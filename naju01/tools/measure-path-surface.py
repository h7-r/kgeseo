# 노면이 매끄러운가 — 걷는 폭만 재고 기준 높이 파일과 견준다.
#   쓰는 법(저장소 뿌리에서): Blender --background --factory-startup --python naju01/tools/measure-path-surface.py -- <기준높이.bin> [다듬기 되풀이…]
#   build-terrain.py 를 읽어 main() 앞까지만 실행하고 build_heights·PATHS 를 쓴다.
import numpy as np, math, sys
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
old_path = args[0]
iteration_list = [int(v) for v in args[1:]] or [None]

source = open("naju01/tools/build-terrain.py", encoding="utf-8").read()
source = source[:source.rindex("main()")]
nx, nz, cell = 321, 201, 0.25
raw_heights = np.fromfile(old_path, dtype="<f4")
old = raw_heights[nx * nz:2 * nx * nz].reshape(nz, nx)

def sample(grid, x, z):
    u = np.clip(x / cell, 0, nx - 1.001); v = np.clip(z / cell, 0, nz - 1.001)
    i = u.astype(int); j = v.astype(int); fu = u - i; fv = v - j
    return (grid[j, i] * (1 - fu) + grid[j, i + 1] * fu) * (1 - fv) + \
           (grid[j + 1, i] * (1 - fu) + grid[j + 1, i + 1] * fu) * fv

def measure(grid, paths):
    lines = []
    for code, width, start, end, points in paths:
        half = width / 2
        cum = [0.0]
        for i in range(len(points) - 1):
            cum.append(cum[-1] + math.hypot(points[i+1][0]-points[i][0], points[i+1][1]-points[i][1]))
        total = cum[-1]; xs=[]; zs=[]; ramps=[]; ws=[]
        for i in range(len(points) - 1):
            (x1,z1),(x2,z2) = points[i], points[i+1]
            L = math.hypot(x2-x1, z2-z1)
            if L < 1e-9: continue
            n = max(2, int(L / 0.12)); ux,uz = (x2-x1)/L,(z2-z1)/L; px,pz = -uz,ux
            for k in range(n):
                t = k/n; cx = x1+(x2-x1)*t; cz = z1+(z2-z1)*t
                for w in np.linspace(-half, half, 11):
                    xs.append(cx+px*w); zs.append(cz+pz*w); ws.append(w)
                    ramps.append(start + (end-start) * ((cum[i]+L*t)/total))
        xs=np.array(xs); zs=np.array(zs); ramps=np.array(ramps); ws=np.array(ws)
        # 스위치백에서 반대쪽 다리 위에 떨어진 표본은 뺀다 — 중심선까지 최단거리가 |w| 일 때만 이 다리다.
        nearest = np.full(xs.shape, 1e9)
        for i in range(len(points) - 1):
            (ax,az),(bx,bz) = points[i], points[i+1]
            dx,dz = bx-ax, bz-az; L2 = dx*dx+dz*dz
            if L2 < 1e-12: continue
            t = np.clip(((xs-ax)*dx + (zs-az)*dz)/L2, 0, 1)
            nearest = np.minimum(nearest, np.hypot(xs-(ax+t*dx), zs-(az+t*dz)))
        mine = nearest >= np.abs(ws) - 0.05
        xs, zs, ramps = xs[mine], zs[mine], ramps[mine]
        y = sample(grid, xs, zs)
        lines.append((code, total, float(np.abs(np.diff(y)).max()), float(np.abs(y-ramps).max()),
                   int((np.abs(y-ramps) > 0.05).sum()), len(ramps)))
    return lines

for iters in iteration_list:
    namespace = {"__name__": "t"}
    # smooth_centerline 의 기본 되풀이 값만 바꿔 돌린다
    src = source if iters is None else source.replace("iterations=14", f"iterations={iters}")
    exec(compile(src, "t", "exec"), namespace)
    _, _, heights, _, _, _ = namespace["build_heights"]()
    old_lines = measure(old, namespace["PATHS"])
    new_lines = measure(heights, namespace["PATHS"])
    print(f"  ── 다듬기 되풀이 {iters if iters is not None else '(현재값)'} ──")
    print("  통로 | 길이(도면)   | 단차 옛→새   | 어긋남 옛→새 | 5cm 초과")
    plan = {"T1": 9.5, "T2": 15.1, "T3": 22.5, "T4": 28.0}
    for (c, L, a1, a2, _, _), (_, _, b1, b2, n, count) in zip(old_lines, new_lines):
        print(f"  {c}   | {L:5.1f} ({plan[c]:.1f}) | {a1:5.2f} → {b1:5.2f} | "
              f"{a2:5.2f} → {b2:5.2f} | {n:5d}/{count}")
