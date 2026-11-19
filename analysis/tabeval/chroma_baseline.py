"""코드 추정 기준선(baseline). numpy/scipy만 사용한다.

크로마(12음) 특징을 장/단 3화음 템플릿과 비교하고, 시간 축 Viterbi로 코드가 너무 자주 바뀌지 않게 다듬는다.
PRD 4.6의 "전사 음표 + 크로마 + 음악 규칙" 접근 중 크로마 부분만 담은 최소 구현이며,
7th/전위/카포 등은 다루지 않는다. 다른 모델과 비교하기 위한 출발점으로 쓴다.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import stft

from .models import Chord

ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
FMIN, FMAX = 65.0, 2000.0  # 기타 기본음 ~ 주요 배음 범위(Hz)


def load_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    sr, data = wavfile.read(str(path))
    data = data.astype(np.float32)
    if data.dtype.kind == 'i' or np.max(np.abs(data)) > 1.5:
        peak = np.max(np.abs(data)) or 1.0
        data = data / peak
    if data.ndim == 2:
        data = data.mean(axis=1)
    return data, int(sr)


def chroma_frames(audio: np.ndarray, sr: int, hop_seconds: float = 0.1) -> tuple[np.ndarray, np.ndarray]:
    """(프레임 시각 배열, 정규화된 크로마 [프레임, 12])를 돌려준다."""
    nperseg = 8192
    hop = int(hop_seconds * sr)
    freqs, times, z = stft(audio, fs=sr, nperseg=nperseg, noverlap=nperseg - hop, boundary=None, padded=False)
    mag = np.abs(z)

    valid = (freqs >= FMIN) & (freqs <= FMAX)
    pitch_class = np.round(12 * np.log2(freqs[valid] / 440.0) + 69).astype(int) % 12
    chroma = np.zeros((len(times), 12))
    for pc in range(12):
        chroma[:, pc] = mag[valid][pitch_class == pc].sum(axis=0)

    norm = np.linalg.norm(chroma, axis=1, keepdims=True)
    chroma = np.divide(chroma, norm, out=np.zeros_like(chroma), where=norm > 1e-9)
    # stft 프레임 시각은 창의 중심이다.
    return times, chroma


def _templates() -> tuple[list[str], np.ndarray]:
    names: list[str] = []
    rows: list[np.ndarray] = []
    for r in range(12):
        major = np.zeros(12)
        major[[r, (r + 4) % 12, (r + 7) % 12]] = 1.0
        names.append(ROOTS[r])
        rows.append(major / np.linalg.norm(major))
        minor = np.zeros(12)
        minor[[r, (r + 3) % 12, (r + 7) % 12]] = 1.0
        names.append(ROOTS[r] + 'm')
        rows.append(minor / np.linalg.norm(minor))
    return names, np.stack(rows)


def estimate_chords(audio: np.ndarray, sr: int, hop_seconds: float = 0.1, stay_bonus: float = 0.15) -> list[Chord]:
    times, chroma = chroma_frames(audio, sr, hop_seconds)
    if len(times) == 0:
        return []
    names, templates = _templates()
    score = chroma @ templates.T  # [프레임, 24]

    # Viterbi: 같은 코드를 유지하면 stay_bonus를 더해 준다.
    n, k = score.shape
    best = np.zeros((n, k))
    back = np.zeros((n, k), dtype=int)
    best[0] = score[0]
    for t in range(1, n):
        stay = best[t - 1] + stay_bonus
        move_from = int(np.argmax(best[t - 1]))
        move = best[t - 1][move_from]
        for s in range(k):
            if stay[s] >= move:
                best[t, s] = stay[s] + score[t, s]
                back[t, s] = s
            else:
                best[t, s] = move + score[t, s]
                back[t, s] = move_from
    path = np.zeros(n, dtype=int)
    path[-1] = int(np.argmax(best[-1]))
    for t in range(n - 1, 0, -1):
        path[t - 1] = back[t, path[t]]

    # 프레임 -> 구간. 프레임 중심 시각의 중간점을 경계로 쓴다.
    boundaries = np.concatenate(([0.0], (times[:-1] + times[1:]) / 2, [times[-1] + hop_seconds / 2]))
    chords: list[Chord] = []
    for t in range(n):
        name = names[path[t]]
        if chords and chords[-1].name == name:
            chords[-1] = Chord(name, chords[-1].start, float(boundaries[t + 1]))
        else:
            chords.append(Chord(name, float(boundaries[t]), float(boundaries[t + 1])))
    return chords


class ChromaChordEstimator:
    name = 'chroma-template-baseline'

    def estimate(self, wav_path: Path) -> list[Chord]:
        audio, sr = load_wav_mono(wav_path)
        return estimate_chords(audio, sr)
