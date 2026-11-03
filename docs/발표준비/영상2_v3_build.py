"""영상 2 v3 『왜곡의 퍼즐 만들기』 — 새 대본(시험 문제 비유), 공장 화면 + 역할 이름표, 효과음은 Veo 생성음(작게) 편집: 컷 + 내레이션 + 끊어 넘기는 자막."""
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
 0: "방탈출 하나를 사람이 만들려면, / 퍼즐 수십 개를 / 하나하나 전부 짜야 합니다.",
 1: "심지어 스토리가 바뀔 때마다 / 매번 처음부터 다시 하고 / 한 편에 몇 달이 걸리죠.",
 2: "그렇다면 AI한테 맡기면 어떨까요? / 몇 초 만에 / 그럴듯한 퍼즐이 나옵니다.",
 3: "그런데 그게 정말 풀리는지는, / 아무도 장담하지 못하죠.",
 4: "열쇠가 자기 상자 안에 잠겨 있기도 하고, / 게임에 없는 행동을 시키기도 하고, / 없는 이야기를 지어내기도 합니다.",
 5: "그래서 『왜곡』은 / 시험 문제를 만드는 방식에서 / 답을 찾았습니다.",
 6: "무엇을 물어볼지는 선생님이 정하고, / 문제는 출제자가 내고, / 정말 풀리는지는 / 검토자가 직접 풀어 봅니다.",
 7: "『왜곡』에서 선생님은 사람입니다. / 플레이어가 꼭 알아내야 할 것과 / 퍼즐 개수를 먼저 정하죠.",
 8: "출제자는 AI, 설계 에이전트입니다. / 사건 줄거리와 게임 공간, 옛이야기를 읽고 / 퍼즐을 짭니다.",
 9: "단, 게임에 이미 있는 행동만 쓸 수 있어요. / 살펴보고, 이동하고, / 입력하고, 단서를 합치는 것까지.",
 10: "퍼즐마다 정답과 힌트, / 그리고 어느 옛 문헌에서 왔는지 / 출처를 꼭 적어야 하고, / 출처가 비면 바로 돌려보냅니다.",
 11: "이제 가장 중요한 단계, 검토입니다. / 채점은 AI에게 맡기지 않습니다.",
 12: "검토자는 / 정해진 규칙대로 움직이는 프로그램입니다. / 퍼즐을 처음부터 끝까지 / 직접 따라가 보죠.",
 13: "끝까지 갈 수 있는지, / 중간에 길이 막히지는 않는지, / 서로가 서로를 잠그고 있지는 않은지.",
 14: "같은 퍼즐을 넣으면 / 언제나 같은 결과가 나오고, / AI가 그 결과를 바꿀 수도 없습니다.",
 15: "걸리면 어디가 왜 틀렸는지 / 적힌 쪽지가 돌아오고, / 두 번째 AI인 수정 에이전트가 / 딱 그 부분만 고칩니다.",
 16: "세 번 안에 못 고치면 / 구조부터 잘못된 것으로 보고 / 사람에게 넘기고, / 모든 과정은 기록으로 남습니다.",
 17: "마지막으로 사람이 확인하고 승인한 퍼즐만 / 게임에 들어갑니다. / 정답은 서버에만 두고, / 채점도 서버가 하죠.",
 18: "AI는 빠르게 만들고, / 프로그램은 꼼꼼하게 확인하고, / 사람은 끝까지 책임집니다.",
 19: "『왜곡』의 퍼즐 만들기. / 풀리지 않는 퍼즐은, / 게임에 들어가지 않습니다.",
}
SEG = [(f"{i:02d}", [i]) for i in range(20)]
TITLE = "19"
# 역할 이름표 (화면 왼쪽 위) — 컷 단위
LABEL = {"07": "선생님 = 사람", "08": "출제자 = 설계 에이전트 (AI)", "09": "출제자 = 설계 에이전트 (AI)",
         "10": "출제자 = 설계 에이전트 (AI)", "11": "검토자 = 검사 프로그램", "12": "검토자 = 검사 프로그램",
         "13": "검토자 = 검사 프로그램", "14": "검토자 = 검사 프로그램", "15": "수정 에이전트 (AI)",
         "16": "모든 과정은 기록으로", "17": "최종 승인 = 사람"}
LEAD, GAP, TAIL = 0.15, 0.2, 0.2
SFX = 0.4          # 컷 효과음(Veo 생성음) — 컷마다 -24 LUFS 로 맞춘 뒤 -8dB (약 -32 LUFS, 내레이션보다 훨씬 작게)
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
              f"apad,atrim=duration={L:.3f},loudnorm=I=-24:TP=-6:LRA=7,aresample=48000,volume={SFX}[s]")
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
Style: Label,Noto Sans KR,58,&H00FFFFFF,&H00FFFFFF,&H50101010,&H64000000,-1,0,0,0,100,100,0,0,3,16,0,7,70,70,60,1
Style: Default,Noto Sans KR,{FONT},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4.5,2,2,120,120,70,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
for s, e, tx in events:
    ass += f"Dialogue: 0,{ts(s)},{ts(e)},Default,,0,0,0,,{tx}\n"
seg_end = {c: seg_start.get(f"{int(c)+1:02d}", t0) for c in seg_start}
for c, lab in LABEL.items():
    ass += f"Dialogue: 1,{ts(seg_start[c]+0.1)},{ts(seg_end[c]-0.05)},Label,,0,0,0,,{lab}\n"
# 6번 줄(전체 부감): 역할 셋을 대사에 맞춰 하나씩 쌓아 보여 준다
ev6 = [e for e in events if seg_start["06"] <= e[0] < seg_end["06"]]
stack = ["선생님 = 사람", "출제자 = 설계 에이전트 (AI)", "검토자 = 검사 프로그램"]
starts = [ev6[0][0], ev6[1][0], ev6[2][0]] if len(ev6) >= 3 else [seg_start["06"]]*3
for k in range(3):
    txt = "\\N".join(stack[:k+1])
    end = starts[k+1] if k < 2 else seg_end["06"] - 0.05
    ass += f"Dialogue: 1,{ts(starts[k])},{ts(end)},Label,,0,0,0,,{txt}\n"
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
    "-c:a","aac","-b:a","192k","-ar","48000","-movflags","+faststart",f"{O}/waegok_video2_v3.mp4"])
print("total", dur(f"{O}/waegok_video2_v3.mp4")); raise SystemExit
subprocess.check_call(["ffmpeg","-v","error","-y","-i",f"{O}/clean.mp4","-vf",f"ass={O}/subs.ass",
    "-af","loudnorm=I=-16:TP=-1.5:LRA=11","-c:v","libx264","-preset","slow","-crf","22","-pix_fmt","yuv420p",
    "-c:a","aac","-b:a","192k","-ar","48000","-movflags","+faststart",f"{O}/waegok_video2_v3.mp4"])
print("total", dur(f"{O}/waegok_video2_v3.mp4"))
