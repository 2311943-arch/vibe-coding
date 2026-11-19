// Apify 연동과 작업 흐름 테스트. 실제 Apify를 호출하지 않고 가짜 fetch를 넣어 검증한다.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as apify from '../server/utils/apify.ts'
import { DEMO_STAGE_MS, demoStatusAt, stageLabel } from '../shared/utils/analysis.ts'

const {
  MAX_REEL_SECONDS,
  MediaFetchError,
  buildApifyRequest,
  fetchReelMedia,
  isAllowedMediaUrl,
  parseApifyItems,
} = apify

// server/utils/jobs.ts는 Nitro 자동 import에 기대므로 테스트에서는 전역으로 넣어 준다.
Object.assign(globalThis, { demoStatusAt, stageLabel, DEMO_STAGE_MS, fetchReelMedia, MediaFetchError })
const { createJob, findJob, jobStatus } = await import('../server/utils/jobs.ts')
const { MemoryJobStore } = await import('../server/utils/jobStore.ts')
const mem = () => new MemoryJobStore()

const REEL = 'https://www.instagram.com/reel/AbC123/'
const CDN = 'https://scontent-ssn1-1.cdninstagram.com/v/t50.2886-16/clip.mp4?efg=abc'
const CONFIG = { token: 'SECRET123', actorId: 'apify~instagram-scraper', timeoutMs: 5000 }

const okItem = (extra: Record<string, unknown> = {}) => ({
  shortCode: 'AbC123',
  type: 'Video',
  videoUrl: CDN,
  videoDuration: 42.5,
  ownerUsername: 'someone',
  ...extra,
})

const jsonResponse = (body: unknown, status = 201) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

test('영상 주소 허용 목록(SSRF 방지)', () => {
  assert.equal(isAllowedMediaUrl(CDN), true)
  assert.equal(isAllowedMediaUrl('https://video.fbcdn.net/v/x.mp4'), true)
  for (const bad of [
    'http://scontent.cdninstagram.com/x.mp4',
    'https://evil.com/x.mp4',
    'https://cdninstagram.com.evil.com/x.mp4',
    'https://evilcdninstagram.com/x.mp4',
    'https://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1/x.mp4',
    'https://scontent.cdninstagram.com:8443/x.mp4',
    'https://user:pw@scontent.cdninstagram.com/x.mp4',
    'file:///etc/passwd',
    '',
    null,
    42,
  ]) {
    assert.equal(isAllowedMediaUrl(bad), false, String(bad))
  }
})

test('Apify 요청 형태', () => {
  const { url, init } = buildApifyRequest(CONFIG, REEL)
  assert.match(url, /^https:\/\/api\.apify\.com\/v2\/actors\/apify~instagram-scraper\/run-sync-get-dataset-items\?/)
  assert.match(url, /timeout=10(&|$)/) // 최소 10초
  assert.match(url, /maxItems=1/)
  assert.equal(init.method, 'POST')
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer SECRET123')
  assert.deepEqual(JSON.parse(init.body as string), {
    resultsType: 'posts',
    directUrls: [REEL],
    resultsLimit: 1,
  })
  // 토큰이 URL(로그에 남을 수 있는 곳)에 들어가지 않는다.
  assert.ok(!url.includes('SECRET123'))
})

test('응답 해석: 성공과 실패 유형', () => {
  const ok = parseApifyItems([{ shortCode: 'other', videoUrl: CDN }, okItem()], REEL)
  assert.deepEqual(ok, {
    video_url: CDN,
    short_code: 'AbC123',
    owner_username: 'someone',
    duration_seconds: 42.5,
  })
  assert.equal(parseApifyItems([okItem({ videoDuration: undefined })], REEL).duration_seconds, null)

  const cases: [unknown, string][] = [
    [[], 'MEDIA_UNAVAILABLE'],
    [null, 'MEDIA_UNAVAILABLE'],
    [[{ error: 'no_items', errorDescription: 'private' }], 'MEDIA_UNAVAILABLE'],
    [[okItem({ videoUrl: undefined, type: 'Image' })], 'MEDIA_UNAVAILABLE'],
    [[okItem({ videoUrl: 'https://evil.com/x.mp4' })], 'MEDIA_UNAVAILABLE'],
    [[okItem({ videoDuration: MAX_REEL_SECONDS + 1 })], 'MEDIA_TOO_LONG'],
  ]
  for (const [items, code] of cases) {
    assert.throws(
      () => parseApifyItems(items, REEL),
      (e: any) => e instanceof MediaFetchError && e.code === code,
      JSON.stringify(items),
    )
  }
  assert.equal(parseApifyItems([okItem({ videoDuration: MAX_REEL_SECONDS })], REEL).duration_seconds, MAX_REEL_SECONDS)
})

