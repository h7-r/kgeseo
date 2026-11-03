"""영상 2 v2 『왜곡 퍼즐 공장』 — 공장 컨셉, 효과음은 ElevenLabs 로 통일 편집: 컷 + 내레이션 + 끊어 넘기는 자막."""
import os, re, subprocess, sys

W = os.path.dirname(os.path.abspath(__file__))
V, O = f"{W}/cuts", f"{W}/out"
os.makedirs(O, exist_ok=True)
TEMPO = float(os.environ.get("TEMPO", "1.0"))   # 내레이션 속도 (1.1 = 10% 빠르게, 목소리 톤 유지)
A = f"{W}/vo_x{TEMPO}"
os.makedirs(A, exist_ok=True)
for fn in sorted(os.listdir(f"{W}/vo")):
    if fn.endswith(".mp3") and not os.path.exists(f"{A}/{fn}"):
        af = [] if TEMPO == 1.0 else ["-af", f"rubberband=tempo={TEMPO}:pitchq=quality:formant=preserved"]
        subprocess.check_call(["ffmpeg","-v","error","-y","-i",f"{W}/vo/{fn}",*af,"-b:a","192k",f"{A}/{fn}"])

# 자막 덩어리 — " / " 위치에서 끊어 차례로 넘긴다
TXT = {
 0: "방탈출 하나를 만들려면, / 퍼즐을 수십 개 짜야 합니다.",
 1: "설화가 바뀔 때마다, / 매번 처음부터요.",
 2: "사람이 전부 짜면, / 몇 달이 걸리죠.",
 3: "그럼 AI한테 맡기면? / 빠르긴 한데요.",
 4: "가끔, / 절대 풀 수 없는 퍼즐을 / 만들어 버립니다.",
 5: "그래서 『왜곡』은, / 일을 나눴습니다.",
 6: "먼저, 플레이어가 / 무엇을 알아내야 하는지는 / 사람이 정합니다. / 퍼즐 개수까지요.",
 7: "그다음은 / 퍼즐 설계 에이전트 차례. / 사건 줄거리, 게임 공간, / 옛이야기 원문을 함께 읽고,",
 8: "도구 여섯 가지를 / 스스로 골라 쓰며, / 무엇을 먼저 풀어야 / 다음 문이 열리는지 / 퍼즐 흐름을 짭니다.",
 9: "단서마다 / 어느 문헌, 어느 대목에서 왔는지 / 출처도 꼭 붙이고요.",
 10: "그런데, / 채점은 AI에게 맡기지 않습니다.",
 11: "검사는 정해진 코드가 합니다. / 끝까지 갈 수 있는지, / 중간에 막히진 않는지, / 열쇠가 서로를 잠그고 있진 않은지. / 모두 열여섯 가지를요.",
 12: "같은 퍼즐엔 언제나 같은 답. / AI가 결과를 바꿀 수도 없죠.",
 13: "검사에 걸리면? / 수정 에이전트가 / 문제가 된 부분만 고쳐서 다시 냅니다. / 최대 세 번까지요.",
 14: "이 모든 과정은 기록으로 남아서, / 어디서 무엇이 틀렸는지 / 되짚을 수 있고요.",
 15: "마지막 승인은, / 다시 사람이 합니다.",
 16: "AI는 빠르게 만들고, / 코드는 꼼꼼하게 검사하고, / 사람은 방향을 잡습니다.",
 17: "그래서 『왜곡』에는, / 풀리지 않는 퍼즐이 들어가지 않습니다.",
 18: "『왜곡』 퍼즐 제작 공정. / 설화가 바뀌어도, / 퍼즐은 반드시 풀립니다.",
}
SEG = [(f"{i:02d}", [i]) for i in range(19)]
TITLE = "18"
LEAD, GAP, TAIL = 0.15, 0.2, 0.2
SFX = 0.5          # 컷 효과음 볼륨 (기존 0.28)
FONT = 73          # 자막 크기 (기존 56 의 1.3배)

def dur(f):
    return float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",f]).decode())
def voice(i): return f"{A}/{i:02d}.mp3"

def silences(f, db=-40, d=0.1):
    log = subprocess.run(["ffmpeg","-i",f,"-af",f"silencedetect=n={db}dB:d={d}","-f","null","-"],
                         capture_output=True, text=True).stderr
    st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    return list(zip(st, en + [dur(f)] * (len(st) - len(en))))

