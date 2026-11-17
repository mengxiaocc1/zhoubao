#!/usr/bin/env python3
"""用语音识别回听每句旁白，标出识别结果和原文差异较大的句子（多音字、英文名、数字读错时会暴露）。"""
import json, os, re, sys
import numpy as np, soundfile as sf
from scipy.signal import resample_poly
import sherpa_onnx
A = os.environ.get("ZX_ASR_MODEL", os.path.join(os.path.dirname(__file__), "..", ".cache", "sense-voice"))
rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(model=f"{A}/model.int8.onnx", tokens=f"{A}/tokens.txt", language="zh", use_itn=False, num_threads=4)
spec = json.load(open(os.path.join(sys.argv[1], "build", "timeline.json")))
says = [l.get("say", l.get("cap")) for b in json.load(open(os.path.join(sys.argv[1], "script.json")))["beats"] for l in b.get("lines", [])]
norm = lambda s: re.sub(r"[\s，。：；、！？·—\-–“”「」（）()]", "", s).lower()
def cer(a, b):
    d = np.arange(len(b) + 1)
    for i, ca in enumerate(a, 1):
        p = d.copy(); d[0] = i
        for j, cb in enumerate(b, 1): d[j] = min(p[j] + 1, d[j - 1] + 1, p[j - 1] + (ca != cb))
    return d[-1] / max(1, len(a))
for ln, say in zip(spec["lines"], says):
    a, sr = sf.read(ln["wav"], dtype="float32")
    x = resample_poly(a, 2, 3).astype(np.float32) if sr == 24000 else a
    s = rec.create_stream(); s.accept_waveform(16000, x); rec.decode_stream(s)
    c = cer(norm(say), norm(s.result.text))
    print(f"{'!!' if c > 0.12 else '  '} {ln['n']:02d} {c:.2f} {round(ln['end']-ln['start'],1)}s | {say}\n      → {s.result.text}")
