"""평가에 쓰는 기본 데이터 타입. PRD 6장(NoteEvent, ChordEvent, TabNote)과 같은 의미를 갖는다."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Note:
    pitch: int  # MIDI 음정
    start: float  # 초
    end: float  # 초

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass(frozen=True)
class Chord:
    name: str  # 'C', 'Am', 'Fmaj7', ... 확정하지 못한 구간은 'UNKNOWN'
    start: float
    end: float


@dataclass(frozen=True)
class TabNote:
    pitch: int
    string: int  # 1(가장 높은 줄) ~ 6(가장 낮은 줄)
    fret: int
    start: float
    duration: float
