#!/bin/bash
# 번역 모델 비교 준비·실행(맥북) — 전용 가상환경 ~/.venvs/kgeseo-mt(mflux 환경은 건드리지 않음)
set -e
ROOT="$1"; VENV="$HOME/.venvs/kgeseo-mt"
PY=$(ls -d "$HOME"/.local/share/uv/python/cpython-3.12*-macos-aarch64-none/bin/python3 2>/dev/null | head -1); [ -x "$PY" ] || PY=python3
echo "python: $PY"
[ -x "$VENV/bin/python" ] || "$PY" -m venv "$VENV"
"$VENV/bin/python" -m pip install -q -U pip
"$VENV/bin/python" -m pip install -q mlx-lm transformers torch sentencepiece sacremoses
"$VENV/bin/python" -c "import mlx_lm, transformers, torch; print('mlx_lm', mlx_lm.__version__, 'transformers', transformers.__version__, 'torch', torch.__version__)"
"$VENV/bin/python" "$ROOT/tools/mt/bench.py" "$ROOT"
