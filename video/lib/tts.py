#!/usr/bin/env python3
"""把 script.json 里的旁白逐句合成语音，并排出时间轴。

输出（写到 <sample>/build/）：
  voice/<n>.wav    每句一条，已裁掉首尾静音
  timeline.json    每个 beat / 每句的起止时间，供 scene.html 和混音使用
  timeline.js      同上，包成 window.TL=... 便于 file:// 直接加载
"""
import hashlib, json, os, re, sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("ZX_TTS_MODEL", os.path.join(HERE, "..", ".cache", "kokoro-multi-lang-v1_1"))
CACHE = os.path.join(HERE, "..", ".cache", "tts")

_tts = None


def engine():
    global _tts
    if _tts is None:
        import sherpa_onnx
        M = MODEL
        lex = [f"{M}/lexicon-us-en.txt", f"{M}/lexicon-zh.txt"]
        custom = os.path.join(HERE, "lexicon-custom.txt")
        if os.path.exists(custom):
            lex.insert(0, custom)
        cfg = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=f"{M}/model.onnx", voices=f"{M}/voices.bin", tokens=f"{M}/tokens.txt",
                    data_dir=f"{M}/espeak-ng-data", dict_dir=f"{M}/dict", lexicon=",".join(lex)),
                num_threads=4),
            rule_fsts=f"{M}/phone-zh.fst,{M}/date-zh.fst,{M}/number-zh.fst",
            max_num_sentences=1)
        _tts = sherpa_onnx.OfflineTts(cfg)
    return _tts


def trim(a, sr, thr=0.012, keep=0.04):
    env = np.abs(a)
    idx = np.where(env > thr)[0]
    if len(idx) == 0:
        return a
    k = int(keep * sr)
    return a[max(0, idx[0] - k): min(len(a), idx[-1] + k)]


def synth(text, sid, speed):
    os.makedirs(CACHE, exist_ok=True)
    key = hashlib.sha1(f"{text}|{sid}|{speed}".encode()).hexdigest()[:16]
    path = os.path.join(CACHE, key + ".wav")
    if not os.path.exists(path):
        out = engine().generate(text, sid=sid, speed=speed)
        a = trim(np.asarray(out.samples, dtype=np.float32), out.sample_rate)
        sf.write(path, a, out.sample_rate)
    info = sf.info(path)
    return path, info.frames / info.samplerate


def main(sample_dir):
    spec = json.load(open(os.path.join(sample_dir, "script.json"), encoding="utf-8"))
    voice = spec.get("voice", {})
    sid, speed = voice.get("sid", 12), voice.get("speed", 1.0)
    gap = spec.get("lineGap", 0.22)
    build = os.path.join(sample_dir, "build")
    os.makedirs(os.path.join(build, "voice"), exist_ok=True)

    t = spec.get("lead", 0.4)
    beats, lines_out, n = {}, [], 0
    for b in spec["beats"]:
        t += b.get("pre", 0.15)
        start = t
        lines = []
        for ln in b.get("lines", []):
            say = ln.get("say", ln.get("cap"))
            sp = ln.get("speed", speed)
            if "speed" not in ln and re.search(r"[A-Za-z]{4,}", say):
                sp = voice.get("enSpeed", sp)  # 含英文名的句子放慢一点，避免英文被吞音
            path, dur = synth(say, ln.get("sid", sid), sp)
            n += 1
            dst = os.path.join(build, "voice", f"{n:03d}.wav")
            if os.path.exists(dst):
                os.remove(dst)
            os.symlink(os.path.abspath(path), dst)
            t += ln.get("pre", 0)
            item = {"n": n, "start": round(t, 3), "end": round(t + dur, 3), "cap": ln.get("cap", say), "wav": dst}
            lines.append(item)
            lines_out.append(item)
            last_post = ln.get("post", gap)
            t += dur + last_post
        if lines:
            t -= last_post  # 最后一句之后不加句间停顿，由 beat 的 post 决定
        t = max(t, start + b.get("min", 0))
        t += b.get("post", 0.45)
        beats[b["id"]] = {"start": round(start, 3), "end": round(t, 3), "lines": lines}
    duration = round(t + spec.get("tail", 1.2), 3)
    tl = {"fps": spec.get("fps", 30), "w": spec["w"], "h": spec["h"], "duration": duration, "beats": beats,
          "order": [b["id"] for b in spec["beats"]], "lines": lines_out}
    json.dump(tl, open(os.path.join(build, "timeline.json"), "w"), ensure_ascii=False, indent=1)
    with open(os.path.join(build, "timeline.js"), "w") as f:
        f.write("window.TL=" + json.dumps(tl, ensure_ascii=False) + ";\n")
    print(f"{spec.get('title','')}: {len(lines_out)} 句旁白，总时长 {duration:.1f}s")


if __name__ == "__main__":
    main(sys.argv[1])
