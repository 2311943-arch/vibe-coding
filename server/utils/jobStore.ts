// 분석 작업 저장소. 작업 상태를 어디에 둘지만 담당한다.
//
// - 로컬 개발(기본): 서버 메모리. 서버를 다시 켜면 사라진다.
// - Vercel 등 서버리스: 요청마다 다른 인스턴스가 처리할 수 있어 메모리를 공유할 수 없다.
//   Upstash Redis(REST API)를 쓴다. Vercel Marketplace에서 Upstash Redis를 연결하면
//   KV_REST_API_URL / KV_REST_API_TOKEN 환경변수가 자동으로 들어온다.
//   Upstash에서 직접 만든 경우 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN도 읽는다.
//
// 저장하는 값은 원본 미디어가 아니라 작업 메타데이터뿐이며, 만료 시간(TTL)이 지나면 저장소가 직접 지운다.

export interface StoredJob {
  id: string
  token: string
  source_url: string
  scenario: DemoScenario
  created_at: number
  expires_at: number
  media:
    | { state: 'skipped' }
    | { state: 'pending' }
    | { state: 'ready'; at: number; media: ReelMedia }
    | { state: 'failed'; code: MediaErrorCode }
}

export interface JobStore {
  readonly kind: 'memory' | 'redis'
  get(id: string): Promise<StoredJob | null>
  /** 작업을 저장한다. 만료 시각(expires_at)이 지나면 사라진다. 새 작업을 더 받을 수 없으면 false. */
  put(job: StoredJob, opts?: { isNew?: boolean }): Promise<boolean>
}

export class MemoryJobStore implements JobStore {
  readonly kind = 'memory' as const
  private jobs = new Map<string, StoredJob>()
  private readonly maxJobs: number

  constructor(maxJobs = 500) {
    this.maxJobs = maxJobs
  }

  private purge(now: number) {
    for (const [id, job] of this.jobs) {
      if (job.expires_at <= now) this.jobs.delete(id)
    }
  }

  async get(id: string) {
    this.purge(Date.now())
    const job = this.jobs.get(id)
    // 호출한 쪽이 고쳐도 저장된 값이 바뀌지 않도록 복사본을 준다(Redis와 같은 동작).
    return job ? structuredClone(job) : null
  }

  async put(job: StoredJob, opts: { isNew?: boolean } = {}) {
    this.purge(Date.now())
    if (opts.isNew && this.jobs.size >= this.maxJobs) return false
    this.jobs.set(job.id, structuredClone(job))
    return true
  }
}

export class StoreUnavailableError extends Error {}

export class UpstashJobStore implements JobStore {
  readonly kind = 'redis' as const

  private readonly url: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch
  private readonly prefix = 'guitar-tab:job:'

  constructor(url: string, token: string, fetchImpl: typeof fetch = fetch) {
    this.url = url
    this.token = token
    this.fetchImpl = fetchImpl
  }

  private async command(args: (string | number)[]): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      throw new StoreUnavailableError('job store request failed')
    }
    const body = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null
    if (!res.ok || !body || body.error) throw new StoreUnavailableError(`job store error ${res.status}`)
    return body.result ?? null
  }

  async get(id: string) {
    const raw = await this.command(['GET', this.prefix + id])
    if (typeof raw !== 'string') return null
    try {
      return JSON.parse(raw) as StoredJob
    } catch {
      return null
    }
  }

  async put(job: StoredJob) {
    const ttl = job.expires_at - Date.now()
    if (ttl <= 0) return true
    await this.command(['SET', this.prefix + job.id, JSON.stringify(job), 'PX', Math.ceil(ttl)])
    return true
  }
}

let shared: JobStore | null = null
let warned = false

/** 환경변수를 보고 저장소를 고른다. 같은 서버 인스턴스 안에서는 하나를 재사용한다. */
export function getJobStore(env: Record<string, string | undefined> = process.env): JobStore {
  if (shared) return shared
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) {
    shared = new UpstashJobStore(url, token)
  } else {
    if (env.VERCEL && !warned) {
      warned = true
      console.warn(
        '[jobs] Vercel에서 작업 저장소(Upstash Redis)가 설정되지 않았습니다. ' +
          '진행·결과 화면에서 "작업을 찾을 수 없어요"가 뜰 수 있습니다. KV_REST_API_URL/KV_REST_API_TOKEN을 설정하세요.',
      )
    }
    shared = new MemoryJobStore()
  }
  return shared
}

/** 저장소를 쓰는 작업을 실행하고, 저장소에 닿지 못하면 사용자에게 보여 줄 503 오류로 바꾼다. */
export async function withJobStore<T>(fn: (store: JobStore) => Promise<T>): Promise<T> {
  try {
    return await fn(getJobStore())
  } catch (err) {
    if (err instanceof StoreUnavailableError) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable',
        data: { error_code: 'STORE_UNAVAILABLE', message: '지금은 작업을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.' },
      })
    }
    throw err
  }
}
