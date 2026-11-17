"""准讯周报视频样片 · 配乐与音效（纯代码合成，无采样）

用法: python score.py <cues.json> <输出.wav>
cues.json 由 render.js 导出：{ "duration": 秒, "music": "editorial|swiss|news", "cues": [{t, type, v}] }
"""
import json
import sys

import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
rng = np.random.default_rng(7)


# ---------------------------------------------------------------- 基础
def T(sec):
    return np.arange(int(sec * SR)) / SR


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def lp(x, fc, order=2):
    return sosfilt(butter(order, min(fc, SR / 2 - 100) / (SR / 2), 'low', output='sos'), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc / (SR / 2), 'high', output='sos'), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos'), x)


def sweep_lp(x, f0, f1):
    """一阶低通，截止频率按指数从 f0 走到 f1"""
    fc = f0 * (f1 / f0) ** np.linspace(0, 1, len(x))
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc); y[i] = acc
    return y


def saw(f, t, voices=1, detune=0.0, harmonics=24):
    out = np.zeros_like(t)
    for v in range(voices):
        fv = f * 2 ** ((detune * (v - (voices - 1) / 2)) / 1200)
        ph = rng.uniform(0, 2 * np.pi)
        for k in range(1, harmonics + 1):
            if fv * k > SR / 2 - 2000:
                break
            out += np.sin(2 * np.pi * fv * k * t + ph * k) / k
    return out / voices


def env(t, a=0.005, d=0.2, s=0.0, r=0.1, hold=None):
    hold = t[-1] if hold is None else hold
    e = np.where(t < a, t / a, s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    return e * np.where(t > hold, np.exp(-(t - hold) / max(r, 1e-4)), 1.0)


class Bus:
    def __init__(self, dur):
        self.n = int((dur + 4) * SR)
        self.L = np.zeros(self.n); self.R = np.zeros(self.n)

    def add(self, t0, x, gain=1.0, pan=0.0):
        i = int(t0 * SR)
        if i >= self.n or i + len(x) <= 0:
            return
        if i < 0:
            x = x[-i:]; i = 0
        x = x[: self.n - i]
        gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        self.L[i:i + len(x)] += x * gain * gl * 1.414
        self.R[i:i + len(x)] += x * gain * gr * 1.414

    def st(self):
        return np.stack([self.L, self.R])


def reverb(st, rt60=1.6, mix=0.25, pre=0.02, tone=6000):
    n = int(rt60 * SR)
    t = np.arange(n) / SR
    ir = np.stack([lp(rng.standard_normal(n), tone) * np.exp(-6.9 * t / rt60) for _ in range(2)])
    ir = np.concatenate([np.zeros((2, int(pre * SR))), ir], axis=1)
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    wet = np.stack([fftconvolve(st[c], ir[c])[: st.shape[1]] for c in range(2)])
    return st + wet * mix


# ---------------------------------------------------------------- 乐器
def piano(f, dur, vel=0.7):
    t = T(dur + 2.0)
    out = np.zeros_like(t)
    damp = (f / 440) ** 0.5
    for k in range(1, 10):
        fk = f * k * np.sqrt(1 + 0.00035 * k * k)
        if fk > 15000:
            break
        out += np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28)) / k ** 1.4 * np.exp(-(0.9 + 0.75 * k) * damp * t)
    hammer = hp(rng.standard_normal(len(t)), 1800) * np.exp(-t / 0.006) * 0.08
    rel = np.where(t > dur, np.exp(-(t - dur) / 0.25), 1.0)
    return (out * np.minimum(1, t / 0.003) + hammer) * rel * vel * 0.35


def strings(freqs, dur, att=1.2, rel=1.6, cutoff=1400):
    t = T(dur + rel * 3)
    x = sum(saw(f, t, voices=3, detune=14, harmonics=16) for f in freqs) / len(freqs)
    x = lp(x, cutoff, 2)
    e = np.minimum(1, t / att) * np.where(t > dur, np.exp(-(t - dur) / rel), 1.0)
    return x * e * 0.5


