import pytest

from guitartab import ArrangeConfig, NoteEvent, TabNote, arrange, is_playable_group


def ev(pitch, start=0.0, dur=0.25, conf=None):
    return NoteEvent(pitch=pitch, start_time=start, duration=dur, confidence=conf)


def shape(tab):
    return {(t.string_number, t.fret_number) for t in tab}


def test_open_c_chord_gets_the_open_shape():
    result = arrange([ev(p) for p in (48, 52, 55, 60, 64)])
    assert shape(result.tab) == {(5, 3), (4, 2), (3, 0), (2, 1), (1, 0)}
    assert result.unplayable == []
    assert result.coverage == 1.0


def test_single_note_melody_stays_on_one_string():
    # E4 F#4 G4 A4: 1번 줄 0,2,3,5프렛이 가장 낮은 포지션이고 손 이동도 적다.
    notes = [ev(p, start=i * 0.5) for i, p in enumerate((64, 66, 67, 69))]
    tab = arrange(notes).tab
    assert [(t.string_number, t.fret_number) for t in tab] == [(1, 0), (1, 2), (1, 3), (1, 5)]


def test_arpeggio_progression_is_fully_playable():
    chords = {
        'C': [48, 52, 55, 60, 64],
        'G': [43, 47, 50, 55, 59, 67],
        'Am': [45, 52, 57, 60, 64],
        'Fmaj7': [53, 57, 60, 64],
    }
    notes = []
    t = 0.0
    for pitches in chords.values():
        pattern = [0, 1, 2, 3, 2, 1, 2, 3]
        for step in pattern:
            notes.append(ev(pitches[step], start=t))
            t += 0.25
    result = arrange(notes)
    assert len(result.tab) == len(notes) and result.unplayable == []
    for tn in result.tab:
        assert is_playable_group([tn])

    # 자연스러운 운지인지도 확인: 각 코드 마디의 음은 그 코드의 오픈 코드 모양 안에서 나와야 한다.
    open_shapes = [
        {(5, 3), (4, 2), (3, 0), (2, 1), (1, 0)},  # C
        {(6, 3), (5, 2), (4, 0), (3, 0), (2, 0), (1, 3)},  # G
        {(5, 0), (4, 2), (3, 2), (2, 1), (1, 0)},  # Am
        {(4, 3), (3, 2), (2, 1), (1, 0)},  # Fmaj7
    ]
    for bar, allowed in enumerate(open_shapes):
        bar_notes = [tn for tn in result.tab if bar * 2.0 <= tn.start_time < bar * 2.0 + 2.0]
        assert len(bar_notes) == 8
        used = {(tn.string_number, tn.fret_number) for tn in bar_notes}
        assert used <= allowed, (bar, used - allowed)


def test_every_simultaneous_group_is_playable():
    # 여러 화음을 이어서 쳐도 묶음마다 연주 가능해야 한다.
    voicings = [[40, 47, 52, 56, 59, 64], [45, 52, 57, 61, 64], [43, 47, 50, 55, 59, 67], [41, 48, 53, 57, 60]]
    notes = [ev(p, start=i) for i, v in enumerate(voicings) for p in v]
    result = arrange(notes)
    by_start: dict[float, list[TabNote]] = {}
    for tn in result.tab:
        by_start.setdefault(tn.start_time, []).append(tn)
    assert by_start, 'no output'
    for group in by_start.values():
        assert is_playable_group(group), group
    assert result.coverage > 0.8


def test_out_of_range_notes_are_reported_not_dropped_silently():
    result = arrange([ev(30, 0.0), ev(60, 0.0), ev(90, 1.0)])
    assert [u.reason for u in result.unplayable] == ['OUT_OF_RANGE', 'OUT_OF_RANGE']
    assert [u.note.pitch for u in result.unplayable] == [30, 90]
    assert [t.pitch for t in result.tab] == [60]
    assert result.coverage == pytest.approx(1 / 3)


def test_too_many_voices_keeps_bass_and_melody():
    pitches = [40, 45, 50, 55, 59, 64, 67]  # 7음 동시
    result = arrange([ev(p) for p in pitches])
    assert len(result.tab) == 6
    assert [(u.note.pitch, u.reason) for u in result.unplayable] == [(64, 'TOO_MANY_VOICES')]
    kept = {t.pitch for t in result.tab}
    assert 40 in kept and 67 in kept


def test_conflicting_notes_drop_lower_one_and_say_why():
    # 40(E2)과 41(F2)은 둘 다 6번 줄에서만 낼 수 있다.
    result = arrange([ev(40), ev(41)])
    assert [t.pitch for t in result.tab] == [41]
    assert [(u.note.pitch, u.reason) for u in result.unplayable] == [(40, 'NO_PLAYABLE_FINGERING')]


def test_duplicate_pitches_in_one_group_are_merged():
    result = arrange([ev(60, 0.0, 0.2), ev(60, 0.01, 0.5)])
    assert len(result.tab) == 1
    assert result.tab[0].duration == 0.5


def test_deterministic_and_empty():
    notes = [ev(p, start=i * 0.25) for i, p in enumerate((55, 59, 62, 67, 62, 59))]
    assert arrange(notes).tab == arrange(list(notes)).tab
    empty = arrange([])
    assert empty.tab == [] and empty.unplayable == [] and empty.coverage == 1.0


def test_respects_custom_fret_limit():
    # 12프렛까지만 허용하면 E4+13(= 77)은 칠 수 없다.
    cfg = ArrangeConfig(max_fret=12)
    result = arrange([ev(77)], cfg)
    assert result.tab == [] and result.unplayable[0].reason == 'OUT_OF_RANGE'
    assert len(arrange([ev(77)]).tab) == 1  # 기본(15프렛)에서는 가능


def test_is_playable_group_rejections():
    ok = TabNote(pitch=48, string_number=5, fret_number=3, start_time=0, duration=1)
    assert is_playable_group([ok])
    same_string = [ok, TabNote(pitch=49, string_number=5, fret_number=4, start_time=0, duration=1)]
    wrong_pitch = [TabNote(pitch=99, string_number=5, fret_number=3, start_time=0, duration=1)]
    wide = [
        TabNote(pitch=41, string_number=6, fret_number=1, start_time=0, duration=1),
        TabNote(pitch=60, string_number=4, fret_number=10, start_time=0, duration=1),
    ]
    for bad in (same_string, wrong_pitch, wide):
        assert not is_playable_group(bad)
