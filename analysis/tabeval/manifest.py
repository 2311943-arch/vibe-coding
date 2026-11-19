"""샘플 매니페스트와 정답(reference) 파일 로더.

매니페스트 예: samples/manifest.example.json
정답 파일 예:
  {"notes": [{"pitch": 60, "start": 0.0, "end": 0.25}],
   "chords": [{"name": "C", "start": 0.0, "end": 2.0}]}

권한 확인이 안 된 샘플은 평가에 쓰지 않는다(PRD 5, 8장).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .models import Chord, Note


class ManifestError(ValueError):
    pass


@dataclass
class Sample:
    id: str
    audio: Path
    notes: list[Note]
    chords: list[Chord]
    note: str = ''


def _read_reference(path: Path) -> tuple[list[Note], list[Chord]]:
    data = json.loads(path.read_text(encoding='utf-8'))
    notes = [Note(int(n['pitch']), float(n['start']), float(n['end'])) for n in data.get('notes', [])]
    chords = [Chord(str(c['name']), float(c['start']), float(c['end'])) for c in data.get('chords', [])]
    return notes, chords


def load_manifest(path: Path) -> tuple[list[Sample], list[str]]:
    """(사용할 샘플, 건너뛴 샘플 사유)"""
    base = path.parent
    data = json.loads(path.read_text(encoding='utf-8'))
    raw = data.get('samples')
    if not isinstance(raw, list):
        raise ManifestError("매니페스트에 'samples' 배열이 필요합니다.")

    samples: list[Sample] = []
    skipped: list[str] = []
    seen: set[str] = set()
    for entry in raw:
        sid = str(entry.get('id', '')).strip()
        if not sid:
            skipped.append('id가 없는 항목')
            continue
        if sid in seen:
            skipped.append(f'{sid}: id 중복')
            continue
        seen.add(sid)
        if entry.get('rights_confirmed') is not True:
            skipped.append(f'{sid}: rights_confirmed가 true가 아니어서 제외')
            continue
        audio = (base / entry.get('audio', '')).resolve()
        ref = (base / entry.get('reference', '')).resolve()
        if not audio.is_file():
            skipped.append(f'{sid}: 오디오 파일 없음 ({entry.get("audio")})')
            continue
        if not ref.is_file():
            skipped.append(f'{sid}: 정답 파일 없음 ({entry.get("reference")})')
            continue
        notes, chords = _read_reference(ref)
        samples.append(Sample(sid, audio, notes, chords, str(entry.get('note', ''))))
    return samples, skipped