test('fetchReelMedia: 정상·오류 경로, 오류 메시지에 토큰이 새지 않는다', async () => {
  const expectCode = async (fetchImpl: typeof fetch, code: string, config = CONFIG as any) => {
    await assert.rejects(
      () => fetchReelMedia(REEL, config, fetchImpl),
      (e: any) => {
        assert.ok(e instanceof MediaFetchError)
        assert.equal(e.code, code)
        assert.ok(!e.message.includes('SECRET123'))
        return true
      },
    )
  }

  const media = await fetchReelMedia(REEL, CONFIG, (async () => jsonResponse([okItem()])) as any)
  assert.equal(media.video_url, CDN)

  await expectCode((async () => jsonResponse({}, 408)) as any, 'APIFY_TIMEOUT')
  await expectCode((async () => jsonResponse({ error: 'x' }, 500)) as any, 'APIFY_ERROR')
  await expectCode((async () => new Response('<html>', { status: 201 })) as any, 'APIFY_ERROR')
  await expectCode((async () => { throw new TypeError('network SECRET123') }) as any, 'APIFY_ERROR')
  await expectCode(
    (async () => { throw new DOMException('timed out', 'TimeoutError') }) as any,
    'APIFY_TIMEOUT',
  )
  await expectCode((async () => jsonResponse([])) as any, 'MEDIA_UNAVAILABLE')
  await expectCode((async () => jsonResponse([])) as any, 'APIFY_NOT_CONFIGURED', null)
  await expectCode((async () => jsonResponse([])) as any, 'APIFY_NOT_CONFIGURED', { ...CONFIG, token: '' })
})

test('작업 흐름: Apify 없이(데모 모드)', async () => {
  const store = mem()
  const made = await createJob(store, REEL)
  assert.ok('job' in made)
  if (!('job' in made)) return
  assert.equal(made.job.media.state, 'skipped')
  assert.equal(made.mediaDone, null)
  assert.equal(jobStatus(made.job, made.job.created_at).status, 'QUEUED')
  assert.equal((await findJob(store, made.job.id, made.job.token))?.id, made.job.id)
  assert.equal(await findJob(store, made.job.id, 'wrong-token'), null)
  assert.equal(await findJob(store, made.job.id, undefined), null)
  assert.equal(await findJob(store, 'no-such-id', made.job.token), null)
})

test('작업 흐름: 저장소가 가득 차면 새 작업을 받지 않는다', async () => {
  const store = new MemoryJobStore(1)
  assert.ok('job' in (await createJob(store, REEL)))
  assert.deepEqual(await createJob(store, REEL), { error: 'TOO_MANY_JOBS' })
})

test('작업 흐름: Apify 성공 → 대기·확인 단계를 거쳐 이어진다', async () => {
  const store = mem()
  const made = await createJob(store, REEL, CONFIG, (async () => jsonResponse([okItem()])) as any)
  assert.ok('job' in made)
  if (!('job' in made)) return
  const created = made.job
  assert.equal(created.media.state, 'pending')
  assert.equal(jobStatus(created, created.created_at).status, 'QUEUED')
  assert.equal(jobStatus(created, created.created_at + DEMO_STAGE_MS).status, 'FETCHING')

  await made.mediaDone
  // 확인 결과는 저장소에 기록되어, 다른 요청(다른 서버 인스턴스)에서도 보인다.
  const job = (await findJob(store, created.id, created.token))!
  assert.equal(job.media.state, 'ready')
  const readyAt = (job.media as any).at
  // 확인이 끝난 직후에는 전처리 단계부터 이어진다.
  assert.equal(jobStatus(job, readyAt).status, 'PREPROCESSING')
  assert.equal(jobStatus(job, readyAt + 100 * DEMO_STAGE_MS).status, 'COMPLETED')
  // 영상 주소는 상태 응답에 노출되지 않는다.
  assert.ok(!JSON.stringify(jobStatus(job, readyAt)).includes('cdninstagram'))
})

test('작업 흐름: Apify 실패 코드가 사용자용 오류 코드로 바뀐다', async () => {
  const run = async (fetchImpl: any) => {
    const store = mem()
    const made = await createJob(store, REEL, CONFIG, fetchImpl)
    assert.ok('job' in made)
    if (!('job' in made)) throw new Error('unreachable')
    await made.mediaDone
    return jobStatus((await findJob(store, made.job.id, made.job.token))!)
  }
  const unavailable = await run(async () => jsonResponse([{ error: 'private' }]))
  assert.deepEqual([unavailable.status, unavailable.error_code], ['FAILED', 'MEDIA_UNAVAILABLE'])

  const tooLong = await run(async () => jsonResponse([okItem({ videoDuration: 999 })]))
  assert.equal(tooLong.error_code, 'MEDIA_TOO_LONG')

  const upstream = await run(async () => jsonResponse({}, 500))
  assert.equal(upstream.error_code, 'MEDIA_FETCH_FAILED')

  // Apify를 켠 상태에서는 URL의 'fail' 같은 데모 시나리오 단어가 동작을 바꾸지 않는다.
  const store = mem()
  const made = await createJob(store, 'https://www.instagram.com/reel/fail123/', CONFIG, (async () => jsonResponse([okItem({ shortCode: 'fail123' })])) as any)
  assert.ok('job' in made)
  if ('job' in made) {
    await made.mediaDone
    const job = (await findJob(store, made.job.id, made.job.token))!
    assert.equal(job.scenario, 'ok')
    assert.equal(job.media.state, 'ready')
  }
})