def nchar(s): return len(re.sub(r"[\s,.?!…·『』]", "", s))

def chunk_times(i):
    """대사 i 의 자막 덩어리별 (시작, 끝) — 음성 파일 기준 초."""
    f = voice(i); D = dur(f); sil = silences(f)
    s0, s1 = 0.0, D
    for a, b in sil:
        if a <= 0.02: s0 = b
        if b >= D - 0.02: s1 = a
    pauses = [((a + b) / 2) for a, b in sil if a > s0 + 0.05 and b < s1 - 0.05]
    parts = [p.strip() for p in TXT[i].split("/")]
    w = [nchar(p) for p in parts]; tot = sum(w)
    bounds, acc = [], 0
    for k in range(len(parts) - 1):
        acc += w[k]
        t = s0 + (s1 - s0) * acc / tot
        near = [p for p in pauses if abs(p - t) < 0.5]
        if near: t = min(near, key=lambda p: abs(p - t))
        bounds.append(t)
    edges = [s0] + bounds + [s1]
    return [(edges[k], edges[k + 1], parts[k]) for k in range(len(parts))]

events = []; t0 = 0.0; parts = []; seg_start = {}
for k, (clip, lines) in enumerate(SEG):
    seg_start[clip] = t0
    cf = f"{V}/{clip}.mp4"; cd = dur(cf); vd = [dur(voice(i)) for i in lines]
    L = LEAD + sum(vd) + GAP * (len(lines) - 1) + TAIL
    if k == 0: L += 0.15
    if clip == TITLE: L += 1.0
    if clip == TITLE: f = 1.0
    elif cd > L: f = max(L / cd, 1 / 1.5)
    else: f = min(L / cd, 1.35)
    pad = max(0.0, L - cd * f); cut = max(0.0, cd * f - L)
    if clip == TITLE: cut = 0.0   # 타이틀은 앞의 쿵 소리를 살리고 뒤를 자른다
    vf = (f"setpts={f}*PTS,trim=start={cut:.3f},setpts=PTS-STARTPTS,"
          f"tpad=stop_mode=clone:stop_duration={pad:.3f},trim=duration={L:.3f},"
          f"scale=1920:1080:flags=lanczos,fps=24,format=yuv420p")
    has_a = "audio" in subprocess.check_output(["ffprobe","-v","error","-show_entries","stream=codec_type","-of","csv=p=0",cf]).decode()
    if has_a:
        af = (f"[0:a]aresample=48000,atempo={1/f:.4f},atrim=start={cut:.3f},asetpts=PTS-STARTPTS,"
              f"apad,atrim=duration={L:.3f},volume={SFX}[s]")
    else:
        af = f"anullsrc=r=48000:cl=stereo,atrim=duration={L:.3f}[s]"
    inputs = ["-i", cf]; mix = ["[s]"]; t = LEAD + (0.15 if k == 0 else 0)
    for j, i in enumerate(lines):
        inputs += ["-i", voice(i)]; ms = int(t * 1000)
        af += (f";[{j+1}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay={ms}|{ms},"
               f"apad,atrim=duration={L:.3f}[v{j}]")
        mix.append(f"[v{j}]")
        for a, b, tx in chunk_times(i):
            events.append([t0 + t + a, t0 + t + b, tx])
        t += vd[j] + GAP
    af += f";{''.join(mix)}amix=inputs={len(mix)}:normalize=0:duration=first[a]"
    out = f"{O}/seg{k:02d}.mp4"
    subprocess.check_call(["ffmpeg","-v","error","-y",*inputs,"-filter_complex",f"[0:v]{vf}[vv];{af}",
        "-map","[vv]","-map","[a]","-c:v","libx264","-preset","medium","-crf","18",
        "-c:a","aac","-b:a","192k","-ar","48000","-t",f"{L:.3f}",out])
    parts.append(out); t0 += dur(out)
    print(f"{clip}: clip {cd:.2f}s -> {L:.2f}s (x{f:.2f}, cut {cut:.2f}, pad {pad:.2f})", flush=True)

# 자막이 끊기지 않게: 다음 덩어리까지 0.6초 이하로 비면 이어 붙인다
events.sort()
for a, b in zip(events, events[1:]):
    if 0 < b[0] - a[1] <= 0.6: a[1] = b[0]
    elif b[0] - a[1] > 0.6: a[1] += 0.15
