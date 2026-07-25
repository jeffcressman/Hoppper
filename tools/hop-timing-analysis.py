#!/usr/bin/env python3
"""Measure whether rifff hops land on the beat, from a recording and a log.

    python3 tools/hop-timing-analysis.py <recording.wav> [hoppper.log]

WHY THIS EXISTS
---------------
Hop timing bugs are inaudible as *numbers* and obvious as *sound*, and the
reverse is true for the engine's own logs — so the only way to pin one down is
to measure the audio and correlate it with what the engine said it was doing.
Doing exactly that is what identified the July 2026 bug where every hop after
the first was measured from the previous hop instead of from the playback
grid, landing the audio 170ms, 100ms and 140ms off a 120bpm beat.

WHAT IT DOES
------------
1. Finds note onsets in the recording and estimates the pulse from them.
2. Fits a beat grid to the opening (before any hop can have happened) and
   measures every later onset against it, in milliseconds and in sixteenths.
3. Groups the onsets into segments of constant error — each hop that lands
   off the beat shows up as a step change.
4. Given a Hoppper log, parses its `start`/`hop` lines, works out where each
   hop *should* have landed on the grid, aligns the two clocks, and prints
   predicted-vs-measured for every hop.

HOW TO READ IT
--------------
A healthy session has one segment: every onset within a few ms of the grid,
with no steps. Each step is a hop that moved the audio off the beat, and its
size is the error. If a log is supplied, "predicted" is what the logged
offsets imply and "measured" is what the audio actually did; they should
agree, and both should be ~0 once hops are correct.

Caveats worth knowing before trusting a number: onset detection is
energy-based, so soft or heavily reverbed material gives noisier timings;
the crossfade blurs the onset either side of a hop, so the onset closest to a
hop often reads as a value between the two segments; and the pulse estimate
assumes a steady tempo across the recording.

Record with the app on the host (audio does not reach the dev container) and
capture the log panel's Copy output to a text file for the second argument.
"""

import math
import re
import struct
import sys


# --------------------------------------------------------------------------
# Audio


def load_wav(path):
    """Return (mono samples, sample rate). Handles float32, int16 and int24."""
    raw = open(path, 'rb').read()
    if raw[:4] != b'RIFF' or raw[8:12] != b'WAVE':
        raise SystemExit(f'{path}: not a RIFF/WAVE file')

    fmt = data = None
    i = 12
    while i < len(raw) - 8:
        cid = raw[i:i + 4]
        size = struct.unpack('<I', raw[i + 4:i + 8])[0]
        if cid == b'fmt ':
            fmt = struct.unpack('<HHIIHH', raw[i + 8:i + 24])
        elif cid == b'data':
            data = raw[i + 8:i + 8 + size]
        i += 8 + size + (size & 1)
    if fmt is None or data is None:
        raise SystemExit(f'{path}: missing fmt or data chunk')

    tag, channels, rate, _, _, bits = fmt
    frames = len(data) // (channels * bits // 8)
    mono = [0.0] * frames

    if tag == 3 and bits == 32:  # IEEE float
        step = channels * 4
        for n in range(frames):
            off = n * step
            mono[n] = sum(struct.unpack_from('<%df' % channels, data, off)) / channels
    elif tag == 1 and bits == 16:
        step = channels * 2
        for n in range(frames):
            off = n * step
            s = struct.unpack_from('<%dh' % channels, data, off)
            mono[n] = sum(s) / (channels * 32768.0)
    elif tag == 1 and bits == 24:
        step = channels * 3
        for n in range(frames):
            acc = 0
            for c in range(channels):
                off = n * step + c * 3
                v = data[off] | (data[off + 1] << 8) | (data[off + 2] << 16)
                if v & 0x800000:
                    v -= 0x1000000
                acc += v
            mono[n] = acc / (channels * 8388608.0)
    else:
        raise SystemExit(f'{path}: unsupported WAV format tag {tag} at {bits} bits')

    return mono, rate


HOP_SAMPLES = 64  # envelope resolution: 1.33ms at 48k


def onsets_of(x, rate):
    """Detected onsets as (time, strength), via rectified log-energy difference."""
    win = 512
    env = []
    for start in range(0, len(x) - win, HOP_SAMPLES):
        acc = 0.0
        for n in range(start, start + win, 2):
            acc += x[n] * x[n]
        env.append(math.sqrt(acc / (win / 2)))

    logs = [math.log(v + 1e-9) for v in env]
    flux = [0.0] * len(logs)
    for i in range(1, len(logs)):
        d = logs[i] - logs[i - 1]
        flux[i] = d if d > 0 else 0.0
    smooth = [
        sum(flux[max(0, i - 1):min(len(flux), i + 2)]) / len(flux[max(0, i - 1):min(len(flux), i + 2)])
        for i in range(len(flux))
    ]

    mean = sum(smooth) / len(smooth)
    sd = math.sqrt(sum((v - mean) ** 2 for v in smooth) / len(smooth))
    threshold = mean + 1.2 * sd
    min_gap = int(0.05 * rate / HOP_SAMPLES)

    peaks = []
    for i in range(1, len(smooth) - 1):
        v = smooth[i]
        if v > threshold and v >= smooth[i - 1] and v > smooth[i + 1]:
            if peaks and i - peaks[-1][0] < min_gap:
                if v > peaks[-1][1]:
                    peaks[-1] = (i, v)
            else:
                peaks.append((i, v))
    return [(i * HOP_SAMPLES / rate, v) for i, v in peaks], smooth


