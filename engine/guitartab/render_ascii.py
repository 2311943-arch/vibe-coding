"""ASCII 타브 렌더러. 미리보기·디버깅·텍스트 내보내기용이다.

화면의 정식 렌더링은 웹의 SVG 악보(4단계)가 맡는다. 이 함수는 schema.py의 데이터를 읽기만 한다.
시간 눈금(resolution)이 너무 거칠어 같은 줄·같은 칸에 두 음이 겹치면 먼저 온 음만 표시된다.
"""

from __future__ import annotations

from .schema import ChordEvent, TabNote

_STRING_LABELS = {1: 'e', 2: 'B', 3: 'G', 4: 'D', 5: 'A', 6: 'E'}


def render_ascii(
    tab: list[TabNote],
    chords: list[ChordEvent] | None = None,
    seconds_per_row: float = 4.0,
    resolution: float = 0.125,
    cell: int = 3,
) -> str:
    if seconds_per_row <= 0 or resolution <= 0 or cell < 3:
        raise ValueError('seconds_per_row, resolution must be positive and cell >= 3')
    slots_per_row = max(1, round(seconds_per_row / resolution))
    width = slots_per_row * cell

    # 행 수: 마지막 음표가 시작하는 칸, 마지막 코드가 끝나기 직전 칸까지 (끝 경계가 빈 행을 만들지 않게).
    last_slots = [round(n.start_time / resolution) for n in tab]
    last_slots += [round(c.end_time / resolution) - 1 for c in chords or []]
    row_count = max(1, max(last_slots, default=0) // slots_per_row + 1)

    # rows[r] = {줄 번호: 문자 리스트}, 코드 줄
    string_rows = [{s: ['-'] * width for s in range(1, 7)} for _ in range(row_count)]
    chord_rows = [[' '] * width for _ in range(row_count)]

    def put(buf: list[str], col: int, text: str, only_if_free: bool) -> None:
        for k, ch in enumerate(text):
            pos = col * cell + k
            if pos >= width:
                return
            if only_if_free and buf[pos] != '-' and buf[pos] != ' ':
                return
            buf[pos] = ch

    for n in tab:
        slot = round(n.start_time / resolution)
        row, col = divmod(slot, slots_per_row)
        buf = string_rows[row][n.string_number]
        if buf[col * cell] == '-':  # 먼저 온 음 우선
            put(buf, col, str(n.fret_number), only_if_free=False)

    for c in chords or []:
        first = round(c.start_time / resolution) // slots_per_row
        last = max(first, (round(c.end_time / resolution) - 1) // slots_per_row)
        for row in range(first, min(last, row_count - 1) + 1):
            col = max(0, round(c.start_time / resolution) - row * slots_per_row)
            put(chord_rows[row], col, c.chord_name, only_if_free=True)

    lines: list[str] = []
    for r in range(row_count):
        start = r * seconds_per_row
        lines.append(f'# {start:g}s - {start + seconds_per_row:g}s')
        if chords:
            lines.append('  ' + ''.join(chord_rows[r]).rstrip())
        for s in range(1, 7):
            lines.append(f'{_STRING_LABELS[s]}|' + ''.join(string_rows[r][s]) + '|')
        lines.append('')
    return '\n'.join(lines).rstrip() + '\n'
