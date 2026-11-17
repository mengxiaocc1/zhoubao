#!/usr/bin/env python3
"""合成一段柔和的背景音（占位用，正式版建议换成有授权的配乐），并和旁白混音。

用法：python3 music.py <sample_dir>
读取 build/timeline.json，输出 build/mix.wav（48kHz 立体声）。
"""
import json, os, sys

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly, fftconvolve, butter, sosfilt

SR = 48000


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def pad_note(freq, dur, sr=SR):
    t = np.arange(int(dur * sr)) / sr
    out = np.zeros_like(t)
    for det in (-0.004, 0.0, 0.004):  # 轻微失谐，做出合唱感
        f = freq * (1 + det)
        for h, amp in ((1, 1.0), (2, 0.35), (3, 0.12), (4, 0.06)):
            out += amp * np.sin(2 * np.pi * f * h * t + np.random.rand() * 6.28)
    a, r = min(1.4, dur / 3), min(1.6, dur / 3)
    env = np.minimum(1, t / a) * np.minimum(1, (dur - t) / r)
    return out * env


def pluck(freq, dur=0.9, sr=SR):
    t = np.arange(int(dur * sr)) / sr
    x = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2 * t)
    return x * np.exp(-t * 6) * np.minimum(1, t / 0.004)


def bed(seconds, bpm=96, mood="calm", seed=7):
    np.random.seed(seed)
    n = int(seconds * SR) + SR * 4
    L = np.zeros(n)
    R = np.zeros(n)
    # vi – IV – I – V（A 小调 / C 大调），每个和弦两小节
    prog = [(57, [57, 60, 64, 67]), (53, [53, 57, 60, 64]), (48, [48, 52, 55, 59]), (55, [55, 59, 62, 66 - 1])]
    bar = 4 * 60 / bpm
    chord_len = bar * 2
    t = 0.0
    i = 0
    while t < seconds + chord_len:
        root, notes = prog[i % len(prog)]
        s = int(t * SR)
        if s >= n:
            break
        seg = sum(pad_note(midi(m + 12), chord_len + 1.2) for m in notes) * 0.06
        seg += pad_note(midi(root - 12), chord_len + 1.2) * 0.10
        e = min(n, s + len(seg))
        L[s:e] += seg[: e - s]
        R[s:e] += seg[: e - s]
        # 八分音符琶音，左右轻微错开
        step = 60 / bpm / 2
        arp = [notes[k % 4] + 24 for k in (0, 2, 1, 3, 2, 1, 3, 2)] if mood != "calm" else [notes[k % 4] + 24 for k in (0, 2, 3, 2)]
        stepk = step if mood != "calm" else step * 2
        k = 0
        while k * stepk < chord_len - 0.01:
            ps = int((t + k * stepk) * SR)
            if ps >= n:
                break
            p = pluck(midi(arp[k % len(arp)])) * (0.05 if mood != "calm" else 0.035)
            pe = min(n, ps + len(p))
            pan = 0.35 if k % 2 else -0.35
            L[ps:pe] += p[: pe - ps] * (1 - pan)
            R[ps:pe] += p[: pe - ps] * (1 + pan)
            k += 1
        t += chord_len
        i += 1
    # 简单混响：指数衰减噪声做卷积
    ir_t = np.arange(int(2.2 * SR)) / SR
    ir = np.random.randn(len(ir_t)) * np.exp(-ir_t * 2.6)
    ir /= np.abs(ir).sum() / 6
    L = L * 0.7 + fftconvolve(L, ir)[:n] * 0.3
    R = R * 0.7 + fftconvolve(R, np.roll(ir, 97))[:n] * 0.3
    sos = butter(2, 5200, "lowpass", fs=SR, output="sos")
    x = np.stack([sosfilt(sos, L), sosfilt(sos, R)], 1)[: int(seconds * SR)]
    x /= np.max(np.abs(x)) + 1e-9
    fade = np.minimum(1, np.arange(len(x)) / (1.5 * SR))
    fade = np.minimum(fade, np.minimum(1, (len(x) - np.arange(len(x))) / (2.5 * SR)))
    return x * fade[:, None]


def main(sample_dir):
    spec = json.load(open(os.path.join(sample_dir, "script.json"), encoding="utf-8"))
    tl = json.load(open(os.path.join(sample_dir, "build", "timeline.json"), encoding="utf-8"))
    dur = tl["duration"]
    n = int(dur * SR)
    voice = np.zeros(n)
    for ln in tl["lines"]:
        a, sr = sf.read(ln["wav"], dtype="float32")
        if a.ndim > 1:
            a = a.mean(1)
        a = resample_poly(a, SR // 100, sr // 100) if sr != SR else a
        s = int(ln["start"] * SR)
        e = min(n, s + len(a))
        voice[s:e] += a[: e - s]
    voice /= np.max(np.abs(voice)) + 1e-9
    voice *= 0.89

    m = spec.get("music", {})
    music = bed(dur, bpm=m.get("bpm", 96), mood=m.get("mood", "calm"))
    # 旁白出现时把音乐压低（侧链闪避）
    env = np.convolve(np.abs(voice), np.ones(int(0.25 * SR)) / (0.25 * SR), mode="same")
    duck = 1 - 0.55 * np.clip(env / 0.05, 0, 1)
    duck = np.convolve(duck, np.ones(int(0.3 * SR)) / (0.3 * SR), mode="same")
    level = m.get("level", 0.16)
    mix = np.stack([voice, voice], 1) + music * (level * duck)[:, None]
    mix /= max(1.0, np.max(np.abs(mix)) / 0.97)
    sf.write(os.path.join(sample_dir, "build", "mix.wav"), mix.astype(np.float32), SR)
    print("mix.wav", round(dur, 1), "s")


if __name__ == "__main__":
    main(sys.argv[1])
