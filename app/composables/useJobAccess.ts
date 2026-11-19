// 작업 접근 토큰과 원본 링크를 브라우저 탭(sessionStorage)에만 보관한다.
// 토큰을 URL에 넣지 않아 주소 공유·방문 기록으로 결과가 새어 나가지 않게 한다(PRD 8장).

export interface JobAccess {
  token: string
  sourceUrl: string
}

const KEY_PREFIX = 'guitar-tab:job:'

export function saveJobAccess(jobId: string, access: JobAccess) {
  try {
    sessionStorage.setItem(KEY_PREFIX + jobId, JSON.stringify(access))
  } catch {
    // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 이번 화면 이동 동안만 메모리에 둔다.
    memory.set(jobId, access)
  }
}

export function loadJobAccess(jobId: string): JobAccess | null {
  const fromMemory = memory.get(jobId)
  if (fromMemory) return fromMemory
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + jobId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<JobAccess>
    if (typeof parsed.token !== 'string' || typeof parsed.sourceUrl !== 'string') return null
    return { token: parsed.token, sourceUrl: parsed.sourceUrl }
  } catch {
    return null
  }
}

const memory = new Map<string, JobAccess>()

/**
 * 분석 작업을 만들고 토큰을 저장한 뒤 job_id를 돌려준다. 실패하면 사용자에게 보여 줄 문구를 던진다.
 * 호출하는 화면은 사용자가 "분석 권한이 있다"고 확인한 뒤에만 부른다(화면 1 체크박스, 같은 링크 재시도).
 */
export async function startAnalysis(sourceUrl: string): Promise<string> {
  try {
    const res = await $fetch<CreateAnalysisResponse>('/api/analyses', {
      method: 'POST',
      body: {
        source_type: 'instagram_url',
        source_url: sourceUrl,
        rights_confirmed: true,
      } satisfies CreateAnalysisRequest,
    })
    saveJobAccess(res.job_id, { token: res.access_token, sourceUrl })
    return res.job_id
  } catch (err: any) {
    const message = err?.data?.data?.message
    throw new Error(
      typeof message === 'string' ? message : '서버와 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
    )
  }
}
