"""영상 1 『왜곡은 왜 만들어졌나』 편집: 컷 + 내레이션 + 끊어 넘기는 자막."""
import os, re, subprocess, sys

W = os.path.dirname(os.path.abspath(__file__))
V, A, O = f"{W}/cuts", f"{W}/vo", f"{W}/out"
os.makedirs(O, exist_ok=True)

# 자막 덩어리 — " / " 위치에서 끊어 차례로 넘긴다
TXT = {
 0: "여기, 멘탈이 완전히 나가 버린 / 지역 홍보 담당자가 있습니다.",
 1: "아무리 지역을 / 예쁘게 꾸며도, / 도통 사람이 오지 않았거든요.",
 2: "꽃길도 만들고, / 벽화도 그리고, / 포토존에 마스코트까지, / SNS 광고도 돌려 봤죠.",
 3: "결과는… / 네, 아시죠?",
 4: "그러던 어느 주말, / 그는 이상한 걸 봅니다.",
 5: "젊은 사람들이 돈을 내고, / 줄을 서고, / 갇히러 들어가는 거예요.",
 6: "그때 깨달았습니다. / 이 사람들은 지역이 싫은 게 아니었어요. / 갈 이유가 없었을 뿐이었죠.",
 7: "그래서 고민했습니다. / 방탈출과 우리 지역을 / 어떻게 엮지?",
 8: "그러다 영산강 절벽에 얽힌, / 몇백 년 된 설화를 만나게 됩니다.",
 9: "오래도록 전해졌지만, / 끝내 풀리지 않은 물음이 남은 / 이야기였죠.",
 10: "이 이야기를 / 하나의 사건으로 만들면 어떨까? / 여기서부터 시작되었습니다.",
 11: "그렇게 만들어진 게, / 나주의 옛이야기로 만든 / 3D 방탈출 『왜곡』입니다.",
 12: "웹에서 바로, / 단서를 모으고 / 퍼즐을 풀며 / 사건의 진실을 쫓아가죠.",
 13: "퍼즐은 AI가 만들고, / 정말 풀리는 퍼즐인지까지 검사합니다.",
 14: "이야기는 온라인에서 / 거의 끝까지 풀 수 있어요. / 그런데 딱 하나, / 끝까지 답을 주지 않는 질문이 남습니다.",
 15: "그 답은, / 나주에 가야만 들을 수 있습니다.",
 16: "현장에 서야만 열리는 / 마지막 단서를 찾아서요.",
 17: "갈 이유가 없던 곳이, / 꼭 가 봐야 하는 곳이 됐습니다.",
 18: "홍보 담당자요? / 이제 멘탈, 돌아왔습니다.",
 19: "지역 설화 방탈출, 『왜곡』. / 진실은, 현장에 있습니다.",
}
SEG = [("01",[0]),("02",[1]),("03",[2]),("03b",[3]),("04",[4,5]),("05",[6]),("06",[7]),("06b",[8]),
       ("06c",[9]),("07",[10]),("08",[11]),("08b",[12]),("09",[13]),("10",[14]),("11",[15]),("11b",[16]),
       ("12",[17]),("13",[18]),("14",[19])]
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

events = []; t0 = 0.0; parts = []
for k, (clip, lines) in enumerate(SEG):
    cf = f"{V}/{clip}.mp4"; cd = dur(cf); vd = [dur(voice(i)) for i in lines]
    L = LEAD + sum(vd) + GAP * (len(lines) - 1) + TAIL
    if k == 0: L += 0.15
    if clip == "14": L += 1.0
    if clip == "14": f = 1.0
    elif cd > L: f = max(L / cd, 1 / 1.5)
    else: f = min(L / cd, 1.35)
    pad = max(0.0, L - cd * f); cut = max(0.0, cd * f - L)
    if clip == "14": cut = 0.0   # 타이틀은 앞의 쿵 소리를 살리고 뒤를 자른다
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
subprocess.check_call(["ffmpeg","-v","error","-y","-i",f"{O}/clean.mp4","-vf",f"ass={O}/subs.ass",
    "-af","loudnorm=I=-16:TP=-1.5:LRA=11","-c:v","libx264","-preset","medium","-crf","19","-pix_fmt","yuv420p",
    "-c:a","aac","-b:a","192k","-ar","48000","-movflags","+faststart",f"{O}/waegok_video1.mp4"])
print("total", dur(f"{O}/waegok_video1.mp4"))
