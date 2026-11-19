import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'

// 분석 작업의 생성·조회·상태 계산. 작업을 어디에 저장할지는 jobStore.ts(메모리 또는 Redis)가 맡는다.
// 실제 구현에서는 PostgreSQL + Celery 작업 큐로 대체한다(PRD 3장).
//
// 미디어 확보 방식
// - Apify 토큰이 없으면(기본값): 영상 확보를 건너뛰고 데모 진행 상태만 흉내 낸다.
// - Apify 토큰이 있으면: 공개 릴스의 영상 주소를 실제로 확인한다(FETCHING 단계가 실제 호출 시간만큼 걸린다).
//   그 뒤의 분석 단계는 아직 연결되지 않아 데모 상태와 샘플 악보가 이어진다(결과의 is_demo: true).
//   확인은 응답을 보낸 뒤에도 이어지므로, 서버리스에서는 호출한 쪽이 mediaDone을 waitUntil에 넘겨야 한다.

export type DemoJob = StoredJob

const JOB_TTL_MS = 60 * 60 * 1000 // 임시 데이터 만료 1시간

/** 데모용: 링크 경로에 fail/partial이 들어 있으면 실패·부분 성공 화면을 확인할 수 있다(Apify를 쓰지 않을 때만). */
function scenarioFor(url: string): DemoScenario {
  const lower = url.toLowerCase()
  if (lower.includes('fail')) return 'fail'
  if (lower.includes('partial')) return 'partial'
  return 'ok'
}

export async function createJob(
  store: JobStore,
  sourceUrl: string,
  apify: ApifyConfig | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ job: DemoJob; mediaDone: Promise<void> | null } | { error: 'TOO_MANY_JOBS' }> {
  const now = Date.now()
  const useApify = !!apify && !!apify.token
  const job: DemoJob = {
    id: randomUUID(),
    token: randomBytes(24).toString('base64url'),
    source_url: sourceUrl,
    scenario: useApify ? 'ok' : scenarioFor(sourceUrl),
    created_at: now,
    expires_at: now + JOB_TTL_MS,
    media: useApify ? { state: 'pending' } : { state: 'skipped' },
  }
  if (!(await store.put(job, { isNew: true }))) return { error: 'TOO_MANY_JOBS' }

  let mediaDone: Promise<void> | null = null
  if (useApify) {
    mediaDone = fetchReelMedia(sourceUrl, apify, fetchImpl)
      .then(
        (media): DemoJob['media'] => ({ state: 'ready', at: Date.now(), media }),
        (err: unknown): DemoJob['media'] => ({
          state: 'failed',
          code: err instanceof MediaFetchError ? err.code : 'APIFY_ERROR',
        }),
      )
      .then(async (media) => {
        job.media = media
        await store.put(job)
      })
      .catch((err: unknown) => {
        // 저장소에 쓰지 못하면 작업은 FETCHING에 머물다 만료된다. 비밀 값이 섞이지 않게 이름만 남긴다.
        console.error('[jobs] 미디어 확인 결과를 저장하지 못했습니다:', (err as Error)?.name)
      })
  }
  return { job, mediaDone }
}

/** 작업 ID와 접근 토큰이 모두 맞을 때만 작업을 돌려준다. 없는 작업과 토큰 불일치를 구분하지 않는다. */
export async function findJob(store: JobStore, id: string, token: string | undefined): Promise<DemoJob | null> {
  if (!token || !id) return null
  const job = await store.get(id)
  if (!job || job.expires_at <= Date.now()) return null
  const a = Buffer.from(job.token)
  const b = Buffer.from(token)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return job
}

/** 미디어 확보 실패 코드를 사용자에게 보여 줄 오류 코드로 바꾼다. */
function publicErrorCode(code: MediaErrorCode): string {
  if (code === 'MEDIA_UNAVAILABLE' || code === 'MEDIA_TOO_LONG') return code
  return 'MEDIA_FETCH_FAILED'
}

export function jobStatus(job: DemoJob, now: number = Date.now()): AnalysisStatusResponse {
  let status: AnalysisStatus
  let error_code: string | null = null

  switch (job.media.state) {
    case 'pending':
      status = now - job.created_at < DEMO_STAGE_MS ? 'QUEUED' : 'FETCHING'
      break
    case 'failed':
      status = 'FAILED'
      error_code = publicErrorCode(job.media.code)
      break
    case 'ready': {
      // 영상 확인에 앞의 두 단계(대기, 확인)를 썼다고 보고 그다음 단계부터 이어 간다.
      const elapsed = 2 * DEMO_STAGE_MS + (now - job.media.at)
      ;({ status, error_code } = demoStatusAt(elapsed, job.scenario))
      break
    }
    default:
      ;({ status, error_code } = demoStatusAt(now - job.created_at, job.scenario))
  }

  return { job_id: job.id, status, stage: stageLabel(status), error_code }
}
