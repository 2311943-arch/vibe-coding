"""악보 데이터 스키마 (PRD 6장). 필드 이름은 API 응답과 shared/types/analysis.ts와 같다.

이 스키마가 시스템의 기준이다. 화면 렌더러(SVG, ASCII 등)는 이 데이터를 읽기만 하고,
렌더러를 바꿔도 분석 결과 데이터는 바뀌지 않는다.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class NoteEvent(BaseModel):
    pitch: int = Field(ge=0, le=127, description='MIDI 음정')
    start_time: float = Field(ge=0, description='시작 시간(초)')
    duration: float = Field(gt=0, description='지속 시간(초)')
    confidence: float | None = Field(default=None, ge=0, le=1, description='모델 신뢰도(보정 전일 수 있음)')
    source_track: str = 'mix'


class ChordEvent(BaseModel):
    chord_name: str = Field(min_length=1, description="코드명. 확정하지 못하면 'UNKNOWN'")
    start_time: float = Field(ge=0)
    end_time: float = Field(gt=0)
    confidence: float | None = Field(default=None, ge=0, le=1)
    alternatives: list[str] = Field(default_factory=list)

    @model_validator(mode='after')
    def _end_after_start(self) -> 'ChordEvent':
        if self.end_time <= self.start_time:
            raise ValueError('end_time must be greater than start_time')
        return self


class TabNote(BaseModel):
    pitch: int = Field(ge=0, le=127)
    string_number: int = Field(ge=1, le=6, description='1(가장 높은 줄) ~ 6(가장 낮은 줄)')
    fret_number: int = Field(ge=0, le=24)
    start_time: float = Field(ge=0)
    duration: float = Field(gt=0)


class UnplayableNote(BaseModel):
    """타브로 옮기지 못한 음표와 그 이유. 조용히 버리지 않고 결과에 남긴다."""

    note: NoteEvent
    reason: Literal['OUT_OF_RANGE', 'TOO_MANY_VOICES', 'NO_PLAYABLE_FINGERING']


class UncertainSegment(BaseModel):
    start_time: float
    end_time: float
    reason: str


class Quality(BaseModel):
    status: Literal['estimated', 'partial']
    uncertain_segments: list[UncertainSegment] = Field(default_factory=list)
    note: str | None = None


class Score(BaseModel):
    """분석 결과 전체. GET /api/analyses/{id}/result의 본문과 같은 모양이다."""

    job_id: str
    status: Literal['COMPLETED', 'PARTIAL']
    is_demo: bool = False
    duration: float = Field(ge=0)
    chords: list[ChordEvent] = Field(default_factory=list)
    tab: list[TabNote] = Field(default_factory=list)
    quality: Quality