def estimate_period(strength, rate, lo=0.15, hi=1.4):
    """Strongest periodicity in the onset envelope, in seconds."""
    mean = sum(strength) / len(strength)
    x = [v - mean for v in strength]
    lo_lag, hi_lag = int(lo * rate / HOP_SAMPLES), int(hi * rate / HOP_SAMPLES)
    best, best_lag = 0.0, lo_lag
    for lag in range(lo_lag, hi_lag):
        acc = 0.0
        for i in range(len(x) - lag):
            acc += x[i] * x[i + lag]
        acc /= (len(x) - lag)
        if acc > best:
            best, best_lag = acc, lag
    return best_lag * HOP_SAMPLES / rate


def signed_mod(value, period):
    e = value % period
    return e - period if e > period / 2 else e


def fit_phase(onsets, period):
    best_err, best_phi = None, 0.0
    for k in range(400):
        phi = period * k / 400
        err = sum(w * signed_mod(t - phi, period) ** 2 for t, w in onsets)
        if best_err is None or err < best_err:
            best_err, best_phi = err, phi
    return best_phi


def segment(errors, tolerance=0.008):
    """Group consecutive onsets whose grid error agrees within `tolerance`."""
    segments = []
    for t, e in errors:
        if segments and abs(e - segments[-1]['error']) <= tolerance:
            seg = segments[-1]
            seg['end'] = t
            seg['count'] += 1
            seg['error'] = (seg['error'] * (seg['count'] - 1) + e) / seg['count']
        else:
            segments.append({'start': t, 'end': t, 'error': e, 'count': 1})
    return segments


# --------------------------------------------------------------------------
# Log


START_RE = re.compile(r'start (\S+) at ([\d.]+)s .*?loop=([\d.]+)s')
HOP_RE = re.compile(r'hop (\S+) → (\S+) at ([\d.]+)s offset=([\d.]+)s')


def parse_log(path):
    """Extract the cold start and each hop from a Hoppper log panel dump."""
    start, hops = None, []
    for line in open(path, encoding='utf-8'):
        m = START_RE.search(line)
        if m and start is None:
            start = {'riff': m.group(1), 'at': float(m.group(2)), 'loop': float(m.group(3))}
            continue
        m = HOP_RE.search(line)
        if m:
            hops.append(
                {
                    'from': m.group(1),
                    'to': m.group(2),
                    'at': float(m.group(3)),
                    'offset': float(m.group(4)),
                }
            )
    return start, hops


def report_log(start, hops, period, segments):
    loop = start['loop']
    print(f'\nLog: cold start at {start["at"]:.2f}s (AudioContext), loop {loop:.2f}s, '
          f'{len(hops)} hop(s)\n')

    rows = []
    for hop in hops:
        grid = (hop['at'] - start['at']) % loop
        drift = hop['offset'] - grid
        predicted = -signed_mod(drift, period)
        rows.append((hop, grid, predicted))

    # The recording and the AudioContext have unrelated clocks. Align them on
    # the steps we measured: each hop that moved the audio should line up with
    # a segment boundary.
    steps = [s['start'] for s in segments[1:]]
    offset = None
    if len(steps) == len(rows) and steps:
        offset = sum(h['at'] - t for (h, _, _), t in zip(rows, steps)) / len(steps)

    print(f'{"hop @ctx":>9} {"logged":>8} {"grid":>8} {"predicted":>11} {"measured":>10}')
    for idx, (hop, grid, predicted) in enumerate(rows):
        measured = ''
        if offset is not None:
            audio_t = hop['at'] - offset
            for seg in segments:
                if seg['start'] - 0.3 <= audio_t <= seg['end'] + 0.3:
                    measured = f'{seg["error"] * 1000:9.1f}ms'
            if not measured and idx + 1 < len(segments):
                measured = f'{segments[idx + 1]["error"] * 1000:9.1f}ms'
        print(f'{hop["at"]:9.2f} {hop["offset"]:7.2f}s {grid:7.2f}s '
              f'{predicted * 1000:9.1f}ms {measured:>10}')

    worst = max((abs(p) for _, _, p in rows), default=0.0)
    print()
    if worst < 0.005:
        print('Verdict: every hop lands on the grid. Offsets match grid position.')
    else:
        print(f'Verdict: hops are off the grid by up to {worst * 1000:.0f}ms. '
              'A logged offset that differs from the grid position means the '
              'engine measured the hop from the wrong origin.')


# --------------------------------------------------------------------------


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    audio_path = sys.argv[1]
    log_path = sys.argv[2] if len(sys.argv) > 2 else None

    x, rate = load_wav(audio_path)
    onsets, strength = onsets_of(x, rate)
    print(f'{audio_path}: {len(x) / rate:.2f}s at {rate}Hz, {len(onsets)} onsets')
    if len(onsets) < 4:
        raise SystemExit('too few onsets to measure a grid — is this the right recording?')

    period = estimate_period(strength, rate)
    print(f'pulse: {period:.4f}s ({60 / period:.1f} bpm if that is a quarter note)')

    opening = [o for o in onsets if o[0] < len(x) / rate / 3] or onsets[:4]
    phi = fit_phase(opening, period)
    errors = [(t, signed_mod(t - phi, period)) for t, _ in onsets]

    segments = segment(errors)
    print(f'\n{len(segments)} timing segment(s) — each step is a hop that moved the beat:\n')
    print(f'{"from":>8} {"to":>8} {"onsets":>7} {"error":>10} {"in 16ths":>9}')
    for seg in segments:
        print(f'{seg["start"]:8.3f} {seg["end"]:8.3f} {seg["count"]:7d} '
              f'{seg["error"] * 1000:8.1f}ms {seg["error"] / (period / 4):9.2f}')

    if log_path:
        start, hops = parse_log(log_path)
        if start is None:
            print(f'\n{log_path}: no "start ... at ...s" line found; '
                  'is this a Hoppper log panel dump?')
        else:
            report_log(start, hops, period, segments)


main()
