# Vercel 배포

웹(Nuxt 4)은 Vercel에 그대로 배포됩니다(별도 설정 파일 불필요). Python 분석 서버는 Vercel이 아니라 별도 Docker 서버로 운영합니다(PRD 3장).

## 왜 Redis가 필요한가

Vercel의 서버 함수는 요청마다 다른 인스턴스에서 실행될 수 있고 메모리를 공유하지 않습니다.
분석 작업 상태를 서버 메모리에만 두면 진행·결과 화면에서 "작업을 찾을 수 없어요"가 무작위로 뜹니다.
그래서 Vercel에서는 작업 상태를 **Upstash Redis**에 저장합니다(`server/utils/jobStore.ts`).
로컬 개발에서는 환경변수가 없으면 자동으로 메모리를 씁니다.

## 처음 배포하기

1. https://vercel.com 에 GitHub 계정으로 로그인 → **Add New… → Project** → `vibe-coding` 저장소 **Import**.
2. Framework Preset이 **Nuxt.js**로 잡혔는지 확인하고 **Deploy**. (첫 배포는 Redis 없이 올라가며, 이 상태에서는 진행 화면이 불안정할 수 있습니다.)
3. 프로젝트 화면 → **Storage** 탭 → **Create Database** → **Upstash for Redis**(Marketplace) → 무료 플랜으로 만들고 이 프로젝트에 **Connect**.
   `KV_REST_API_URL`, `KV_REST_API_TOKEN` 환경변수가 자동으로 추가됩니다.
4. **Deployments** 탭 → 최신 배포의 **⋯ → Redeploy**. 환경변수는 다시 배포해야 반영됩니다.
5. Node.js 버전은 `package.json`의 `engines`(22.x)를 따릅니다. **Settings → General → Node.js Version**에서 22.x로 보이는지 확인합니다.

## 선택 환경변수 (Settings → Environment Variables)

| 이름 | 설명 |
|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis 연결(3단계에서 자동 추가). Upstash에서 직접 만들었다면 `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`도 읽습니다. |
| `NUXT_APIFY_TOKEN` | 넣으면 공개 릴스 영상을 실제로 확인합니다. 비워 두면 샘플 악보만 보여 주는 데모 모드이며, 링크에 `fail`/`partial`을 넣어 실패·부분 완료 화면을 볼 수 있습니다. |
| `NUXT_APIFY_ACTOR_ID`, `NUXT_APIFY_TIMEOUT_MS` | Apify 세부 설정(기본값 있음). |

토큰·키는 Vercel 환경변수에만 넣고 저장소에 커밋하지 않습니다.

## 영상 확인(Apify)과 waitUntil

Apify 영상 확인은 "작업 생성" 응답을 보낸 뒤에도 이어집니다. Vercel은 응답 후 함수를 멈출 수 있으므로
`@vercel/functions`의 `waitUntil`로 확인이 끝날 때까지 함수를 유지합니다(`server/api/analyses/index.post.ts`).
Vercel 밖에서는 아무 일도 하지 않습니다.

## 배포 후 확인

- 첫 화면에서 아무 릴스 링크로 분석 → 진행 화면이 단계별로 넘어가고 결과 화면이 열리는지
- 링크 경로에 `fail` → 실패 화면, `partial` → 코드만 있는 부분 완료 화면(Apify 미설정 시)
- Vercel 로그에 `[jobs] Vercel에서 작업 저장소(Upstash Redis)가 설정되지 않았습니다` 경고가 있으면 3~4단계를 다시 확인