events[-1][1] += 0.6

def ts(x): return f"{int(x//3600)}:{int(x%3600//60):02d}:{x%60:05.2f}"
ass = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans KR,{FONT},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4.5,2,2,120,120,70,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
for s, e, tx in events:
    ass += f"Dialogue: 0,{ts(s)},{ts(e)},Default,,0,0,0,,{tx}\n"
open(f"{O}/subs.ass", "w").write(ass)
open(f"{O}/list.txt", "w").write("".join(f"file '{p}'\n" for p in parts))
subprocess.check_call(["ffmpeg","-v","error","-y","-f","concat","-safe","0","-i",f"{O}/list.txt","-c","copy",f"{O}/clean.mp4"])
# ── 효과음: 작업실 배경음(0~4) → 공장 가동음 + 공장 기계음(5~17, 타이틀에서 페이드아웃) + 포인트 3종
X = f"{W}/sfx"; T = dur(f"{O}/clean.mp4"); s5 = seg_start["05"]; s18 = seg_start["18"]
def at(clip, frac): return seg_start[clip] + frac * (seg_start.get(f"{int(clip)+1:02d}", T) - seg_start[clip])
cues = [("power_b", s5, 0.55), ("ding_b", at("11", 0.85), 0.35), ("ding_b", at("12", 0.25), 0.22),
        ("ding_b", at("12", 0.55), 0.22), ("ding_b", at("12", 0.85), 0.22), ("buzz_a", at("13", 0.05), 0.30),
        ("stamp_a", at("15", 0.55), 0.70)]
inp = ["-i", f"{O}/clean.mp4",
       "-stream_loop","-1","-i", f"{X}/room_a.mp3",
       "-stream_loop","-1","-i", f"{X}/amb_b.mp3"]
fc = (f"[1:a]aresample=48000,volume=6.0,atrim=0:{s5+0.5:.3f},afade=t=out:st={s5-0.3:.3f}:d=0.8,apad=whole_dur={T:.3f}[room];"
      f"[2:a]aresample=48000,volume=0.32,atrim=0:{T-s5:.3f},afade=t=in:d=1.2,afade=t=out:st={s18-s5+0.3:.3f}:d=2.5,adelay={int(s5*1000)}|{int(s5*1000)},apad=whole_dur={T:.3f}[amb];")
mix = ["[0:a]", "[room]", "[amb]"]
NOSFX = os.environ.get("NOSFX", "1") == "1"   # 사용자 요청: 공장 효과음 전부 뺌 (내레이션만)
if NOSFX:
    inp = ["-i", f"{O}/clean.mp4"]; fc = ""; mix = ["[0:a]"]; cues = []
for k, (name, t, vol) in enumerate(cues):
    inp += ["-i", f"{X}/{name}.mp3"]; ms = int(t * 1000)
    fc += f"[{k+3}:a]aresample=48000,volume={vol},adelay={ms}|{ms},apad=whole_dur={T:.3f}[c{k}];"; mix.append(f"[c{k}]")
fc += (f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0:duration=first," if len(mix) > 1 else "[0:a]") + "loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
subprocess.check_call(["ffmpeg","-v","error","-y",*inp,"-filter_complex",fc+f";[0:v]ass={O}/subs.ass[vout]",
    "-map","[vout]","-map","[aout]","-c:v","libx264","-preset","slow","-crf","22","-pix_fmt","yuv420p",
    "-c:a","aac","-b:a","192k","-ar","48000","-movflags","+faststart",f"{O}/waegok_video2_factory.mp4"])
print("total", dur(f"{O}/waegok_video2_factory.mp4")); raise SystemExit
subprocess.check_call(["ffmpeg","-v","error","-y","-i",f"{O}/clean.mp4","-vf",f"ass={O}/subs.ass",
    "-af","loudnorm=I=-16:TP=-1.5:LRA=11","-c:v","libx264","-preset","slow","-crf","22","-pix_fmt","yuv420p",
    "-c:a","aac","-b:a","192k","-ar","48000","-movflags","+faststart",f"{O}/waegok_video2_factory.mp4"])
print("total", dur(f"{O}/waegok_video2_factory.mp4"))
