#!/bin/bash
# 10/28 비교 시험 뒤 정리 — Hy-MT2-7B 4bit(~/.cache/kgeseo-mt)만 남기고 Opus-MT 두 개와 변환 원본(bf16 15GB)을 지운다
HUB="$HOME/.cache/huggingface/hub"
for d in models--Helsinki-NLP--opus-mt-ko-en models--Helsinki-NLP--opus-mt-tc-big-en-ko models--mlx-community--Hy-MT2-7B; do
  if [ -d "$HUB/$d" ]; then du -sh "$HUB/$d"; rm -rf "$HUB/$d" && echo "removed $d"; fi
done
"$HOME/.venvs/kgeseo-mt/bin/python" -m pip uninstall -y -q torch sacremoses && echo "uninstalled torch sacremoses"
du -sh "$HOME/.cache/kgeseo-mt/Hy-MT2-7B-4bit"
for d in $(ls "$HUB" | grep -i -E "hy-mt|opus-mt"); do du -sh "$HUB/$d"; done; du -sh "$HOME"/.cache/huggingface/* 2>/dev/null
echo CLEANUP DONE
