import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'

// 데모용 메모리 작업 저장소. 서버를 재시작하면 사라진다.
// 실제 구현에서는 PostgreSQL + Celery 작업 큐로 대체한다(PRD 3장).

interface DemoJob {
  id: string
  token: string
  source_url: string
  scenario: DemoScenario
  created_at: number
  expires_at: number
}

const JOB_TTL_MS = 60 * 60 * 1000 // 임시 데이터 만료 1시간
const MAX_JOBS = 500

const jobs = new Map<string, DemoJob>()

function purgeExpired(now: number) {
  for (const [id, job] of jobs) {
    if (job.expires_at <= now) jobs.delete(id)
  }
}

/** 데모용: 링크 경로에 fail/partial이 들어 있으면 실패·부분 성공 화면을 확인할 수 있다. */
function scenarioFor(url: string): DemoScenario {
  const lower = url.toLowerCase()
  if (lower.includes('fail')) return 'fail'
  if (lower.includes('partial')) return 'partial'
  return 'ok'
}

export function createJob(sourceUrl: string): { job: DemoJob } | { error: 'TOO_MANY_JOBS' } {
  const now = Date.now()
  purgeExpired(now)
  if (jobs.size >= MAX_JOBS) return { error: 'TOO_MANY_JOBS' }

  const job: DemoJob = {
    id: randomUUID(),
    token: randomBytes(24).toString('base64url'),
    source_url: sourceUrl,
    scenario: scenarioFor(sourceUrl),
    created_at: now,
    expires_at: now + JOB_TTL_MS,
  }
  jobs.set(job.id, job)
  return { job }
}

/** 작업 ID와 접근 토큰이 모두 맞을 때만 작업을 돌려준다. 없는 작업과 토큰 불일치를 구분하지 않는다. */
export function findJob(id: string, token: string | undefined): DemoJob | null {
  purgeExpired(Date.now())
  const job = jobs.get(id)
  if (!job || !token) return null
  const a = Buffer.from(job.token)
  const b = Buffer.from(token)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return job
}

export function jobStatus(job: DemoJob): AnalysisStatusResponse {
  const { status, error_code } = demoStatusAt(Date.now() - job.created_at, job.scenario)
  return {
    job_id: job.id,
    status,
    stage: stageLabel(status),
    error_code,
  }
}
