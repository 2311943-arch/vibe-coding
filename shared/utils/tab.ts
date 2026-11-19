// 기타 줄·프렛 계산과 악보 행(row) 레이아웃. 렌더링(SVG)과 분리해 둔 순수 함수들이다.

/** 표준 튜닝 E2-A2-D3-G3-B3-E4. 키는 줄 번호(1=가장 높은 줄, 6=가장 낮은 줄), 값은 개방현 MIDI 음정. */
export const STANDARD_TUNING: Record<number, number> = {
  6: 40,
  5: 45,
  4: 50,
  3: 55,
  2: 59,
  1: 64,
}

export const MAX_FRET = 15

/** 줄·프렛이 만드는 MIDI 음정. 범위를 벗어나면 null. */
export function pitchOf(stringNumber: number, fretNumber: number): number | null {
  const open = STANDARD_TUNING[stringNumber]
  if (open === undefined) return null
  if (!Number.isInteger(fretNumber) || fretNumber < 0 || fretNumber > MAX_FRET) return null
  return open + fretNumber
}

/** 타브 음표의 pitch가 줄·프렛과 일치하는지(= 물리적으로 말이 되는 타브인지) 검사한다. */
export function isConsistentTabNote(note: TabNote): boolean {
  return pitchOf(note.string_number, note.fret_number) === note.pitch
}

export interface SheetRow {
  index: number
  start: number
  end: number
  /** 이 행과 겹치는 코드 구간. 시간은 행 안으로 잘라 낸 값. */
  chords: ChordEvent[]
  notes: TabNote[]
}

/**
 * 전체 곡을 rowSeconds 단위의 행으로 나눈다. 같은 행 안에서는 코드와 타브가 같은 시간 눈금을 쓰므로
 * 위아래로 정렬된다. 행 경계를 넘는 코드는 양쪽 행에 모두 나타난다.
 */
export function splitIntoRows(
  chords: ChordEvent[],
  tab: TabNote[],
  duration: number,
  rowSeconds: number,
): SheetRow[] {
  if (!(rowSeconds > 0)) throw new Error('rowSeconds must be positive')
  const total = Math.max(
    duration,
    ...chords.map((c) => c.end_time),
    ...tab.map((n) => n.start_time + n.duration),
    0,
  )
  const rowCount = Math.max(1, Math.ceil(total / rowSeconds))
  const rows: SheetRow[] = []

  for (let i = 0; i < rowCount; i++) {
    const start = i * rowSeconds
    const end = start + rowSeconds
    rows.push({
      index: i,
      start,
      end,
      chords: chords
        .filter((c) => c.end_time > start && c.start_time < end)
        .map((c) => ({
          ...c,
          start_time: Math.max(c.start_time, start),
          end_time: Math.min(c.end_time, end),
        })),
      notes: tab.filter((n) => n.start_time >= start && n.start_time < end),
    })
  }
  return rows
}

export interface RowGeometry {
  left: number
  right: number
  top: number
  lineGap: number
  pxPerSecond: number
  chordBandHeight: number
}

export const DEFAULT_GEOMETRY: RowGeometry = {
  left: 44,
  right: 16,
  top: 44,
  lineGap: 22,
  pxPerSecond: 110,
  chordBandHeight: 32,
}

/** 시간(초)을 행 안의 x 좌표로 바꾼다. */
export function xForTime(time: number, rowStart: number, g: RowGeometry = DEFAULT_GEOMETRY): number {
  return g.left + (time - rowStart) * g.pxPerSecond
}

/** 줄 번호(1~6)를 y 좌표로 바꾼다. 1번 줄이 맨 위. */
export function yForString(stringNumber: number, g: RowGeometry = DEFAULT_GEOMETRY): number {
  return g.top + (stringNumber - 1) * g.lineGap
}

export function rowSize(rowSeconds: number, g: RowGeometry = DEFAULT_GEOMETRY) {
  return {
    width: g.left + rowSeconds * g.pxPerSecond + g.right,
    height: g.top + 5 * g.lineGap + 24,
  }
}
