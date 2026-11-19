"""하니스 동작 확인용 합성 기타 소리.

주의: 합성음은 실제 영상 속 연주(보컬, 리버브, 피킹 노이즈, 마이크 환경)와 전혀 다르다.
이 데이터로 얻은 점수는 "코드가 맞게 돌아가는지" 확인하는 용도이며, 기술 타당성의 증거가 아니다.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from scipy.io import wavfile

from .metrics import STANDARD_TUNING
from .models import Chord, Note

SAMPLE_RATE = 22050

# 코드 이름 -> {줄 번호: 프렛}
SHAPES: dict[str, dict[int, int]] = {
    'C': {5: 3, 4: 2, 3: 0, 2: 1, 1: 0},
    'G': {6: 3, 5: 2, 4: 0, 3: 0, 2: 0, 1: 3},
    'Am': {5: 0, 4: 2, 3: 2, 2: 1, 1: 0},
    'F': {4: 3, 3: 2, 2: 1, 1: 1},
}
PATTERN = [0, 1, 2, 3, 2, 1, 2, 3]  # 낮은 줄부터 센 순번


def _pluck(freq: float, seconds: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    signal = np.zeros_like(t)
    for k in range(1, 7):  # 배음 6개, 높은 배음일수록 빨리 사라진다
        signal += (1.0 / k) * np.sin(2 * np.pi * freq * k * t) * np.exp(-t * (3.0 + 2.0 * k))
    return signal


def synth_progression(
    chord_names: list[str], chord_seconds: float = 2.0, step_seconds: float = 0.25
) -> tuple[np.ndarray, list[Note], list[Chord]]:
    """코드 진행을 8분음표 아르페지오로 합성하고, 정답 음표·코드를 함께 돌려준다."""
    sr = SAMPLE_RATE
    total = len(chord_names) * chord_seconds
    tone_seconds = 0.9
    audio = np.zeros(int((total + tone_seconds) * sr))
    notes: list[Note] = []
    chords: list[Chord] = []

    for index, name in enumerate(chord_names):
        shape = SHAPES[name]
        start = index * chord_seconds
        chords.append(Chord(name, start, start + chord_seconds))
        strings = sorted(shape, reverse=True)  # 낮은 줄(6번)부터
        for step, p in enumerate(PATTERN):
            string = strings[p]
            pitch = STANDARD_TUNING[string] + shape[string]
            freq = 440.0 * 2 ** ((pitch - 69) / 12)
            onset = start + step * step_seconds
            tone = _pluck(freq, tone_seconds)
            i0 = int(onset * sr)
            audio[i0 : i0 + len(tone)] += tone
            notes.append(Note(pitch, onset, onset + step_seconds))

    peak = np.max(np.abs(audio)) or 1.0
    return (audio / peak * 0.8).astype(np.float32), notes, chords


def write_wav(path: Path, audio: np.ndarray, sr: int = SAMPLE_RATE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(str(path), sr, (np.clip(audio, -1, 1) * 32767).astype(np.int16))
