# 한영 번역 모델 비교(10/28 미르: 「알아서 테스트해보고 성능 보고 — 더 나은 것만 남기자」)
#   맥북에서만 돈다(검수 서버가 실행). 결과: .local/mt/bench_result.json
#   후보: Opus-MT(ko-en + tc-big-en-ko, transformers) · Hy-MT2-7B(MLX 4bit 변환)
import json, os, sys, time, resource, traceback
ROOT = sys.argv[1]; OUT = os.path.join(ROOT, '.local/mt'); os.makedirs(OUT, exist_ok=True)
cases = json.load(open(os.path.join(ROOT, 'tools/mt/bench_cases.json')))
res = {'started': time.strftime('%Y-%m-%dT%H:%M:%S'), 'models': {}}
def save(): json.dump(res, open(os.path.join(OUT, 'bench_result.json'), 'w'), ensure_ascii=False, indent=1)
def rss_gb(): return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9, 2)  # macOS: bytes

def run(name, en2ko, ko2en, load_s, extra=None):
    r = {'load_s': load_s, 'en2ko': [], 'roundtrip': [], 'edits': [], **(extra or {})}
    for c in cases['en']:
        t = time.time(); ko = en2ko(c['en']); t1 = time.time(); back = ko2en(ko); t2 = time.time()
        r['en2ko'].append({'id': c['id'], 'en': c['en'], 'ko': ko, 's': round(t1 - t, 2)})
        r['roundtrip'].append({'id': c['id'], 'back': back, 's': round(t2 - t1, 2)})
        res['models'][name] = r; save()
    for e in cases['edits']:
        t = time.time(); en = ko2en(e['ko']); r['edits'].append({**e, 'en': en, 's': round(time.time() - t, 2)})
    r['peak_rss_gb'] = rss_gb(); res['models'][name] = r; save()

# ── Opus-MT ──
try:
    import torch
    from transformers import MarianMTModel, MarianTokenizer
    dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
    t = time.time()
    tk_ke = MarianTokenizer.from_pretrained('Helsinki-NLP/opus-mt-ko-en'); m_ke = MarianMTModel.from_pretrained('Helsinki-NLP/opus-mt-ko-en').to(dev).eval()
    tk_ek = MarianTokenizer.from_pretrained('Helsinki-NLP/opus-mt-tc-big-en-ko'); m_ek = MarianMTModel.from_pretrained('Helsinki-NLP/opus-mt-tc-big-en-ko').to(dev).eval()
    load = round(time.time() - t, 1)
    def tr(tk, m, s, prefix=''):
        with torch.no_grad():
            b = tk([prefix + s], return_tensors='pt', truncation=True).to(dev)
            o = m.generate(**b, num_beams=4, max_new_tokens=256)
        return tk.decode(o[0], skip_special_tokens=True)
    pre = '>>kor<< ' if any('>>kor<<' in x for x in getattr(tk_ek, 'supported_language_codes', []) or []) else ''
    run('opus-mt', lambda s: tr(tk_ek, m_ek, s, pre), lambda s: tr(tk_ke, m_ke, s), load, {'device': dev, 'prefix': pre})
    del m_ke, m_ek
except Exception as e:
    res['models']['opus-mt'] = {'error': traceback.format_exc()[-1500:]}; save()

# ── Hy-MT2-7B (MLX 4bit) ──
try:
    import mlx.core as mx
    from mlx_lm import load, generate, convert
    q = os.path.expanduser('~/.cache/kgeseo-mt/Hy-MT2-7B-4bit')
    t = time.time()
    if not os.path.exists(os.path.join(q, 'config.json')):
        convert(hf_path='mlx-community/Hy-MT2-7B', mlx_path=q, quantize=True, q_bits=4)
    conv = round(time.time() - t, 1); t = time.time()
    model, tok = load(q); load_s = round(time.time() - t, 1)
    def hy(s, lang):
        msg = [{'role': 'user', 'content': f'Translate the following text into {lang}. Output only the translated result, with no additional explanation.\n\n{s}'}]
        p = tok.apply_chat_template(msg, add_generation_prompt=True, tokenize=False)
        return generate(model, tok, prompt=p, max_tokens=400, verbose=False).strip()
    run('hy-mt2-7b-4bit', lambda s: hy(s, 'Korean'), lambda s: hy(s, 'English'), load_s, {'convert_s': conv})
    res['models']['hy-mt2-7b-4bit']['mlx_peak_gb'] = round(mx.get_peak_memory() / 1e9, 2); save()
except Exception as e:
    res['models']['hy-mt2-7b-4bit'] = {'error': traceback.format_exc()[-1500:]}; save()
res['finished'] = time.strftime('%Y-%m-%dT%H:%M:%S'); save()
print('BENCH DONE')
