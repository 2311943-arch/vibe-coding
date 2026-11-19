// PRD v0.2 6장(데이터 모델)과 7장(API 초안)을 따르는 공유 타입.
// 프론트와 서버가 같은 계약을 쓰고, 나중에 Python 백엔드로 바꿔도 이 형태를 유지한다.

export type AnalysisStatus =
  | 'QUEUED'
  | 'FETCHING'
  | 'PREPROCESSING'
  | 'SEPARATING'
  | 'TRANSCRIBING'
  | 'CHORD_ANALYSIS'
  | 'TAB_GENERATION'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'

export type SourceType = 'instagram_url' | 'upload'

export interface CreateAnalysisRequest {
  source_type: SourceType
  source_url: string
}

export interface CreateAnalysisResponse {
  job_id: string
  status: AnalysisStatus
  /** 작업 소유권 확인용 토큰. 결과/상태 조회 시 query `token`으로 보낸다. */
  access_token: string
}

export interface AnalysisStatusResponse {
  job_id: string
  status: AnalysisStatus
  /** 사용자에게 보여 줄 현재 단계 설명 */
  stage: string
  error_code: string | null
}

export interface ChordEvent {
  /** 코드명. 확신이 낮아 확정하지 못한 구간은 'UNKNOWN' */
  chord_name: string
  start_time: number
  end_time: number
  /** 보정되지 않은 모델 점수일 수 있으므로 화면에 정확도처럼 표시하지 않는다. */
  confidence: number | null
  alternatives: string[]
}

export interface TabNote {
  /** MIDI 음정 */
  pitch: number
  /** 1(가장 높은 줄, 1번 줄) ~ 6(가장 낮은 줄) */
  string_number: number
  fret_number: number
  start_time: number
  duration: number
}

export interface UncertainSegment {
  start_time: number
  end_time: number
  reason: string
}

export interface AnalysisResult {
  job_id: string
  status: 'COMPLETED' | 'PARTIAL'
  /** 내장 데모 API가 만든 샘플 결과인지 여부. 실제 분석 결과가 아니다. */
  is_demo: boolean
  duration: number
  chords: ChordEvent[]
  tab: TabNote[]
  quality: {
    status: 'estimated' | 'partial'
    uncertain_segments: UncertainSegment[]
    /** 부분 완료일 때 사용자에게 보여 줄 안내 */
    note: string | null
  }
}
