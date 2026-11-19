// 분석 단계/상태 정의와 데모 진행 로직. 실제 분석 서버가 붙으면 서버가 status를 직접 내려 주므로
// 화면은 stageLabel/isTerminal만 사용하면 된다.

export type DemoScenario = 'ok' | 'fail' | 'partial'

export const PIPELINE_STAGES: { status: AnalysisStatus; label: string }[] = [
  { status: 'QUEUED', label: '분석 대기 중' },
  { status: 'FETCHING', label: '영상 확인 중' },
  { status: 'PREPROCESSING', label: '오디오 준비 중' },
  { status: 'SEPARATING', label: '보컬과 반주 분리 중' },
  { status: 'TRANSCRIBING', label: '음표 분석 중' },
  { status: 'CHORD_ANALYSIS', label: '코드 분석 중' },
  { status: 'TAB_GENERATION', label: '기타 타브 만드는 중' },
  { status: 'VALIDATING', label: '결과 확인 중' },
]

const TERMINAL: AnalysisStatus[] = ['COMPLETED', 'PARTIAL', 'FAILED']

export function isTerminal(status: AnalysisStatus): boolean {
  return TERMINAL.includes(status)
}

export function stageLabel(status: AnalysisStatus): string {
  switch (status) {
    case 'COMPLETED':
      return '분석 완료'
    case 'PARTIAL':
      return '일부만 완료'
    case 'FAILED':
      return '분석 실패'
    default:
      return PIPELINE_STAGES.find((s) => s.status === status)?.label ?? '처리 중'
  }
}

export const ERROR_MESSAGES: Record<string, { title: string; hint: string }> = {
  MEDIA_UNAVAILABLE: {
    title: '영상을 가져오지 못했어요',
    hint: '비공개이거나 삭제된 영상일 수 있고, 링크만으로는 접근할 수 없는 영상일 수도 있어요. 접근 권한이 있는 영상 파일을 직접 올리는 방법은 준비 중입니다.',
  },
  MEDIA_TOO_LONG: {
    title: '영상이 너무 길어요',
    hint: '최대 3분 이내의 영상만 분석할 수 있어요. 기타 연주 부분만 짧게 잘라 다시 시도해 주세요.',
  },
  MEDIA_FETCH_FAILED: {
    title: '영상을 확인하는 중 문제가 생겼어요',
    hint: '잠시 후 다시 시도해 주세요. 계속되면 접근 권한이 있는 영상 파일을 직접 올리는 방법(준비 중)을 이용해 주세요.',
  },
  ANALYSIS_FAILED: {
    title: '분석 중 문제가 생겼어요',
    hint: '잠시 후 다시 시도해 주세요. 계속되면 보컬과 기타 소리가 또렷한 다른 영상으로 시도해 보세요.',
  },
}

export function errorMessageFor(code: string | null): { title: string; hint: string } {
  return (code && ERROR_MESSAGES[code]) || ERROR_MESSAGES.ANALYSIS_FAILED!
}

/** 데모 API에서 단계 하나가 유지되는 시간(ms) */
export const DEMO_STAGE_MS = 1500

/**
 * 데모용: 작업 생성 후 경과 시간으로 현재 상태를 계산한다.
 * 실제 진행률(%)은 알 수 없으므로 상태 값만 돌려준다.
 */
export function demoStatusAt(
  elapsedMs: number,
  scenario: DemoScenario,
): { status: AnalysisStatus; error_code: string | null } {
  const index = Math.floor(Math.max(0, elapsedMs) / DEMO_STAGE_MS)

  if (scenario === 'fail' && index >= 1) {
    return { status: 'FAILED', error_code: 'MEDIA_UNAVAILABLE' }
  }

  const partialStop = PIPELINE_STAGES.findIndex((s) => s.status === 'TAB_GENERATION')
  if (scenario === 'partial' && index >= partialStop) {
    return { status: 'PARTIAL', error_code: null }
  }

  if (index >= PIPELINE_STAGES.length) {
    return { status: 'COMPLETED', error_code: null }
  }
  return { status: PIPELINE_STAGES[index]!.status, error_code: null }
}
