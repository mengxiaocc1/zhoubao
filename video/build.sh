#!/usr/bin/env bash
# 一键生成样片：./build.sh a-weekly [b-robot c-anthropic ...]
# 依赖：python3（sherpa-onnx numpy scipy soundfile）、node + playwright、ffmpeg
set -euo pipefail
cd "$(dirname "$0")"
C=.cache
mkdir -p $C/fonts
for f in Serif/SubsetOTF/SC/NotoSerifSC-Black.otf Serif/SubsetOTF/SC/NotoSerifSC-Bold.otf \
         Sans/SubsetOTF/SC/NotoSansSC-Regular.otf Sans/SubsetOTF/SC/NotoSansSC-Medium.otf \
         Sans/SubsetOTF/SC/NotoSansSC-Bold.otf Sans/SubsetOTF/SC/NotoSansSC-Black.otf; do
  [ -s $C/fonts/$(basename $f) ] || curl -fsSL -o $C/fonts/$(basename $f) "https://raw.githubusercontent.com/notofonts/noto-cjk/main/$f"
done
if [ ! -d $C/kokoro-multi-lang-v1_1 ]; then
  curl -fsSL "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2" | tar xj -C $C
fi
[ $# -gt 0 ] || set -- a-weekly b-robot c-anthropic
for s in "$@"; do
  echo "== $s"
  python3 lib/tts.py "$s"
  python3 lib/music.py "$s"
  node lib/render.mjs "$s" --workers "${WORKERS:-3}"
done
