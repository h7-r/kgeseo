# 한영 번역 서버(10/28) — Tencent Hy-MT2-7B(Apache-2.0) MLX 4bit, 맥북 로컬·무료
#   검수 서버가 필요할 때 띄운다. POST /translate {"text": "...", "to": "ko"|"en"} → {"text": "..."} · GET /health
#   비교 시험(tools/mt/bench.py, 10/28)에서 Opus-MT 보다 낫다고 판단해 이것만 남김
import json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from mlx_lm import load, generate
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8093
MODEL = os.path.expanduser('~/.cache/kgeseo-mt/Hy-MT2-7B-4bit')
model, tok = load(MODEL)  # MLX 는 불러온 스레드에서만 돈다 → 요청을 한 스레드(HTTPServer)에서 차례로
LANG = {'ko': 'Korean', 'en': 'English'}
GLOSS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'glossary.json')))['terms']
def terms_for(text, to):
    # 한→영: 한글 낱말이 들어 있으면, 영→한: 영어 낱말이 들어 있으면 그 짝을 참고로 준다(긴 말 먼저)
    out = []
    for ko, en, *d in sorted(GLOSS, key=lambda x: -len(x[0])):
        if d and d[0] != ('to_en' if to == 'en' else 'to_ko'): continue
        src, tgt = (ko, en) if to == 'en' else (en, ko)
        if (src in text if to == 'en' else src.lower() in text.lower()) and not any(src in s for s, _ in out): out.append((src, tgt))
    return out
def tr(text, to):
    t = terms_for(text, to)
    ref = ('Refer to the following translations:\n' + '\n'.join(f'{a} translates to {b}' for a, b in t) + '\n\n') if t else ''
    msg = [{'role': 'user', 'content': f'{ref}Translate the following text into {LANG[to]}. Output only the translated result, with no additional explanation.\n\n{text}'}]
    p = tok.apply_chat_template(msg, add_generation_prompt=True, tokenize=False)
    return generate(model, tok, prompt=p, max_tokens=400, verbose=False).strip()
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        self._send(200, {'ok': True, 'model': 'Hy-MT2-7B-4bit'}) if self.path == '/health' else self._send(404, {'error': 'not_found'})
    def do_POST(self):
        if self.path != '/translate': return self._send(404, {'error': 'not_found'})
        try:
            d = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}'); to = d.get('to'); text = str(d.get('text') or '')[:2000]
            if to not in LANG or not text.strip(): return self._send(400, {'error': 'bad_request'})
            self._send(200, {'text': tr(text, to)})
        except Exception as e: self._send(500, {'error': str(e)[:300]})
HTTPServer(('127.0.0.1', PORT), H).serve_forever()