def kick(vel=1.0, f0=160, f1=46, dec=0.32):
    t = T(0.6)
    f = f1 + (f0 - f1) * np.exp(-t * 28)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / dec)
    click = hp(rng.standard_normal(len(t)), 3000) * np.exp(-t / 0.002) * 0.25
    return np.tanh((x + click) * 1.6) * vel * 0.8


def hat(vel=0.3, dec=0.035):
    t = T(0.25)
    return hp(rng.standard_normal(len(t)), 7500, 4) * np.exp(-t / dec) * vel


def clap(vel=0.5):
    t = T(0.4)
    n = bp(rng.standard_normal(len(t)), 900, 2600)
    e = sum(np.where(t >= o, np.exp(-(t - o) / 0.006), 0) for o in (0, 0.011, 0.022)) + np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.09), 0)
    return n * e * vel


def pluck(f, dur=0.25, vel=0.4, cutoff=3000):
    t = T(dur + 0.3)
    x = saw(f, t, voices=2, detune=6, harmonics=14)
    return lp(x, cutoff) * env(t, 0.003, dur * 0.5, 0, 0.08, dur) * vel


def bass(f, dur, vel=0.6, cutoff=500):
    t = T(dur + 0.1)
    x = saw(f, t, voices=2, detune=8, harmonics=30) + 0.5 * np.sin(2 * np.pi * f / 2 * t)
    return np.tanh(lp(x, cutoff) * 1.5) * env(t, 0.004, dur * 0.7, 0.3, 0.05, dur) * vel


def stab(freqs, vel=0.5, dec=0.18):
    t = T(0.6)
    x = sum(saw(f, t, voices=3, detune=10, harmonics=24) for f in freqs) / len(freqs)
    return lp(x, 3200) * env(t, 0.004, dec, 0, 0.05) * vel


def tom(f=70, vel=0.6, dec=0.5):
    t = T(1.2)
    fr = f * (1 + 0.5 * np.exp(-t * 18))
    x = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / dec)
    n = lp(rng.standard_normal(len(t)), 800) * np.exp(-t / 0.04) * 0.3
    return (x + n) * vel


def bell(f, vel=0.4, dec=1.6):
    t = T(dec * 2.5)
    idx = 3.0 * np.exp(-t / 0.35)
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * 3.5 * t))
    return x * np.exp(-t / dec) * np.minimum(1, t / 0.002) * vel


def blipf(f, vel=0.35, dur=0.09):
    t = T(dur + 0.05)
    return np.sin(2 * np.pi * f * t) * env(t, 0.002, dur * 0.6, 0, 0.02, dur) * vel


def noise_sweep(dur, f0, f1, vel=0.4, shape='swell'):
    t = T(dur)
    x = sweep_lp(rng.standard_normal(len(t)), f0, f1)
    x = hp(x, 150)
    if shape == 'swell':
        e = (t / dur) ** 2
    elif shape == 'whoosh':
        e = np.sin(np.pi * t / dur) ** 2
    else:
        e = np.exp(-t / (dur / 4))
    return x * e * vel


def thud(vel=0.6):
    t = T(0.5)
    x = np.sin(2 * np.pi * np.cumsum(90 + 60 * np.exp(-t * 40)) / SR) * np.exp(-t / 0.12)
    slap = bp(rng.standard_normal(len(t)), 300, 3000) * np.exp(-t / 0.015) * 0.6
    return (x + slap) * vel


def impact(vel=1.0):
    t = T(3.0)
    sub = np.sin(2 * np.pi * np.cumsum(30 + 90 * np.exp(-t * 6)) / SR) * np.exp(-t / 0.9)
    crash = lp(rng.standard_normal(len(t)), 5000) * np.exp(-t / 0.5) * 0.35
    return np.tanh((sub + crash) * 1.4) * vel * 0.8


