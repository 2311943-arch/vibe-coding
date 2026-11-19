// 내장 데모 API가 돌려주는 "샘플" 악보. 실제 영상 분석 결과가 아니다(is_demo: true로 표시된다).
// C → G → Am → Fmaj7, 코드당 2초, 8분음표(0.25초) 아르페지오.

const SHAPES: { name: string; frets: Record<number, number> }[] = [
  { name: 'C', frets: { 5: 3, 4: 2, 3: 0, 2: 1, 1: 0 } },
  { name: 'G', frets: { 6: 3, 5: 2, 4: 0, 3: 0, 2: 0, 1: 3 } },
  { name: 'Am', frets: { 5: 0, 4: 2, 3: 2, 2: 1, 1: 0 } },
  { name: 'Fmaj7', frets: { 4: 3, 3: 2, 2: 1, 1: 0 } },
]

const CHORD_SECONDS = 2
const STEP_SECONDS = 0.25
// 낮은 줄부터 센 순번으로 어떤 줄을 칠지 (모든 코드에 줄이 4개 이상 있다)
const PATTERN = [0, 1, 2, 3, 2, 1, 2, 3]

export function buildDemoResult(
  jobId: string,
  scenario: 'ok' | 'partial',
  mediaChecked = false,
): AnalysisResult {
  const chords: ChordEvent[] = []
  const tab: TabNote[] = []

  SHAPES.forEach((shape, index) => {
    const start = index * CHORD_SECONDS
    const isLast = index === SHAPES.length - 1
    chords.push({
      chord_name: shape.name,
      start_time: start,
      end_time: start + CHORD_SECONDS,
      confidence: null,
      // 데모에서는 마지막 마디를 "확신이 낮은 구간"으로 두어 복수 후보 표시를 보여 준다.
      alternatives: isLast ? ['F', 'Dm7'] : [],
    })

    const strings = Object.keys(shape.frets)
      .map(Number)
      .sort((a, b) => b - a) // 낮은 줄(6번)부터
    PATTERN.forEach((patternIndex, step) => {
      const stringNumber = strings[patternIndex]!
      const fret = shape.frets[stringNumber]!
      tab.push({
        pitch: pitchOf(stringNumber, fret)!,
        string_number: stringNumber,
        fret_number: fret,
        start_time: start + step * STEP_SECONDS,
        duration: STEP_SECONDS,
      })
    })
  })

  const duration = SHAPES.length * CHORD_SECONDS
  const lastStart = (SHAPES.length - 1) * CHORD_SECONDS

  if (scenario === 'partial') {
    return {
      job_id: jobId,
      status: 'PARTIAL',
      is_demo: true,
      duration,
      chords,
      tab: [],
      quality: {
        status: 'partial',
        uncertain_segments: [],
        note: '타브로 바꿀 수 있는 음표가 충분하지 않아 코드 악보만 만들었어요.',
      },
    }
  }

  return {
    job_id: jobId,
    status: 'COMPLETED',
    is_demo: true,
    duration,
    chords,
    tab,
    quality: {
      status: 'estimated',
      uncertain_segments: [
        {
          start_time: lastStart,
          end_time: lastStart + CHORD_SECONDS,
          reason: '코드 후보가 여러 개로 갈려 확정하지 못했어요.',
        },
      ],
      // 영상 주소는 실제로 확인했더라도, 분석 엔진이 아직 없어서 악보는 샘플이다.
      note: mediaChecked
        ? '영상은 확인했지만 분석 엔진이 아직 연결되지 않아 샘플 악보를 보여 드려요.'
        : null,
    },
  }
}
