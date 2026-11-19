"""PRD 11장의 분석 품질 지표.

- 음표 단위 precision / recall / F1, onset·offset 오차
- 코드 구간 단위 정확도
- 타브의 물리적 연주 가능 비율, 기타 음역 안에 드는 음표 비율

모두 외부 라이브러리 없이 numpy 없이도 동작하는 순수 파이썬이다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import mean

from .models import Chord, Note, TabNote

# 표준 튜닝 E2-A2-D3-G3-B3-E4. 키는 줄 번호(1=가장 높은 줄).
STANDARD_TUNING = {6: 40, 5: 45, 4: 50, 3: 55, 2: 59, 1: 64}
MAX_FRET = 15
GUITAR_MIN_PITCH = min(STANDARD_TUNING.values())
GUITAR_MAX_PITCH = max(STANDARD_TUNING.values()) + MAX_FRET


# ---------------------------------------------------------------- 음표

@dataclass
class NoteScores:
    precision: float
    recall: float
    f1: float
    n_ref: int
    n_est: int
    n_match: int
    onset_errors: list[float] = field(default_factory=list)  # 맞춘 음표의 |시작 시각 차이| (초)
    offset_errors: list[float] = field(default_factory=list)  # 맞춘 음표의 |끝 시각 차이| (초)

    @property
    def mean_onset_error(self) -> float | None:
        return mean(self.onset_errors) if self.onset_errors else None

    @property
    def mean_offset_error(self) -> float | None:
        return mean(self.offset_errors) if self.offset_errors else None


def note_scores(
    ref: list[Note],
    est: list[Note],
    onset_tolerance: float = 0.05,
    check_offset: bool = False,
    offset_ratio: float = 0.2,
    offset_min: float = 0.05,
) -> NoteScores:
    """같은 음정이고 시작 시각이 onset_tolerance 이내인 음표를 일대일로 짝짓는다(그리디, 가까운 순).

    check_offset=True이면 끝 시각도 max(offset_min, offset_ratio * 기준 음표 길이) 이내여야 맞춘 것으로 센다.
    """
    candidates: list[tuple[float, int, int]] = []
    for i, r in enumerate(ref):
        for j, e in enumerate(est):
            if r.pitch != e.pitch:
                continue
            d = abs(r.start - e.start)
            if d > onset_tolerance:
                continue
            if check_offset:
                tol = max(offset_min, offset_ratio * r.duration)
                if abs(r.end - e.end) > tol:
                    continue
            candidates.append((d, i, j))
    candidates.sort()

    used_ref: set[int] = set()
    used_est: set[int] = set()
    onset_errors: list[float] = []
    offset_errors: list[float] = []
    for d, i, j in candidates:
        if i in used_ref or j in used_est:
            continue
        used_ref.add(i)
        used_est.add(j)
        onset_errors.append(d)
        offset_errors.append(abs(ref[i].end - est[j].end))

    n_match = len(used_ref)
    precision = n_match / len(est) if est else 0.0
    recall = n_match / len(ref) if ref else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return NoteScores(precision, recall, f1, len(ref), len(est), n_match, onset_errors, offset_errors)


def guitar_range_coverage(notes: list[Note]) -> float:
    """전사된 음표 중 기타 음역(E2~E4+15프렛) 안에 드는 비율. 음표가 없으면 0."""
    if not notes:
        return 0.0
    ok = sum(1 for n in notes if GUITAR_MIN_PITCH <= n.pitch <= GUITAR_MAX_PITCH)
    return ok / len(notes)


# ---------------------------------------------------------------- 코드

_FLAT_TO_SHARP = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B', 'Fb': 'E'}
_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def _split_root(name: str) -> tuple[str, str] | None:
    if not name or name[0] not in 'ABCDEFG':
        return None
    root = name[0]
    rest = name[1:]
    if rest[:1] in ('#', 'b'):
        root += rest[0]
        rest = rest[1:]
    root = _FLAT_TO_SHARP.get(root, root)
    if root not in _ROOTS:
        return None
    return root, rest


def chord_key(name: str, mode: str = 'majmin') -> str | None:
    """코드명을 비교용 키로 바꾼다. 해석할 수 없거나 UNKNOWN이면 None(= 항상 틀림).

    mode='exact'  : 이명동음(Bb=A#)만 통일하고 나머지는 글자 그대로 비교
    mode='majmin' : 장/단 3화음으로 단순화 (C, C7, Cmaj7 -> C / Am, Am7 -> Am)
    mode='root'   : 근음만 비교
    """
    split = _split_root(name)
    if split is None:
        return None
    root, rest = split
    if mode == 'exact':
        return root + rest
    if mode == 'root':
        return root
    if mode == 'majmin':
        # 'm'으로 시작하되 'maj'가 아니면 단조. (dim, aug, sus 등은 이 단순화에서는 장조로 본다.)
        is_minor = rest.startswith('m') and not rest.startswith('maj')
        return root + ('m' if is_minor else '')
    raise ValueError(f'unknown mode: {mode}')


def chord_accuracy(ref: list[Chord], est: list[Chord], mode: str = 'majmin') -> float:
    """기준 코드 구간의 총 길이 중, 추정 코드가 같은 코드를 가리킨 시간의 비율."""
    total = sum(max(0.0, c.end - c.start) for c in ref)
    if total <= 0:
        return 0.0
    correct = 0.0
    for r in ref:
        rk = chord_key(r.name, mode)
        if rk is None:
            continue
        for e in est:
            if chord_key(e.name, mode) != rk:
                continue
            overlap = min(r.end, e.end) - max(r.start, e.start)
            if overlap > 0:
                correct += overlap
    return min(1.0, correct / total)


# ---------------------------------------------------------------- 타브

def is_consistent(note: TabNote) -> bool:
    open_pitch = STANDARD_TUNING.get(note.string)
    if open_pitch is None or not (0 <= note.fret <= MAX_FRET):
        return False
    return open_pitch + note.fret == note.pitch


@dataclass
class TabScores:
    consistent_ratio: float  # pitch가 줄·프렛과 일치하는 음표 비율
    playable_group_ratio: float  # 동시에 울리는 음 묶음 중 연주 가능한 묶음 비율
    n_notes: int
    n_groups: int


def tab_playability(
    tab: list[TabNote], simultaneous_window: float = 0.03, max_span: int = 4
) -> TabScores:
    """동시에 울리는 음(시작 시각 차 ≤ simultaneous_window)을 한 묶음으로 보고 연주 가능성을 검사한다.

    연주 가능 조건: (1) 모든 음표가 줄·프렛과 일치, (2) 한 묶음 안에서 같은 줄을 두 번 쓰지 않음,
    (3) 개방현(0)을 뺀 프렛 간격이 max_span 이하. 사람이 실제로 칠 수 있는지에 대한 평가는 별도로 필요하다.
    """
    if not tab:
        return TabScores(0.0, 0.0, 0, 0)

    ordered = sorted(tab, key=lambda n: n.start)
    groups: list[list[TabNote]] = []
    for note in ordered:
        if groups and note.start - groups[-1][0].start <= simultaneous_window:
            groups[-1].append(note)
        else:
            groups.append([note])

    playable = 0
    for g in groups:
        strings = [n.string for n in g]
        if len(set(strings)) != len(strings):
            continue
        if not all(is_consistent(n) for n in g):
            continue
        fretted = [n.fret for n in g if n.fret > 0]
        if fretted and max(fretted) - min(fretted) > max_span:
            continue
        playable += 1

    consistent = sum(1 for n in tab if is_consistent(n))
    return TabScores(consistent / len(tab), playable / len(groups), len(tab), len(groups))