def ticks(dur, f0, f1, n=16, vel=0.18):
    """数字滚动时的滴答声：按 outExpo 曲线分布（前密后疏）"""
    out = np.zeros(int((dur + 0.2) * SR))
    for k in range(n):
        u = (k + 1) / (n + 1)
        p = -np.log2(1 - u) / 10
        f = f0 * (f1 / f0) ** u
        b = blipf(f, vel * (1 - 0.5 * u), 0.025)
        i = int(p * dur * SR)
        out[i:i + len(b)] += b[: len(out) - i]
    return out


def glitch(vel=0.35):
    t = T(0.16)
    sq = np.sign(np.sin(2 * np.pi * 220 * t)) * 0.5 + hp(rng.standard_normal(len(t)), 2000) * 0.6
    crush = np.round(sq * 6) / 6
    gate = (np.floor(t / 0.02) % 2 == 0).astype(float)
    return crush * gate * np.exp(-t / 0.08) * vel


def typing(n=10, vel=0.15, gap=0.07):
    out = np.zeros(int((n * gap + 0.2) * SR))
    for k in range(n):
        tt = T(0.04)
        c = bp(rng.standard_normal(len(tt)), 1500, 6000) * np.exp(-tt / 0.006) * vel * rng.uniform(0.6, 1)
        i = int((k * gap + rng.uniform(-0.01, 0.01)) * SR); i = max(0, i)
        out[i:i + len(c)] += c[: len(out) - i]
    return out


# ---------------------------------------------------------------- 三种配乐
def chord_notes(root, kind):
    iv = {'m9': [0, 3, 7, 10, 14], 'maj7': [0, 4, 7, 11], 'add9': [0, 4, 7, 14], '6': [0, 4, 7, 9], 'm7': [0, 3, 7, 10],
          'm': [0, 3, 7], 'M': [0, 4, 7], 'sus2': [0, 2, 7]}[kind]
    return [root + i for i in iv]


def music_editorial(dur):
    """84 BPM 温暖钢琴 + 弦乐铺底：社论、纸张、稳重"""
    m = Bus(dur); bpm = 84; beat = 60 / bpm; bar = beat * 4
    prog = [(57, 'm9'), (53, 'maj7'), (48, 'add9'), (55, '6')]   # Am9 Fmaj7 Cadd9 G6
    nb = int(np.ceil(dur / bar))
    for b in range(nb):
        t0 = b * bar
        root, kind = prog[b % 4]
        ns = chord_notes(root, kind)
        m.add(t0, piano(mtof(root - 12), bar * 0.9, 0.55), 1.0, -0.15)
        m.add(t0, piano(mtof(root - 24), bar * 0.9, 0.35), 0.45, -0.15)
        arp = [ns[0] + 12, ns[1] + 12, ns[2] + 12, ns[-1] + 12, ns[2] + 12, ns[1] + 12, ns[2] + 12, ns[-1] + 12]
        for k, note in enumerate(arp):
            if b == 0 and k < 2:
                continue
            m.add(t0 + k * beat / 2, piano(mtof(note), beat * 0.45, 0.30 + 0.06 * (k % 2 == 0)), 1.0, 0.25 * np.sin(k))
        m.add(t0, strings([mtof(n) for n in ns[:4]], bar, att=1.0, rel=1.2, cutoff=1300), 0.45, 0)
        if b >= 2:                                             # 第三小节起：轻拍子
            for k in range(4):
                m.add(t0 + k * beat, kick(0.35, 120, 50, 0.18), 0.3)
                m.add(t0 + k * beat + beat / 2, hat(0.10, 0.05), 1.0, 0.3)
    st = reverb(m.st(), 2.2, 0.32, 0.03, 5000)
    return st


