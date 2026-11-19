import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from guitartab import ChordEvent, NoteEvent, Quality, Score, TabNote, render_ascii
from guitartab.schema import UncertainSegment

TS_TYPES = Path(__file__).resolve().parents[2] / 'shared' / 'types' / 'analysis.ts'


def ts_fields(name: str) -> set[str]:
    src = TS_TYPES.read_text(encoding='utf-8')
    match = re.search(rf'export interface {name} \{{(.*?)\n\}}', src, re.S)
    assert match, f'{name} not found in {TS_TYPES}'
    # 인터페이스 멤버는 들여쓰기 2칸. 인라인 객체(quality 등)의 안쪽 필드는 4칸이라 제외된다.
    return set(re.findall(r'^ {2}(\w+)\??:', match.group(1), re.M))


@pytest.mark.parametrize(
    'ts_name, model',
    [('TabNote', TabNote), ('ChordEvent', ChordEvent), ('UncertainSegment', UncertainSegment)],
)
def test_python_schema_matches_typescript_contract(ts_name, model):
    assert set(model.model_fields) == ts_fields(ts_name)


def test_score_top_level_and_quality_match_typescript_contract():
    ts = ts_fields('AnalysisResult')
    assert set(Score.model_fields) == ts
    assert set(Quality.model_fields) == {'status', 'uncertain_segments', 'note'}


def test_schema_validation():
    with pytest.raises(ValidationError):
        ChordEvent(chord_name='C', start_time=2, end_time=2)
    with pytest.raises(ValidationError):
        TabNote(pitch=60, string_number=7, fret_number=0, start_time=0, duration=1)
    with pytest.raises(ValidationError):
        NoteEvent(pitch=60, start_time=0, duration=0)
    with pytest.raises(ValidationError):
        NoteEvent(pitch=60, start_time=0, duration=1, confidence=1.5)


def test_score_roundtrip_json():
    score = Score(
        job_id='j',
        status='COMPLETED',
        is_demo=True,
        duration=2.0,
        chords=[ChordEvent(chord_name='C', start_time=0, end_time=2)],
        tab=[TabNote(pitch=48, string_number=5, fret_number=3, start_time=0, duration=0.5)],
        quality=Quality(status='estimated'),
    )
    again = Score.model_validate_json(score.model_dump_json())
    assert again == score


def test_render_ascii_basic():
    tab = [
        TabNote(pitch=64, string_number=1, fret_number=0, start_time=0.0, duration=0.25),
        TabNote(pitch=76, string_number=1, fret_number=12, start_time=0.5, duration=0.25),
        TabNote(pitch=40, string_number=6, fret_number=0, start_time=4.0, duration=0.25),
    ]
    chords = [ChordEvent(chord_name='Em', start_time=0.0, end_time=8.0)]
    text = render_ascii(tab, chords)
    lines = text.splitlines()
    assert lines[0] == '# 0s - 4s'
    assert 'Em' in lines[1]
    e_line = next(line for line in lines if line.startswith('e|'))
    assert e_line[2] == '0'
    assert '12' in e_line  # 두 자리 프렛이 붙어서 찍힌다
    assert sum(1 for line in lines if line.startswith('# ')) == 2  # 4초씩 2행
    assert any(line.startswith('E|0') for line in lines)  # 두 번째 행 첫 칸
    # 두 번째 행에도 이어지는 코드 이름이 나온다.
    assert sum(1 for line in lines if line.strip() == 'Em' or line.strip().startswith('Em')) == 2


def test_render_ascii_rejects_bad_args_and_handles_empty():
    with pytest.raises(ValueError):
        render_ascii([], seconds_per_row=0)
    assert render_ascii([]).startswith('# 0s - 4s')
