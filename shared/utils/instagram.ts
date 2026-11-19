// Instagram URL 형식 검증. 이 함수는 URL의 "형태"만 확인한다.
// 서버가 이 URL을 직접 내려받는 일은 없다(SSRF 방지, PRD 8장).

export type UrlValidation =
  | { ok: true; url: string }
  | { ok: false; error_code: 'EMPTY_URL' | 'INVALID_URL' | 'UNSUPPORTED_HOST' | 'UNSUPPORTED_PATH'; message: string }

const ALLOWED_HOSTS = ['instagram.com', 'www.instagram.com']
const PATH_PATTERN = /^\/(reel|reels|p)\/([A-Za-z0-9_-]+)\/?$/

export function validateInstagramUrl(input: string): UrlValidation {
  const raw = (input ?? '').trim()
  if (!raw) {
    return { ok: false, error_code: 'EMPTY_URL', message: '영상 링크를 입력해 주세요.' }
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return {
      ok: false,
      error_code: 'INVALID_URL',
      message: '올바른 링크 형식이 아닙니다. https://www.instagram.com/reel/... 형태로 입력해 주세요.',
    }
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return {
      ok: false,
      error_code: 'INVALID_URL',
      message: '올바른 링크 형식이 아닙니다. https://www.instagram.com/reel/... 형태로 입력해 주세요.',
    }
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname.toLowerCase())) {
    return {
      ok: false,
      error_code: 'UNSUPPORTED_HOST',
      message: '현재는 인스타그램 링크(instagram.com)만 지원합니다.',
    }
  }

  const match = PATH_PATTERN.exec(parsed.pathname)
  if (!match) {
    return {
      ok: false,
      error_code: 'UNSUPPORTED_PATH',
      message: '릴스 또는 게시물 영상 링크(/reel/..., /p/...)를 입력해 주세요.',
    }
  }

  // 쿼리와 해시는 버리고 정규화한다.
  return { ok: true, url: `https://www.instagram.com/${match[1]}/${match[2]}/` }
}