def music_swiss(dur):
    """112 BPM 极简电子：四拍底鼓、脉冲贝斯、琶音——精确、克制"""
    m = Bus(dur); bpm = 112; beat = 60 / bpm; bar = beat * 4; s16 = beat / 4
    prog = [(50, 'm'), (46, 'M'), (53, 'M'), (48, 'M')]       # Dm Bb F C
    nb = int(np.ceil(dur / bar))
    for b in range(nb):
        t0 = b * bar
        root, kind = prog[b % 4]
        ns = chord_notes(root, kind)
        for k in range(4):
            m.add(t0 + k * beat, kick(0.9), 0.42)
            m.add(t0 + k * beat + beat / 2, hat(0.22), 1.0, 0.35)
            if k in (1, 3) and b >= 1:
                m.add(t0 + k * beat, clap(0.38), 1.3, -0.1)
        for k in range(16):
            if k % 4 == 0:
                continue                                        # 给底鼓让位（简易侧链）
            m.add(t0 + k * s16, bass(mtof(root - 12), s16 * 0.8, 0.5, 700 + 500 * (k % 3 == 1)), 0.4)
        if b >= 1:
            arp = [ns[0] + 24, ns[1] + 24, ns[2] + 24, ns[1] + 24]
            for k in range(16):
                m.add(t0 + k * s16, pluck(mtof(arp[k % 4] + (12 if k % 8 == 6 else 0)), 0.09, 0.16, 3200), 2.2, 0.5 * np.sin(k * 1.3))
        m.add(t0, strings([mtof(n + 12) for n in ns], bar, att=0.4, rel=0.6, cutoff=1600), 0.6)
    return reverb(m.st(), 1.1, 0.18, 0.015, 7000)


def music_news(dur):
    """120 BPM 新闻快讯：断奏和弦、时钟滴答、低鼓——紧迫感"""
    m = Bus(dur); bpm = 120; beat = 60 / bpm; bar = beat * 4; s16 = beat / 4
    prog = [(48, 'm'), (44, 'M'), (51, 'M'), (46, 'M')]       # Cm Ab Eb Bb
    nb = int(np.ceil(dur / bar))
    pattern = [0, 3, 6, 10, 12]                                # 16 分音符位置上的断奏
    for b in range(nb):
        t0 = b * bar
        root, kind = prog[b % 4]
        ns = chord_notes(root, kind)
        for k in range(16):
            m.add(t0 + k * s16, hat(0.12 + 0.08 * (k % 4 == 0), 0.02), 1.0, 0.4)
        for p in pattern:
            m.add(t0 + p * s16, stab([mtof(n + 12) for n in ns], 0.42), 1.5, -0.2)
        m.add(t0, tom(mtof(root - 12), 0.7, 0.45), 0.45)
        m.add(t0 + 2.5 * beat, tom(mtof(root - 12), 0.45, 0.35), 0.45)
        m.add(t0, kick(0.8, 140, 44, 0.4), 0.38)
        m.add(t0 + 1.5 * beat, kick(0.5, 140, 44, 0.3), 0.32)
        m.add(t0, bass(mtof(root - 12), bar * 0.95, 0.45, 420), 0.4)
        for k in range(8):
            m.add(t0 + k * beat / 2, pluck(mtof(ns[k % 3] + 24), 0.07, 0.1, 4000), 2.2, 0.45 * (1 if k % 2 else -1))
    return reverb(m.st(), 1.4, 0.2, 0.02, 6500)


