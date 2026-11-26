"""Master the Kenney CC0 samples for the game: mono, trimmed to the transient,
per-family loudness normalisation with a peak ceiling, short fades, Ogg Vorbis.
Usage: python master_audio.py <kenney_root> <out_dir>
Writes <out_dir>/manifest.json with the measured numbers of every shipped file."""
import json
import os
import sys
import glob

import numpy as np
import soundfile as sf

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
SR = 44100


def find(name):
    hits = glob.glob(os.path.join(SRC, '**', name), recursive=True)
    if not hits:
        raise SystemExit('missing ' + name)
    return hits[0]


def load(name):
    x, sr = sf.read(find(name), dtype='float64', always_2d=True)
    x = x.mean(axis=1)
    if sr != SR:
        t = np.arange(int(len(x) * SR / sr)) * sr / SR
        x = np.interp(t, np.arange(len(x)), x)
    return x


def rate(x, r):
    """Play back at rate r (r < 1 = slower and lower)."""
    n = int(len(x) / r)
    return np.interp(np.arange(n) * r, np.arange(len(x)), x)


def lowpass(x, hz):
    a = np.exp(-2 * np.pi * hz / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def highpass(x, hz):
    return x - lowpass(x, hz)


def trim(x, thresh_db=-50, lead_ms=2):
    """Start within a couple of ms of the transient; cut trailing silence."""
    th = 10 ** (thresh_db / 20) * np.max(np.abs(x))
    idx = np.where(np.abs(x) > th)[0]
    if not len(idx):
        return x
    a = max(0, idx[0] - int(SR * lead_ms / 1000))
    b = min(len(x), idx[-1] + int(SR * 0.02))
    return x[a:b]


def fade(x, fin_ms=1.5, fout_ms=25):
    x = x.copy()
    fi = max(1, int(SR * fin_ms / 1000))
    fo = max(1, int(SR * fout_ms / 1000))
    x[:fi] *= np.linspace(0, 1, fi)
    x[-fo:] *= np.linspace(1, 0, fo)
    return x


def win_max_rms_db(x, ms=50):
    n = max(1, int(SR * ms / 1000))
    p = np.convolve(x * x, np.ones(n) / n, mode='valid')
    return 10 * np.log10(max(p.max(), 1e-12))


def peak_db(x):
    return 20 * np.log10(max(np.max(np.abs(x)), 1e-12))


def master(x, target_db, ceiling_db=-1.5):
    x = x - np.mean(x)  # DC
    g = 10 ** ((target_db - win_max_rms_db(x)) / 20)
    x = x * g
    pk = peak_db(x)
    if pk > ceiling_db:
        x = x * 10 ** ((ceiling_db - pk) / 20)
    return x


def mix(parts, length=None):
    n = length or max(int(off * SR) + len(p) for off, p, _ in parts)
    y = np.zeros(n)
    for off, p, g in parts:
        s = int(off * SR)
        e = min(n, s + len(p))
        y[s:e] += p[: e - s] * g
    return y


manifest = []


def ship(name, family, x, target_db, source, note=''):
    x = fade(master(x, target_db))
    path = os.path.join(OUT, name + '.ogg')
    sf.write(path, x.astype(np.float32), SR, format='OGG', subtype='VORBIS')
    # Decode the shipped file and measure that, not the master.
    y, _ = sf.read(path, dtype='float64')
    manifest.append({
        'file': name + '.ogg', 'family': family, 'source': source, 'note': note,
        'seconds': round(len(y) / SR, 3), 'peakDb': round(peak_db(y), 2),
        'maxRms50msDb': round(win_max_rms_db(y), 2), 'channels': 1, 'bytes': os.path.getsize(path),
    })


# Axe into wood: heavy wooden impacts, trimmed to the hit.
for i in range(4):
    ship(f'chop_{i}', 'chop', trim(load(f'impactWood_heavy_00{i}.ogg')), -11, f'impactWood_heavy_00{i}.ogg (Impact Sounds)')

# Swing through the air: real cloth swishes played slower and low-passed for body (no hiss).
for i, src in enumerate(['cloth1.ogg', 'cloth2.ogg', 'cloth4.ogg']):
    x = trim(load(src), -45)
    x = rate(x, 0.62)
    x = highpass(lowpass(lowpass(x, 2600), 2600), 120)
    ship(f'whoosh_{i}', 'whoosh', x, -19, f'{src} (RPG Audio)', 'played at 0.62x, low-passed 2.6 kHz')

# Tree creaking before it falls: two door creaks, slowed and overlapped (~1.4 s).
for i, (a, b) in enumerate([('creak1.ogg', 'creak3.ogg'), ('creak2.ogg', 'creak1.ogg')]):
    xa = rate(trim(load(a), -45), 0.72)
    xb = rate(trim(load(b), -45), 0.66)
    x = mix([(0.0, xa, 1.0), (0.78, xb, 0.85)])
    x = lowpass(x, 5000)
    ship(f'creak_{i}', 'creak', x, -17, f'{a} + {b} (RPG Audio)', 'slowed 0.72x / 0.66x and layered')

# Tree hitting the ground: a deep wooden slam, a body thud and breaking branches after it.
for i in range(2):
    slam = rate(trim(load(f'impactWood_heavy_00{4 - i}.ogg')), 0.52)
    thud = rate(trim(load(f'impactSoft_heavy_00{i}.ogg')), 0.6)
    crack = [rate(trim(load(f'impactPlank_medium_00{k}.ogg')), 0.85 + 0.1 * j) for j, k in enumerate([i, i + 2, i + 3])]
    twigs = [trim(load(f'impactWood_light_00{k}.ogg')) for k in (i, i + 2)]
    x = mix([(0.0, slam, 1.0), (0.0, thud, 0.9), (0.09, crack[0], 0.55), (0.21, crack[1], 0.4), (0.33, twigs[0], 0.35), (0.47, crack[2], 0.3), (0.6, twigs[1], 0.22)])
    ship(f'crash_{i}', 'crash', x, -10, 'impactWood_heavy, impactSoft_heavy, impactPlank_medium, impactWood_light (Impact Sounds)', 'layered: slam 0.52x + thud + branch cracks')

# Blows on flesh (enemies, animals).
for i in range(4):
    ship(f'hit_{i}', 'hit', trim(load(f'impactPunch_heavy_00{i}.ogg')), -13, f'impactPunch_heavy_00{i}.ogg (Impact Sounds)')
for i in range(3):
    ship(f'thud_{i}', 'thud', trim(load(f'impactSoft_heavy_00{i}.ogg')), -14, f'impactSoft_heavy_00{i}.ogg (Impact Sounds)')
# Suitcases, crates and effigies breaking.
for i in range(3):
    ship(f'break_{i}', 'break', trim(load(f'impactPlank_medium_00{i}.ogg')), -13, f'impactPlank_medium_00{i}.ogg (Impact Sounds)')
# Light wooden knocks: arrows striking, effigy hits.
for i in range(3):
    ship(f'knock_{i}', 'knock', trim(load(f'impactWood_light_00{i}.ogg')), -17, f'impactWood_light_00{i}.ogg (Impact Sounds)')
# Footsteps per surface.
for surf, src in [('grass', 'grass'), ('wood', 'wood'), ('stone', 'concrete'), ('sand', 'snow')]:
    for i in range(4):
        ship(f'step_{surf}_{i}', 'step', trim(load(f'footstep_{src}_00{i}.ogg'), -45), -24, f'footstep_{src}_00{i}.ogg (Impact Sounds)')

json.dump({'generated': 'scratchpad/master_audio.py', 'files': manifest}, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
tot = sum(m['bytes'] for m in manifest)
print(len(manifest), 'files', round(tot / 1024), 'KB')
for m in manifest:
    print(f"{m['file']:<20} {m['seconds']:>6}s peak {m['peakDb']:>6} rms50 {m['maxRms50msDb']:>6}")
