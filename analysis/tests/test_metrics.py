from tabeval.metrics import (
    chord_accuracy,
    chord_key,
    guitar_range_coverage,
    note_scores,
    tab_playability,
)
from tabeval.models import Chord, Note, TabNote


def test_note_scores_perfect_and_partial():
    ref = [Note(60, 0.0, 0.5), Note(64, 0.5, 1.0), Note(67, 1.0, 1.5)]
    perfect = note_scores(ref, list(ref))
    assert (perfect.precision, perfect.recall, perfect.f1) == (1.0, 1.0, 1.0)

    est = [Note(60, 0.02, 0.5), Note(64, 0.7, 1.0), Note(72, 1.0, 1.5)]
    s = note_scores(ref, est)
    # 60은 20ms 차이로 맞고, 64는 200ms 차이라 틀리고, 72는 음정이 다르다.
    assert s.n_match == 1
    assert s.precision == 1 / 3 and s.recall == 1 / 3
    assert abs(s.mean_onset_error - 0.02) < 1e-9


def test_note_matching_is_one_to_one():
    ref = [Note(60, 0.0, 0.5)]
    est = [Note(60, 0.0, 0.5), Note(60, 0.01, 0.5)]
    s = note_scores(ref, est)
    assert s.n_match == 1 and s.precision == 0.5 and s.recall == 1.0


def test_offset_check_rejects_wrong_end():
    ref = [Note(60, 0.0, 1.0)]
    est = [Note(60, 0.0, 0.3)]
    assert note_scores(ref, est).n_match == 1
    assert note_scores(ref, est, check_offset=True).n_match == 0


def test_empty_inputs_do_not_crash():
    s = note_scores([], [])
    assert (s.precision, s.recall, s.f1) == (0.0, 0.0, 0.0)


def test_chord_key_modes():
    assert chord_key('Bb', 'exact') == 'A#'
    assert chord_key('Cmaj7', 'majmin') == 'C'
    assert chord_key('Am7', 'majmin') == 'Am'
    assert chord_key('Cmaj7', 'root') == 'C'
    assert chord_key('UNKNOWN') is None


def test_chord_accuracy_is_time_weighted():
    ref = [Chord('C', 0, 2), Chord('G', 2, 4)]
    est = [Chord('C', 0, 2), Chord('Em', 2, 4)]
    assert chord_accuracy(ref, est) == 0.5
    # UNKNOWN은 정답으로 치지 않는다.
    assert chord_accuracy(ref, [Chord('UNKNOWN', 0, 4)]) == 0.0


def test_guitar_range():
    assert guitar_range_coverage([Note(40, 0, 1), Note(79, 0, 1), Note(39, 0, 1), Note(80, 0, 1)]) == 0.5


def test_tab_playability():
    # C 코드 x32010 동시 타격: 연주 가능
    c = [
        TabNote(48, 5, 3, 0.0, 1), TabNote(52, 4, 2, 0.0, 1), TabNote(55, 3, 0, 0.0, 1),
        TabNote(60, 2, 1, 0.0, 1), TabNote(64, 1, 0, 0.0, 1),
    ]
    assert tab_playability(c).playable_group_ratio == 1.0

    # 같은 줄 두 번 / 프렛 간격 초과 / pitch 불일치
    same_string = [TabNote(48, 5, 3, 0.0, 1), TabNote(49, 5, 4, 0.0, 1)]
    wide = [TabNote(41, 6, 1, 0.0, 1), TabNote(60, 4, 10, 0.0, 1)]
    wrong_pitch = [TabNote(99, 5, 3, 0.0, 1)]
    for bad in (same_string, wide, wrong_pitch):
        assert tab_playability(bad).playable_group_ratio == 0.0

    assert tab_playability([]).n_notes == 0
