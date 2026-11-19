"""2단계(PRD Phase 1) 악보 데이터 엔진: 스키마, MIDI → 기타 줄·프렛 변환, 타브 렌더링."""

from .fretting import ArrangeConfig, ArrangeResult, arrange, is_playable_group
from .render_ascii import render_ascii
from .schema import ChordEvent, NoteEvent, Quality, Score, TabNote, UnplayableNote

__all__ = [
    'ArrangeConfig',
    'ArrangeResult',
    'ChordEvent',
    'NoteEvent',
    'Quality',
    'Score',
    'TabNote',
    'UnplayableNote',
    'arrange',
    'is_playable_group',
    'render_ascii',
]
