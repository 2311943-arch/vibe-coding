// 작업 저장소 테스트. 실제 Redis를 쓰지 않고 Upstash REST API를 흉내 내는 가짜 fetch로 검증한다.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEMO_STAGE_MS, demoStatusAt, stageLabel } from '../shared/utils/analysis.ts'
import * as apify from '../server/utils/apify.ts'

Object.assign(globalThis, {
  demoStatusAt,
  stageLabel,
  DEMO_STAGE_MS,
  fetchReelMedia: apify.fetchReelMedia,
  MediaFetchError: apify.MediaFetchError,
})
const { MemoryJobStore, UpstashJobStore, StoreUnavailableError, getJobStore } = await import('../server/utils/jobStore.ts')
const { createJob, findJob } = await import('../server/utils/jobs.ts')

const REEL = 'https://www.instagram.com/reel/AbC123/'

/** Upstash REST API(POST 본문 = 명령 배열)를 흉내 내는 가짜 서버. 요청 기록과 TTL도 남긴다. */
function fakeUpstash() {
  const data = new Map<string, string>()
  const calls: { auth: string | null; args: unknown[] }[] = []
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const args = JSON.parse(String(init.body)) as (string | number)[]
    calls.push({ auth: new Headers(init.headers).get('Authorization'), args })
    const [cmd, key, value] = args
    let result: unknown = null
    if (cmd === 'SET') {
      data.set(String(key), String(value))
      result = 'OK'
    } else if (cmd === 'GET') {
      result = data.get(String(key)) ?? null
    }
    return new Response(JSON.stringify({ result }), { status: 200 })
  }) as unknown as typeof fetch
  return { data, calls, fetchImpl }
}

test('Upstash 저장소: 다른 인스턴스(새 저장소 객체)에서도 같은 작업을 찾는다', async () => {
  const fake = fakeUpstash()
  const a = new UpstashJobStore('https://example.upstash.io', 'TOKEN', fake.fetchImpl)
  const b = new UpstashJobStore('https://example.upstash.io', 'TOKEN', fake.fetchImpl)

  const made = await createJob(a, REEL)
  assert.ok('job' in made)
  if (!('job' in made)) return
  assert.equal((await findJob(b, made.job.id, made.job.token))?.id, made.job.id)
  assert.equal(await findJob(b, made.job.id, 'wrong'), null)

  const set = fake.calls.find((c) => c.args[0] === 'SET')!
  assert.equal(set.auth, 'Bearer TOKEN')
  assert.equal(set.args[3], 'PX')
  const ttl = Number(set.args[4])
  assert.ok(ttl > 59 * 60 * 1000 && ttl <= 60 * 60 * 1000, `ttl ${ttl}`)
})

test('Upstash 저장소: 연결 실패·오류 응답은 StoreUnavailableError', async () => {
  const down = new UpstashJobStore('https://x', 't', (async () => {
    throw new TypeError('network')
  }) as any)
  await assert.rejects(down.get('id'), StoreUnavailableError)

  const err = new UpstashJobStore('https://x', 't', (async () =>
    new Response(JSON.stringify({ error: 'WRONGPASS' }), { status: 401 })) as any)
  await assert.rejects(err.get('id'), StoreUnavailableError)
})

test('메모리 저장소: 반환값을 고쳐도 저장된 작업은 바뀌지 않는다', async () => {
  const store = new MemoryJobStore()
  const made = await createJob(store, REEL)
  assert.ok('job' in made)
  if (!('job' in made)) return
  const got = (await store.get(made.job.id))!
  got.token = 'tampered'
  assert.equal((await store.get(made.job.id))!.token, made.job.token)
})

test('getJobStore: 환경변수에 따라 저장소를 고른다', () => {
  // getJobStore는 인스턴스 안에서 하나를 재사용하므로, 처음 호출한 환경변수로 정해진다.
  const store = getJobStore({ KV_REST_API_URL: 'https://example.upstash.io', KV_REST_API_TOKEN: 'T' })
  assert.equal(store.kind, 'redis')
})
