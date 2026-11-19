"""MIDI 음정 → 기타 줄·프렛 변환 (PRD 4.7).

중요한 한계: 같은 음정은 여러 줄·프렛에서 낼 수 있으므로, 이 변환은 원 연주자의 운지를 복원하지 않는다.
"추출된 음정을 사람이 칠 수 있게 재배치한 추정 타브"를 만든다.

방법:
1. 거의 동시에 시작하는 음표를 한 묶음(group)으로 본다.
2. 묶음마다 가능한 (줄, 프렛) 조합을 모두 만들되, 같은 줄 중복과 손 벌림(max_span 프렛 초과)을 제거한다.
3. 묶음 사이를 Viterbi(동적 계획법)로 이어, 낮은 포지션과 적은 손 이동을 선호하는 경로를 고른다.
4. 칠 수 없는 음표는 조용히 버리지 않고 이유와 함께 `unplayable`로 돌려준다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .schema import NoteEvent, TabNote, UnplayableNote

# 표준 튜닝 E2-A2-D3-G3-B3-E4. 키는 줄 번호(1=가장 높은 줄).
STANDARD_TUNING: dict[int, int] = {6: 40, 5: 45, 4: 50, 3: 55, 2: 59, 1: 64}


@dataclass(frozen=True)
class ArrangeConfig:
    tuning: dict[int, int] = field(default_factory=lambda: dict(STANDARD_TUNING))
    max_fret: int = 15
    max_span: int = 4  # 개방현을 뺀 한 묶음 안의 최대 프렛 간격
    group_window: float = 0.03  # 초. 이 안에 시작하는 음은 동시에 친 것으로 본다.
    max_voices: int = 6
    max_candidates: int = 64  # 묶음마다 DP에 넘길 후보 수 상한


@dataclass
class ArrangeResult:
    tab: list[TabNote]
    unplayable: list[UnplayableNote]

    @property
    def coverage(self) -> float:
        """입력 음표 중 타브로 옮긴 비율. 입력이 없으면 1.0."""
        total = len(self.tab) + len(self.unplayable)
        return 1.0 if total == 0 else len(self.tab) / total


# (pitch, string, fret)
Candidate = tuple[tuple[int, int, int], ...]


def _options(pitch: int, cfg: ArrangeConfig) -> list[tuple[int, int]]:
    out = []
    for string, open_pitch in sorted(cfg.tuning.items()):
        fret = pitch - open_pitch
        if 0 <= fret <= cfg.max_fret:
            out.append((string, fret))
    return out


def is_playable_group(notes: list[TabNote], cfg: ArrangeConfig | None = None) -> bool:
    """동시에 울리는 TabNote 묶음이 물리적으로 말이 되는지: 같은 줄 중복 없음, pitch 일치, 손 벌림 한도."""
    cfg = cfg or ArrangeConfig()
    strings = [n.string_number for n in notes]
    if len(set(strings)) != len(strings):
        return False
    for n in notes:
        open_pitch = cfg.tuning.get(n.string_number)
        if open_pitch is None or not (0 <= n.fret_number <= cfg.max_fret):
            return False
        if open_pitch + n.fret_number != n.pitch:
            return False
    fretted = [n.fret_number for n in notes if n.fret_number > 0]
    return not fretted or max(fretted) - min(fretted) <= cfg.max_span


def _candidates(pitches: list[int], cfg: ArrangeConfig) -> list[Candidate]:
    opts = [_options(p, cfg) for p in pitches]
    results: list[Candidate] = []

    def rec(i: int, used: frozenset[int], chosen: list[tuple[int, int, int]], lo: int | None, hi: int | None) -> None:
        if i == len(pitches):
            results.append(tuple(chosen))
            return
        for string, fret in opts[i]:
            if string in used:
                continue
            nlo, nhi = lo, hi
            if fret > 0:
                nlo = fret if lo is None else min(lo, fret)
                nhi = fret if hi is None else max(hi, fret)
                if nhi - nlo > cfg.max_span:
                    continue
            rec(i + 1, used | {string}, chosen + [(pitches[i], string, fret)], nlo, nhi)

    rec(0, frozenset(), [], None, None)
    return results


def _fretted(c: Candidate) -> list[int]:
    return [f for _, _, f in c if f > 0]


def _intrinsic(c: Candidate) -> float:
    fretted = _fretted(c)
    span = (max(fretted) - min(fretted)) if fretted else 0
    return 0.1 * sum(fretted) + 0.3 * span


def _position(c: Candidate) -> float | None:
    fretted = _fretted(c)
    return sum(fretted) / len(fretted) if fretted else None


def _mean_string(c: Candidate) -> float:
    return sum(s for _, s, _ in c) / len(c)


def _transition(a: Candidate, b: Candidate) -> float:
    pa, pb = _position(a), _position(b)
    move = 0.0 if pa is None or pb is None else 0.5 * abs(pa - pb)
    return move + 0.05 * abs(_mean_string(a) - _mean_string(b))


def _group_notes(notes: list[NoteEvent], window: float) -> list[list[NoteEvent]]:
    groups: list[list[NoteEvent]] = []
    for note in sorted(notes, key=lambda n: (n.start_time, n.pitch)):
        if groups and note.start_time - groups[-1][0].start_time <= window:
            groups[-1].append(note)
        else:
            groups.append([note])
    return groups


def arrange(notes: list[NoteEvent], cfg: ArrangeConfig | None = None) -> ArrangeResult:
    cfg = cfg or ArrangeConfig()
    unplayable: list[UnplayableNote] = []

    # 1) 묶음별 후보 만들기
    group_notes: list[list[NoteEvent]] = []
    group_cands: list[list[Candidate]] = []
    for group in _group_notes(notes, cfg.group_window):
        # 같은 음정이 겹쳐 들어오면 가장 긴 것 하나로 합친다(한 줄에서 같은 음을 두 번 낼 수 없다).
        by_pitch: dict[int, NoteEvent] = {}
        for n in group:
            if n.pitch not in by_pitch or n.duration > by_pitch[n.pitch].duration:
                by_pitch[n.pitch] = n
        members = sorted(by_pitch.values(), key=lambda n: n.pitch)

        in_range = []
        for n in members:
            if _options(n.pitch, cfg):
                in_range.append(n)
            else:
                unplayable.append(UnplayableNote(note=n, reason='OUT_OF_RANGE'))

        if len(in_range) > cfg.max_voices:
            # 가장 낮은 음(베이스)과 가장 높은 음(멜로디)을 지키고, 나머지는 신뢰도, 음정 순으로 남긴다.
            low, high = in_range[0], in_range[-1]
            middle = sorted(in_range[1:-1], key=lambda n: (-(n.confidence or 0.0), n.pitch))
            keep = {id(low), id(high), *(id(n) for n in middle[: cfg.max_voices - 2])}
            for n in in_range:
                if id(n) not in keep:
                    unplayable.append(UnplayableNote(note=n, reason='TOO_MANY_VOICES'))
            in_range = [n for n in in_range if id(n) in keep]

        cands = _candidates([n.pitch for n in in_range], cfg) if in_range else []
        while not cands and len(in_range) > 1:
            # 손 벌림 때문에 불가능하면, 멜로디(가장 높은 음)를 지키는 쪽으로 한 음씩 뺀다.
            drop = 0 if len(in_range) == 2 else len(in_range) // 2
            unplayable.append(UnplayableNote(note=in_range[drop], reason='NO_PLAYABLE_FINGERING'))
            in_range = in_range[:drop] + in_range[drop + 1 :]
            cands = _candidates([n.pitch for n in in_range], cfg)

        if not cands:
            continue
        cands.sort(key=lambda c: (_intrinsic(c), c))
        group_notes.append(in_range)
        group_cands.append(cands[: cfg.max_candidates])

    # 2) Viterbi
    tab: list[TabNote] = []
    if group_cands:
        cost: list[list[float]] = [[_intrinsic(c) for c in group_cands[0]]]
        back: list[list[int]] = [[0] * len(group_cands[0])]
        for i in range(1, len(group_cands)):
            row_cost, row_back = [], []
            for c in group_cands[i]:
                best_j, best = 0, float('inf')
                for j, p in enumerate(group_cands[i - 1]):
                    total = cost[i - 1][j] + _transition(p, c)
                    if total < best:
                        best, best_j = total, j
                row_cost.append(best + _intrinsic(c))
                row_back.append(best_j)
            cost.append(row_cost)
            back.append(row_back)

        k = min(range(len(cost[-1])), key=lambda idx: cost[-1][idx])
        chosen: list[Candidate] = [()] * len(group_cands)
        for i in range(len(group_cands) - 1, -1, -1):
            chosen[i] = group_cands[i][k]
            k = back[i][k]

        for notes_in_group, cand in zip(group_notes, chosen):
            for note, (_, string, fret) in zip(notes_in_group, cand):
                tab.append(
                    TabNote(
                        pitch=note.pitch,
                        string_number=string,
                        fret_number=fret,
                        start_time=note.start_time,
                        duration=note.duration,
                    )
                )

    tab.sort(key=lambda t: (t.start_time, t.string_number))
    unplayable.sort(key=lambda u: (u.note.start_time, u.note.pitch))
    return ArrangeResult(tab=tab, unplayable=unplayable)
