"""앙암바위 스테이지 사이 영상 공통 편집 — 대사 없음, 그림자극 필름 처리.
사용: python3 build.py v1   (angam/cuts/v1/1.mp4 … 와 아래 PLAN 을 읽음)
출력: angam/out/<v>_무음.mp4, ambience 가 있으면 <v>_앰비언스.mp4
"""
import os, sys, subprocess, json

W = os.path.dirname(os.path.abspath(__file__))
V = sys.argv[1]
C, O = f"{W}/cuts/{V}", f"{W}/out"
os.makedirs(C, exist_ok=True)
os.makedirs(O, exist_ok=True)
FPS, WID, HEI = 30, 1280, 720
PLAN = json.load(open(f"{W}/plan_{V}.json"))
# PLAN: {"cuts":[{"len":5,"src":0.0,"push":[1,1.04],"xf":0.5,"dark":false}, ...], "ambience": "path or null"}
cuts = PLAN["cuts"]

def run(*a): subprocess.check_call(["ffmpeg", "-nostdin", "-v", "error", "-y", *a])

starts = [0.0]
for c in cuts[:-1]:
    starts.append(starts[-1] + c["len"])
TOTAL = starts[-1] + cuts[-1]["len"]

segs = []
for k, c in enumerate(cuts, 1):
    xf = c.get("xf", 0.04) if k < len(cuts) else 0
    L = c["len"] + xf
    n = int(round(L * FPS))
    z0, z1 = c.get("push", [1.0, 1.0])
    sp = c.get("speed", 1.0)
    vf = (f"trim=start={c.get('src', 0)},setpts=(PTS-STARTPTS)/{sp},fps={FPS},scale={WID}:{HEI}:flags=lanczos,"
          f"tpad=stop_mode=clone:stop_duration=3,trim=duration={L:.3f},setpts=PTS-STARTPTS")
    if z1 != z0:
        vf += (f",scale={WID*2}:{HEI*2}:flags=lanczos,zoompan=z='{z0}+({z1}-{z0})*on/{n}':d=1:"
               f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={WID}x{HEI}:fps={FPS}")
    if c.get("dark"): vf += ",fade=t=in:st=0:d=0.08:color=black"
    if c.get("fadein"): vf += f",fade=t=in:st=0:d={c['fadein']}:color=black"
    out = f"{O}/{V}_c{k}.mp4"
    run("-i", c.get("file", f"{C}/{k}.mp4"), "-vf", vf + ",format=yuv420p", "-an", "-c:v", "libx264", "-preset", "medium",
        "-crf", "15", "-r", str(FPS), "-t", f"{L:.3f}", out)
    segs.append(out)

inp = []
for s in segs: inp += ["-i", s]
fc, prev = "", "[0:v]"
for k in range(1, len(cuts)):
    lab = f"[x{k}]"
    fc += f"{prev}[{k}:v]xfade=transition=fade:duration={cuts[k-1].get('xf', 0.04)}:offset={starts[k]:.3f}{lab};"
    prev = lab
run(*inp, "-filter_complex", fc.rstrip(";"), "-map", prev, "-c:v", "libx264", "-preset", "medium", "-crf", "15",
    "-r", str(FPS), "-t", f"{TOTAL:.3f}", f"{O}/{V}_raw.mp4")

bar = int(HEI * 0.08)
look = ("colorbalance=rs=-0.06:gs=-0.02:bs=0.10:rm=0.07:gm=0.02:bm=-0.05:rh=0.04:bh=-0.04,"
        "eq=contrast=1.06:saturation=1.05,noise=alls=5:allf=t,vignette=angle=PI/4.2,"
        f"fade=t=in:st=0:d=0.4,fade=t=out:st={TOTAL-0.6:.3f}:d=0.6,"
        f"drawbox=x=0:y=0:w=iw:h={bar}:color=0x030202:t=fill,"
        f"drawbox=x=0:y=ih-{bar}:w=iw:h={bar}:color=0x030202:t=fill,format=yuv420p")
silent = f"{O}/{V}_무음.mp4"
run("-i", f"{O}/{V}_raw.mp4", "-vf", look, "-t", f"{TOTAL:.3f}", "-c:v", "libx264", "-preset", "slow", "-crf", "23",
    "-r", str(FPS), "-movflags", "+faststart", silent)

amb = PLAN.get("ambience")
if amb and os.path.exists(amb):
    run("-i", silent, "-stream_loop", "-1", "-i", amb, "-filter_complex",
        f"[1:a]atrim=0:{TOTAL:.3f},afade=t=in:d=1.5,afade=t=out:st={TOTAL-2:.3f}:d=2,"
        "loudnorm=I=-24:TP=-6,aformat=channel_layouts=stereo[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", f"{TOTAL:.3f}",
        f"{O}/{V}_앰비언스.mp4")
print("ok", V, f"{TOTAL:.1f}s")
