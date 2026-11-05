"""영상 3 — 함 속 그림자극 「그날 밤」. 컷 시각 = naju01/src/puzzles/ridge/shadowPlay.ts 의 CUT.
1024×576 · 30fps · 12.4초. 본편(무음) + 확인용(게임 효과음을 audio.ts 값으로 흉내 내 얹음).
"""
import os, subprocess

W = os.path.dirname(os.path.abspath(__file__))
C, O = f"{W}/cuts", f"{W}/out"
os.makedirs(O, exist_ok=True)
FPS, WID, HEI = 30, 1024, 576
TOTAL = 12.4
CUT = [0, 1.7, 3.7, 4.25, 4.95, 5.75, 7.0, 7.75, 8.7, TOTAL]
# 컷별: (원본 시작초, 재생 속도) — 원본 4초 클립에서 쓸 구간. 속도 2 = 두 배 빠르게
SRC = {1: (0.4, 1.0), 2: (0.9, 1.0), 3: (0.0, 1.6), 4: (0.2, 1.6), 5: (0.3, 1.6),
       6: (1.0, 1.0), 7: (0.6, 1.6), 8: (0.2, 1.3), 9: (0.3, 1.0)}
DARK_AT = {2, 4, 5, 7}          # 컷 시작에 한 장 어둡게(0.06초) — 코드: edge·hands·fall·flee
WHITE_AT = {8}                  # 물보라 첫 0.12초 하얀 섬광 — 코드: impact
CUES = [(3.0, "rumble"), (3.7, "gong"), (7.75, "splash")]   # SHADOW_PLAY_CUES

def run(*a): subprocess.check_call(["ffmpeg", "-nostdin", "-v", "error", "-y", *a])

parts = []
for k in range(1, 10):
    L = CUT[k] - CUT[k - 1]
    s0, sp = SRC[k]
    vf = (f"trim=start={s0},setpts=(PTS-STARTPTS)/{sp},fps={FPS},scale={WID}:{HEI}:flags=lanczos,"
          f"tpad=stop_mode=clone:stop_duration=2,trim=duration={L:.3f},setpts=PTS-STARTPTS")
    if k in DARK_AT: vf += ",fade=t=in:st=0:d=0.06:color=black"
    if k in WHITE_AT: vf += ",fade=t=in:st=0:d=0.12:color=white"
    out = f"{O}/c{k}.mp4"
    run("-i", f"{C}/{k}.mp4", "-vf", vf, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-r", str(FPS), out)
    parts.append(out)

open(f"{O}/list.txt", "w").write("".join(f"file '{p}'\n" for p in parts))
run("-f", "concat", "-safe", "0", "-i", f"{O}/list.txt", "-c", "copy", f"{O}/raw.mp4")

# 필름 처리 — 코드와 같은 순서: 색(그늘 푸르게·빛 호박빛) → 입자 → 비네트 → 처음 0.6초 밝아짐 → 위아래 띠 8%
bar = int(HEI * 0.08)
look = ("colorbalance=rs=-0.06:gs=-0.02:bs=0.10:rm=0.07:gm=0.02:bm=-0.05:rh=0.04:bh=-0.04,"
        "eq=contrast=1.06:saturation=1.05,noise=alls=9:allf=t,vignette=angle=PI/4.2,"
        f"fade=t=in:st=0:d=0.6,drawbox=x=0:y=0:w=iw:h={bar}:color=0x030202:t=fill,"
        f"drawbox=x=0:y=ih-{bar}:w=iw:h={bar}:color=0x030202:t=fill,format=yuv420p")
run("-i", f"{O}/raw.mp4", "-vf", look, "-t", str(TOTAL), "-c:v", "libx264", "-preset", "slow", "-crf", "16",
    "-r", str(FPS), "-movflags", "+faststart", f"{O}/shadow_play.mp4")

# 확인용 효과음 — audio.ts 값을 ffmpeg 로 흉내(게임에서는 게임이 직접 합성)
sfx = {
    # 징: 92Hz 배음 5개(감쇠 5·4·3.5·3·2.5초) + 낮은 잡음 0.25초
    "gong": ("aevalsrc='0.22*sin(2*PI*92*t)*exp(-9.2*t/5)+0.12*sin(2*PI*135.2*t)*exp(-9.2*t/4)"
             "+0.08*sin(2*PI*192.3*t)*exp(-9.2*t/3.5)+0.05*sin(2*PI*235.5*t)*exp(-9.2*t/3)"
             "+0.03*sin(2*PI*286.1*t)*exp(-9.2*t/2.5)':s=48000:d=5"),
    # 첨벙: 대역 잡음 0.22초 + 320→140Hz 짧은 음
    "splash": ("anoisesrc=d=0.3:c=white:a=0.6,bandpass=f=1100:w=900,afade=t=out:st=0.05:d=0.2[n];"
               "aevalsrc='0.08*sin(2*PI*(320*t-750*t*t))*exp(-25*t)':s=48000:d=0.3[t];[n][t]amix=2:normalize=0"),
    # 우르릉: 갈색 잡음 저역 160Hz 3.2초 + 0.5초 뒤 110Hz 2.4초
    "rumble": ("anoisesrc=d=3.4:c=brown:a=0.9,lowpass=f=160,lowpass=f=160,afade=t=in:d=0.8,afade=t=out:st=1.2:d=2.0[a];"
               "anoisesrc=d=2.6:c=brown:a=0.6,lowpass=f=110,afade=t=in:d=0.6,afade=t=out:st=0.8:d=1.6,adelay=500|500[b];"
               "[a][b]amix=2:normalize=0"),
}
for name, graph in sfx.items():
    run("-filter_complex", graph + ",aresample=48000,aformat=channel_layouts=stereo", f"{O}/{name}.wav")
inp = ["-i", f"{O}/shadow_play.mp4"]
fc = f"anullsrc=r=48000:cl=stereo,atrim=0:{TOTAL}[base];"
mix = ["[base]"]
for i, (at, name) in enumerate(CUES):
    inp += ["-i", f"{O}/{name}.wav"]; ms = int(at * 1000)
    fc += f"[{i+1}:a]adelay={ms}|{ms},apad,atrim=0:{TOTAL}[s{i}];"; mix.append(f"[s{i}]")
fc += f"{''.join(mix)}amix={len(mix)}:normalize=0,loudnorm=I=-18:TP=-1.5[a]"
run(*inp, "-filter_complex", fc, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-t", str(TOTAL), f"{O}/shadow_play_preview_sfx.mp4")
print("ok")
