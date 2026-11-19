// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'ko' },
      title: '기타 영상 악보 변환',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content: '기타 연주 영상 링크를 입력하면 코드 악보와 추정 기타 타브를 만들어 드립니다.',
        },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
        },
      ],
    },
  },
  // 서버 전용 설정(public 아래가 아니므로 브라우저로 나가지 않는다).
  // 환경변수: NUXT_APIFY_TOKEN, NUXT_APIFY_ACTOR_ID, NUXT_APIFY_TIMEOUT_MS. 토큰이 비어 있으면 데모 모드.
  runtimeConfig: {
    apify: {
      token: '',
      actorId: 'apify~instagram-scraper',
      timeoutMs: 120000,
    },
  },
})