# ---------------------------------------------------------------- 音效
def sfx(style, c):
    t, ty, v = c['t'], c['type'], c.get('v', 1)
    out = []                                                    # (偏移, 信号, 增益, 声像)
    if ty == 'swell':
        out.append((-0.9, noise_sweep(1.0, 300, 6000, 0.35, 'swell'), v, 0))
    elif ty == 'swish':
        out.append((-0.1, noise_sweep(0.5, 500, 7000, 0.35, 'whoosh'), v, 0.3))
    elif ty == 'stamp':
        out.append((0, thud(0.8), v, 0))
    elif ty == 'hit':
        if style == 'editorial':
            out.append((0, piano(mtof(45), 1.2, 0.8) + piano(mtof(33), 1.2, 0.6), v * 0.8, 0))
        else:
            out.append((0, impact(0.7), v * 0.8, 0))
    elif ty == 'pen':
        out.append((0, bp(rng.standard_normal(int(0.6 * SR)), 2000, 7000) * np.sin(np.linspace(0, np.pi, int(0.6 * SR))) ** 2 * 0.12, v, 0.2))
    elif ty == 'type':
        out.append((0, typing(14, 0.12, 0.08), v, 0.1))
    elif ty == 'row':
        out.append((-0.05, noise_sweep(0.35, 800, 5000, 0.22, 'whoosh'), v, -0.2))
    elif ty == 'down':
        out.append((0, piano(mtof(40), 0.8, 0.7), v * 0.7, 0))
    elif ty == 'tick':
        out.append((0, bell(1760, 0.12, 0.25) if style != 'news' else blipf(2400, 0.2, 0.02), v, 0.2))
    elif ty == 'bell':
        out.append((0, bell(mtof(81), 0.3, 1.4), v, 0)); out.append((0.02, bell(mtof(88), 0.15, 1.2), v, 0))
    elif ty == 'page':
        out.append((0, noise_sweep(0.45, 600, 9000, 0.3, 'whoosh'), v, -0.3))
    elif ty == 'block':
        out.append((0, thud(0.5), v, 0))
    elif ty == 'wipe':
        out.append((-0.05, noise_sweep(0.45, 400, 9000, 0.35, 'whoosh'), v, 0))
    elif ty == 'thump':
        out.append((0, kick(0.9, 120, 40, 0.25), v * 0.9, 0))
    elif ty == 'count':
        out.append((0, ticks(v, 900, 2200), 1.0, 0.15))
    elif ty == 'countdown':
        out.append((0, ticks(v, 2200, 700), 1.0, 0.15))
    elif ty == 'blip':
        if style == 'swiss':                                   # 成功率每降一步，音高往下走
            scale = [86, 84, 81, 79, 77, 74, 72, 69, 67, 65, 62, 60, 57, 55, 53, 50, 48, 45, 43, 41, 74]
            f = mtof(scale[min(int(v) - 1, len(scale) - 1)])
        else:
            f = mtof(72 + [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20, 22][(int(v) - 1) % 14])
        out.append((0, blipf(f, 0.3, 0.08), 1.0, 0.25 * np.sin(v)))
    elif ty == 'rise':
        tt = T(1.0)
        out.append((0, np.sin(2 * np.pi * np.cumsum(300 + 500 * tt) / SR) * np.sin(np.pi * tt) * 0.12, v, 0))
    elif ty == 'riser':
        out.append((0, noise_sweep(0.8, 200, 9000, 0.4, 'swell'), v, 0))
    elif ty == 'impact':
        out.append((0, impact(1.0), v, 0))
    elif ty == 'glitch':
        out.append((0, glitch(0.3), v, 0.3))
    elif ty == 'end':
        pass
    return [(t + o, x, g, p) for o, x, g, p in out]


def main():
    cfg = json.load(open(sys.argv[1], encoding='utf-8'))
    dur, style = cfg['duration'], cfg['music']
    mus = {'editorial': music_editorial, 'swiss': music_swiss, 'news': music_news}[style](dur)
    n = int(dur * SR)
    mus = mus[:, :n]
    fade = np.ones(n); fl = int(1.8 * SR); fade[-fl:] = np.linspace(1, 0, fl) ** 2
    fade[: int(0.05 * SR)] = np.linspace(0, 1, int(0.05 * SR))
    mus *= fade
    fx = Bus(dur)
    for c in cfg['cues']:
        for t0, x, g, p in sfx(style, c):
            fx.add(t0, x, g, p)
    fxs = fx.st()[:, :n]
    fxs = reverb(fxs, 1.2 if style != 'editorial' else 1.8, 0.2, 0.01)
    mix = mus * 0.55 + fxs * 0.9
    mix = np.stack([hp(mix[c], 35) for c in range(2)])
    mix = np.tanh(mix / (np.max(np.abs(mix)) + 1e-9) * 1.2) * 0.89
    pcm = (mix.T * 32767).astype(np.int16)
    from scipy.io import wavfile
    wavfile.write(sys.argv[2], SR, pcm)
    print(f'{sys.argv[2]}: {dur:.1f}s, style={style}, cues={len(cfg["cues"])}')


if __name__ == '__main__':
    main()
