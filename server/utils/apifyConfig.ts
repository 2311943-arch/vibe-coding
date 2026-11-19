import type { H3Event } from 'h3'

/** 런타임 설정에서 Apify 설정을 읽는다. 토큰이 비어 있으면 null(= 데모 모드). 토큰은 서버에만 있다. */
export function readApifyConfig(event: H3Event): ApifyConfig | null {
  const cfg = useRuntimeConfig(event).apify as
    | { token?: string; actorId?: string; timeoutMs?: number }
    | undefined
  if (!cfg?.token) return null
  return {
    token: cfg.token,
    actorId: cfg.actorId || 'apify~instagram-scraper',
    timeoutMs: Number(cfg.timeoutMs) > 0 ? Number(cfg.timeoutMs) : 120_000,
  }
}
