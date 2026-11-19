"""모델 어댑터 인터페이스 (PRD 2장 "AI 모델은 인터페이스 뒤에 감춰 교체 가능하게").

평가 하니스는 이 인터페이스만 알고, 구체 모델은 어댑터가 감싼다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from .models import Chord, Note


class AdapterUnavailable(RuntimeError):
    """필요한 라이브러리가 설치되어 있지 않을 때."""


class Transcriber(Protocol):
    name: str

    def transcribe(self, wav_path: Path) -> list[Note]: ...


class ChordEstimator(Protocol):
    name: str

    def estimate(self, wav_path: Path) -> list[Chord]: ...


class BasicPitchTranscriber:
    """Spotify Basic Pitch 기준선 어댑터.

    !! 아직 실행해 보지 못했다 !! 이 개발 환경에는 basic-pitch가 설치되어 있지 않다.
    basic_pitch.inference.predict의 반환값 (model_output, midi_data, note_events)에서
    note_events의 앞 3개 값(시작, 끝, 음정)을 쓰는 가정으로 작성했다. 설치한 버전에서 먼저 확인할 것.
    """

    name = 'basic-pitch'

    def __init__(self) -> None:
        try:
            from basic_pitch.inference import predict  # type: ignore
        except ImportError as exc:
            raise AdapterUnavailable('basic-pitch가 설치되어 있지 않습니다.') from exc
        self._predict = predict

    def transcribe(self, wav_path: Path) -> list[Note]:
        _, _, note_events = self._predict(str(wav_path))
        return [Note(int(ev[2]), float(ev[0]), float(ev[1])) for ev in note_events]


def available_transcribers() -> tuple[list[Transcriber], list[str]]:
    """(사용 가능한 전사 어댑터, 건너뛴 어댑터 사유)"""
    usable: list[Transcriber] = []
    skipped: list[str] = []
    for factory in (BasicPitchTranscriber,):
        try:
            usable.append(factory())
        except AdapterUnavailable as exc:
            skipped.append(f'{factory.__name__}: {exc}')
    return usable, skipped
