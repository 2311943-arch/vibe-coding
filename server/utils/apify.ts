// Apify의 Instagram Scraper(apify/instagram-scraper)로 공개 릴스의 영상 주소를 확보한다.
//
// 지켜야 할 선
// - 공개 게시물만 대상으로 한다. 로그인·쿠키·세션을 다루지 않고, 비공개나 접근 제한을 우회하지 않는다.
//   Apify 액터는 로그아웃 상태에서 보이는 공개 데이터만 수집한다고 안내하며, 접근 실패는 그대로 실패로 처리한다.
// - 분석 권한이 있는 영상만 처리한다(호출 전에 사용자의 rights_confirmed 확인이 필요하다).
// - 액터가 돌려준 videoUrl은 신뢰하지 않는다. https + Instagram CDN 호스트만 허용한다(SSRF 방지).
// - 이 모듈은 영상을 내려받지 않는다. 내려받기(크기·길이 제한, 격리 저장)는 분석 백엔드 단계에서 한다.
//
// 이 파일은 Nitro 자동 import에 기대지 않는 순수 TypeScript라서 Node 테스트로 바로 검증할 수 있다.

export interface ApifyConfig {
  token: string
  /** 'apify~instagram-scraper' 형태(소유자~이름) 또는 액터 ID */
  actorId: string
  timeoutMs: number
}

export interface ReelMedia {
  video_url: string
  short_code: string | null
  owner_username: string | null
  duration_seconds: number | null
}

export type MediaErrorCode =
  | 'APIFY_NOT_CONFIGURED'
  | 'MEDIA_UNAVAILABLE'
  | 'MEDIA_TOO_LONG'
  | 'APIFY_TIMEOUT'
  | 'APIFY_ERROR'

export class MediaFetchError extends Error {
  code: MediaErrorCode
  constructor(code: MediaErrorCode, message: string) {
    super(message)
    this.name = 'MediaFetchError'
    this.code = code
  }
}

/** 분석 대상 영상의 최대 길이(초). PRD 8장: 길이 검사. */
export const MAX_REEL_SECONDS = 180

const ALLOWED_MEDIA_HOST_SUFFIXES = ['.cdninstagram.com', '.fbcdn.net']

/** 액터가 알려 준 영상 주소가 Instagram CDN의 https 주소인지 확인한다. */
export function isAllowedMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  const host = u.hostname.toLowerCase()
  return ALLOWED_MEDIA_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

export function shortCodeOf(instagramUrl: string): string | null {
  const m = /\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)\/?/.exec(new URL(instagramUrl).pathname)
  return m ? m[1]! : null
}

export function buildApifyRequest(
  config: ApifyConfig,
  instagramUrl: string,
): { url: string; init: RequestInit } {
  const timeoutSeconds = Math.max(10, Math.ceil(config.timeoutMs / 1000))
  const url =
    `https://api.apify.com/v2/actors/${encodeURIComponent(config.actorId)}/run-sync-get-dataset-items` +
    `?timeout=${timeoutSeconds}&maxItems=1&format=json`
  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        resultsType: 'posts',
        directUrls: [instagramUrl],
        resultsLimit: 1,
      }),
    },
  }
}

/** 액터 응답(JSON 배열)에서 영상 정보를 검증해 꺼낸다. */
export function parseApifyItems(items: unknown, instagramUrl: string): ReelMedia {
  if (!Array.isArray(items) || items.length === 0) {
    throw new MediaFetchError('MEDIA_UNAVAILABLE', '영상을 찾지 못했습니다.')
  }

  const expected = shortCodeOf(instagramUrl)
  const objects = items.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
  // 요청한 게시물과 shortCode가 같은 항목을 우선하고, 없으면 첫 항목을 본다.
  const item = objects.find((x) => x.shortCode === expected) ?? objects[0]
  if (!item) throw new MediaFetchError('MEDIA_UNAVAILABLE', '영상을 찾지 못했습니다.')

  // 액터는 비공개·삭제 등을 { error, errorDescription } 항목으로 알리기도 한다.
  if (typeof item.error === 'string') {
    throw new MediaFetchError('MEDIA_UNAVAILABLE', '영상에 접근할 수 없습니다.')
  }

  if (!isAllowedMediaUrl(item.videoUrl)) {
    // 사진 게시물이거나, 예상하지 못한 주소다. 어느 쪽이든 분석할 수 없다.
    throw new MediaFetchError('MEDIA_UNAVAILABLE', '분석할 수 있는 영상 주소가 없습니다.')
  }

  const duration =
    typeof item.videoDuration === 'number' && Number.isFinite(item.videoDuration) && item.videoDuration > 0
      ? item.videoDuration
      : null
  if (duration !== null && duration > MAX_REEL_SECONDS) {
    throw new MediaFetchError('MEDIA_TOO_LONG', `영상이 너무 깁니다(최대 ${MAX_REEL_SECONDS}초).`)
  }

  return {
    video_url: item.videoUrl,
    short_code: typeof item.shortCode === 'string' ? item.shortCode : null,
    owner_username: typeof item.ownerUsername === 'string' ? item.ownerUsername : null,
    duration_seconds: duration,
  }
}

/**
 * Apify를 호출해 공개 릴스의 영상 정보를 가져온다. fetchImpl은 테스트에서 가짜 fetch를 넣기 위한 자리다.
 * 토큰이나 응답 본문 같은 민감한 값은 오류 메시지에 싣지 않는다.
 */
export async function fetchReelMedia(
  instagramUrl: string,
  config: ApifyConfig | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ReelMedia> {
  if (!config || !config.token) {
    throw new MediaFetchError('APIFY_NOT_CONFIGURED', 'Apify 토큰이 설정되어 있지 않습니다.')
  }

  const { url, init } = buildApifyRequest(config, instagramUrl)
  let res: Response
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(config.timeoutMs) })
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new MediaFetchError('APIFY_TIMEOUT', 'Apify 응답이 제한 시간을 넘겼습니다.')
    }
    throw new MediaFetchError('APIFY_ERROR', 'Apify에 연결하지 못했습니다.')
  }

  if (res.status === 408) {
    throw new MediaFetchError('APIFY_TIMEOUT', 'Apify 실행이 제한 시간을 넘겼습니다.')
  }
  if (!res.ok) {
    throw new MediaFetchError('APIFY_ERROR', `Apify 요청이 실패했습니다(HTTP ${res.status}).`)
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new MediaFetchError('APIFY_ERROR', 'Apify 응답을 해석하지 못했습니다.')
  }
  return parseApifyItems(body, instagramUrl)
}
