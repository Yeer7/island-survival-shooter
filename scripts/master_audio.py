"""Master the game's sound bank into public/assets/audio as mono MP3.

The recordings were picked by ear by the owner (Freesound, CC0 1.0) and live, raw, in
Soms/ (git-ignored). This script only trims silence to the transient, cuts single
footsteps, folds ambience loops so they repeat without a click, and normalises levels;
it never re-pitches or slows a sound. The remaining Kenney CC0 impacts (flesh, thud,
wood breaking, light knocks) are carried over from the previous bank as MP3.

Usage: python scripts/master_audio.py <Soms dir> <fission footsteps dir> <kenney dir> <out dir>
Needs: pip install --user soundfile numpy (libsndfile >= 1.1 for MP3).
Writes <out>/manifest.json with the decoded peak, loudness and length of every file.
"""
import glob
import json
import os
import sys

import numpy as np
import soundfile as sf

SOMS, FISSION, KENNEY, OUT = sys.argv[1:5]
SR = 44100
os.makedirs(OUT, exist_ok=True)


def load(path):
    x, sr = sf.read(path, dtype='float64', always_2d=True)
    x = x.mean(axis=1)
    if sr != SR:
        t = np.arange(int(len(x) * SR / sr)) * sr / SR
        x = np.interp(t, np.arange(len(x)), x)
    return x - np.mean(x)


def soms(prefix):
    return load(glob.glob(os.path.join(SOMS, prefix + '*'))[0])


def lowpass(x, hz):
    a = np.exp(-2 * np.pi * hz / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def env_db(x, ms=10):
    n = max(1, int(SR * ms / 1000))
    m = len(x) // n
    r = np.sqrt(np.mean(x[: m * n].reshape(m, n) ** 2, axis=1))
    return 20 * np.log10(r + 1e-9), n


def trim(x, thresh_db=-40, lead_ms=3):
    """Start a few ms before the first sample within `thresh_db` of the peak."""
    th = 10 ** (thresh_db / 20) * np.max(np.abs(x))
    idx = np.where(np.abs(x) > th)[0]
    a = max(0, idx[0] - int(SR * lead_ms / 1000))
    b = min(len(x), idx[-1] + int(SR * 0.03))
    return x[a:b]


def fade(x, fin_ms=2, fout_ms=40):
    x = x.copy()
    fi, fo = max(1, int(SR * fin_ms / 1000)), max(1, int(SR * fout_ms / 1000))
    x[:fi] *= np.linspace(0, 1, fi)
    x[-fo:] *= np.linspace(1, 0, fo) ** 1.5
    return x


def win_rms_db(x, ms=50):
    n = max(1, int(SR * ms / 1000))
    p = np.convolve(x * x, np.ones(n) / n, mode='valid')
    return 10 * np.log10(max(p.max(), 1e-12))


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x * x)) + 1e-12)


def peak_db(x):
    return 20 * np.log10(max(np.max(np.abs(x)), 1e-12))


def normalise(x, target_db, loop=False, ceiling_db=-1.5):
    level = rms_db(x) if loop else win_rms_db(x)
    x = x * 10 ** ((target_db - level) / 20)
    pk = peak_db(x)
    if pk > ceiling_db:
        x = x * 10 ** ((ceiling_db - pk) / 20)
    return x


def loopable(x, start_s, length_s, xfade_s=1.5):
    """Cut [start, start+length] and fold the following xfade over the head (equal power)."""
    a, n, f = int(start_s * SR), int(length_s * SR), int(xfade_s * SR)
    seg = x[a : a + n + f].copy()
    head, tail = seg[:f], seg[n : n + f]
    t = np.linspace(0, np.pi / 2, f)
    seg[:f] = head * np.sin(t) + tail * np.cos(t)
    return seg[:n]


def calmest(x, length_s, hop_s=1.0):
    """Start of the steadiest window (lowest spread of short-term level): no stand-out events in the loop."""
    e, n = env_db(x, 100)
    w = int(length_s * 10)
    best, best_s = None, 0.0
    for i in range(0, len(e) - w, int(hop_s * 10)):
        spread = np.std(e[i : i + w]) + max(0, np.max(e[i : i + w]) - np.median(e[i : i + w]) - 8) * 0.5
        if best is None or spread < best:
            best, best_s = spread, i / 10
    return best_s


def onsets(x, min_gap_s=0.28, rise_db=18):
    """Footstep onsets: the level jumps well above the recent floor."""
    e, n = env_db(x, 5)
    floor = np.percentile(e, 20)
    out, last = [], -1e9
    for i in range(1, len(e)):
        if e[i] > floor + rise_db and e[i - 1] <= floor + rise_db and (i - last) * n / SR > min_gap_s:
            out.append(i * n)
            last = i
    return out


manifest = []


def ship(name, family, x, source, url, author, note='', level=0.55):
    path = os.path.join(OUT, name + '.mp3')
    sf.write(path, x.astype(np.float32), SR, format='MP3', subtype='MPEG_LAYER_III', bitrate_mode='CONSTANT', compression_level=level)
    y, ysr = sf.read(path, dtype='float64', always_2d=True)
    y = y.mean(axis=1)
    manifest.append({
        'file': name + '.mp3', 'family': family, 'source': source, 'url': url, 'author': author, 'note': note,
        'seconds': round(len(y) / ysr, 3), 'peakDb': round(peak_db(y), 2), 'maxRms50msDb': round(win_rms_db(y), 2),
        'rmsDb': round(rms_db(y), 2), 'channels': 1, 'bytes': os.path.getsize(path),
    })


