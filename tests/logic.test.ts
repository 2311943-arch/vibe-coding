// 화면과 무관한 순수 로직 테스트. Nuxt 설치 없이 `npm run test:logic`(Node 22.6+)으로 실행한다.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { validateInstagramUrl } from '../shared/utils/instagram.ts'
import {
  DEMO_STAGE_MS,
  PIPELINE_STAGES,
  demoStatusAt,
  errorMessageFor,
  isTerminal,
  stageLabel,
} from '../shared/utils/analysis.ts'
import { isConsistentTabNote, pitchOf, splitIntoRows, xForTime, yForString } from '../shared/utils/tab.ts'

// server/utils/demoSheet.ts는 Nitro 자동 import에 기대므로 테스트에서는 전역으로 넣어 준다.
;(globalThis as any).pitchOf = pitchOf
const { buildDemoResult } = await import('../server/utils/demoSheet.ts')

test('instagram URL 검증: 허용', () => {
  for (const url of [
    'https://www.instagram.com/reel/AbC_123-x/',
    'https://instagram.com/reel/AbC123',
    'https://www.instagram.com/reels/AbC123/?igsh=xyz#frag',
    'https://www.instagram.com/p/AbC123/',
  ]) {
    const r = validateInstagramUrl(url)
    assert.equal(r.ok, true, url)
    if (r.ok) assert.match(r.url, /^https:\/\/www\.instagram\.com\/(reel|reels|p)\/[A-Za-z0-9_-]+\/$/)
  }
})

test('instagram URL 검증: 거부 (SSRF·형식 오류 포함)', () => {
  const cases: [string, string][] = [
    ['', 'EMPTY_URL'],
    ['not a url', 'INVALID_URL'],
    ['http://www.instagram.com/reel/abc/', 'INVALID_URL'],
    ['https://user:pw@www.instagram.com/reel/abc/', 'INVALID_URL'],
    ['https://www.instagram.com:8443/reel/abc/', 'INVALID_URL'],
    ['https://evil.com/reel/abc/', 'UNSUPPORTED_HOST'],
    ['https://www.instagram.com.evil.com/reel/abc/', 'UNSUPPORTED_HOST'],
    ['https://169.254.169.254/latest/meta-data/', 'UNSUPPORTED_HOST'],
    ['http://localhost:3000/', 'INVALID_URL'],
    ['https://www.instagram.com/someuser/', 'UNSUPPORTED_PATH'],
    ['https://www.instagram.com/reel/', 'UNSUPPORTED_PATH'],
  ]
  for (const [url, code] of cases) {
    const r = validateInstagramUrl(url)
    assert.equal(r.ok, false, url)
    if (!r.ok) assert.equal(r.error_code, code, url)
  }
})

test('데모 진행 상태: 단계 순서와 종료', () => {
  const seen: string[] = []
  for (let i = 0; i <= PIPELINE_STAGES.length; i++) {
    seen.push(demoStatusAt(i * DEMO_STAGE_MS, 'ok').status)
  }
  assert.deepEqual(seen.slice(0, -1), PIPELINE_STAGES.map((s) => s.status))
  assert.equal(seen.at(-1), 'COMPLETED')
  assert.equal(demoStatusAt(-5, 'ok').status, 'QUEUED')
})

test('데모 진행 상태: 실패·부분 성공', () => {
  assert.equal(demoStatusAt(0, 'fail').status, 'QUEUED')
  const failed = demoStatusAt(DEMO_STAGE_MS, 'fail')
  assert.equal(failed.status, 'FAILED')
  assert.equal(failed.error_code, 'MEDIA_UNAVAILABLE')
  assert.equal(demoStatusAt(100 * DEMO_STAGE_MS, 'partial').status, 'PARTIAL')
  assert.ok(isTerminal('PARTIAL') && isTerminal('FAILED') && isTerminal('COMPLETED'))
  assert.ok(!isTerminal('TRANSCRIBING'))
  assert.equal(stageLabel('FAILED'), '분석 실패')
  assert.ok(errorMessageFor('UNKNOWN_CODE').title.length > 0)
})

test('줄·프렛 → 음정 계산', () => {
  assert.equal(pitchOf(6, 0), 40) // 낮은 E2
  assert.equal(pitchOf(1, 0), 64) // 높은 E4
  assert.equal(pitchOf(5, 3), 48) // C3
  assert.equal(pitchOf(7, 0), null)
  assert.equal(pitchOf(1, 16), null)
  assert.equal(isConsistentTabNote({ pitch: 48, string_number: 5, fret_number: 3, start_time: 0, duration: 1 }), true)
  assert.equal(isConsistentTabNote({ pitch: 48, string_number: 5, fret_number: 4, start_time: 0, duration: 1 }), false)
})

test('데모 악보: 타브가 줄·프렛과 일치하고 코드 구간 안에 있다', () => {
  const r = buildDemoResult('job', 'ok')
  assert.equal(r.status, 'COMPLETED')
  assert.equal(r.is_demo, true)
  assert.equal(r.chords.length, 4)
  assert.equal(r.tab.length, 32)
  for (const n of r.tab) {
    assert.equal(isConsistentTabNote(n), true, JSON.stringify(n))
    const chord = r.chords.find((c: any) => n.start_time >= c.start_time && n.start_time < c.end_time)
    assert.ok(chord, '모든 음표는 어떤 코드 구간 안에 있어야 한다')
  }
  assert.equal(r.quality.uncertain_segments.length, 1)

  const p = buildDemoResult('job', 'partial')
  assert.equal(p.status, 'PARTIAL')
  assert.equal(p.tab.length, 0)
  assert.ok(p.quality.note)
})

test('악보 행 나누기: 코드와 음표가 같은 시간 눈금을 쓴다', () => {
  const r = buildDemoResult('job', 'ok')
  const rows = splitIntoRows(r.chords, r.tab, r.duration, 4)
  assert.equal(rows.length, 2)
  assert.equal(rows.reduce((sum: number, row: any) => sum + row.notes.length, 0), r.tab.length)
  for (const row of rows) {
    for (const c of row.chords) {
      assert.ok(c.start_time >= row.start && c.end_time <= row.end)
    }
  }
  // 코드 경계가 행 경계를 넘으면 양쪽 행에 나타난다.
  const crossing = splitIntoRows([{ chord_name: 'C', start_time: 3, end_time: 5, confidence: null, alternatives: [] }], [], 8, 4)
  assert.equal(crossing[0].chords.length, 1)
  assert.equal(crossing[1].chords.length, 1)
  assert.throws(() => splitIntoRows([], [], 8, 0))
  assert.equal(splitIntoRows([], [], 0, 4).length, 1)

  assert.ok(xForTime(1, 0) > xForTime(0, 0))
  assert.ok(yForString(6) > yForString(1)) // 1번 줄이 맨 위
})