FS = 'https://freesound.org/s/'
# ---- ambience loops (14 s, folded so the loop point has no click)
amb = [
    ('sea', '352356', 'Alex_hears_things', -27),
    ('forest_day', '530908', 'Nox_Sound', -29),
    ('forest_night', '587907', 'timothyd4y', -29),
    ('campfire', '620324', 'marb7e', -25),
]
for name, sid, author, target in amb:
    x = soms(sid)
    start = calmest(x[: -int(17 * SR)], 15.5)
    loop = loopable(x, start, 14.0)
    ship(name, 'ambience', normalise(loop, target, loop=True), os.path.basename(glob.glob(os.path.join(SOMS, sid + '*'))[0]), FS + sid + '/', author, f'14 s loop from {start:.1f} s, folded 1.5 s crossfade', level=0.82)

# ---- the axe, the swing and the tree
chop = soms('421928')
ship('chop_0', 'chop', fade(normalise(trim(chop, -30), -11), 1, 30), '421928__micahlg__chopping-wood-01.wav', FS + '421928/', 'micahlg', 'trimmed to the transient')
wh = soms('855844')
ship('whoosh_0', 'whoosh', fade(normalise(trim(wh, -45), -18), 2, 40), '855844__sadiquecat__whoosh-long-bamboo-stick-os-st-13.wav', FS + '855844/', 'Sadiquecat', 'trimmed')
tree = soms('867699')
e, n = env_db(tree, 10)
impact = int(np.argmax(e)) * n  # the trunk hitting the ground
creak = tree[: max(int(1.2 * SR), impact - int(0.75 * SR))]
ship('creak_0', 'creak', fade(normalise(trim(creak, -40), -17), 3, 200), '867699 (cracking part)', FS + '867699/', 'ozymandias37', f'cracking before the fall, up to {len(creak) / SR:.2f} s')
crash = tree[max(0, impact - int(0.12 * SR)) : impact + int(2.6 * SR)]
ship('crash_0', 'crash', fade(normalise(crash, -10), 4, 400), '867699 (impact part)', FS + '867699/', 'ozymandias37', f'main impact from {impact / SR - 0.12:.2f} s with its tail')

# ---- footsteps: single clean steps cut from each surface recording
surfaces = [('grass', '521587', 'grass'), ('wood', '521589', 'wooden-planks'), ('stone', '521590', 'stone'), ('sand', '521588', 'gravel')]
for surf, sid, label in surfaces:
    x = load(glob.glob(os.path.join(FISSION, sid + '*'))[0])
    if surf == 'sand':
        x = lowpass(lowpass(x, 3200), 3200)  # gravel softened toward sand
    cuts = []
    on = onsets(x)
    for k, o in enumerate(on):
        end = on[k + 1] if k + 1 < len(on) else len(x)
        a, b = max(0, o - int(0.006 * SR)), min(end - int(0.01 * SR), o + int(0.42 * SR))
        if b - a < int(0.12 * SR):
            continue
        seg = x[a:b]
        cuts.append((win_rms_db(seg), seg))
    # The cleanest steps: strong but not the outliers.
    cuts.sort(key=lambda c: c[0])
    mid = cuts[len(cuts) // 4 : len(cuts) // 4 + 5] if len(cuts) >= 8 else cuts[:5]
    for i, (_, seg) in enumerate(mid):
        ship(f'step_{surf}_{i}', 'step', fade(normalise(seg, -24), 1.5, 60), f'{sid}__fission9__hiking-boot-footsteps-on-{label}.wav', FS + sid + '/', 'Fission9', ('low-passed 3.2 kHz (gravel -> sand); ' if surf == 'sand' else '') + 'single step')

# ---- carried over from Kenney (CC0): flesh, thud, wood breaking, light knocks
kmap = [('hit', 'impactPunch_heavy', 4, -13), ('thud', 'impactSoft_heavy', 3, -14), ('break', 'impactPlank_medium', 3, -13), ('knock', 'impactWood_light', 3, -17)]
for fam, src, count, target in kmap:
    for i in range(count):
        f = glob.glob(os.path.join(KENNEY, '**', f'{src}_00{i}.ogg'), recursive=True)[0]
        ship(f'{fam}_{i}', fam, fade(normalise(trim(load(f), -50), target), 1.5, 25), f'{src}_00{i}.ogg (Kenney Impact Sounds)', 'https://kenney.nl/assets/impact-sounds', 'Kenney')

json.dump({'generated': 'scripts/master_audio.py', 'files': manifest}, open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8'), indent=1)
tot = sum(m['bytes'] for m in manifest)
print(len(manifest), 'files', round(tot / 1024), 'KB')
for m in manifest:
    print(f"{m['file']:<22} {m['seconds']:>7}s peak {m['peakDb']:>6} rms {m['rmsDb']:>6} max50 {m['maxRms50msDb']:>6} {m['bytes'] // 1024} KB")
