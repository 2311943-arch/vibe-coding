# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude에게 프로젝트 맥락과 규칙을 알려 줍니다.
(PRD v0.2 기준으로 작성됨. 프론트엔드는 PRD의 Next.js 대신 Nuxt 4(Vue)로 결정했다.)

## 프로젝트 개요

기타를 치며 노래하는 영상(인스타그램 Reel 등)의 링크를 입력하면, AI가 연주를 분석해
**코드 악보**와 **기타 타브 악보**를 생성하는 로그인 없는 반응형 웹서비스.
핵심 사용자는 영상 속 연주를 따라 해보고 싶은 기타 초보자·입문자.

### 반드시 지킬 제품 원칙

- 타브는 원 연주자의 운지를 복원한 것이 **아니라**, 추출된 음정을 기타로 연주 가능하게
  재배치한 **추정 타브**다. UI·문구·코드에서 "정확한 복원"을 약속하지 않는다.
- 확신이 낮은 구간은 억지로 확정하지 않고 `UNKNOWN` 또는 복수 후보로 남긴다.
- 모델 confidence 점수를 검증된 정확도처럼 표시하지 않는다.
- 진행 화면에는 실제 작업 상태만 표시한다. 근거 없는 가짜 퍼센트 진행률 금지.
- 가장 먼저 증명할 가설: 권한이 있는 기타 노래 오디오 → 실제로 따라 칠 수 있는 수준의
  코드·타브 변환이 가능한가. 이 검증(Phase 0) 전에는 Instagram 자동 수집이나 완성된 UI에
  큰 개발 비용을 쓰지 않는다.

## 기술 스택 (권장 기본안)

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Nuxt 4 (Vue 3), TypeScript, CSS 변수 디자인 토큰(`app/assets/css/main.css`), `useFetch`/`$fetch` |
| 악보 렌더링 | 자체 SVG 악보 렌더러 (코드·TAB 우선, 정교한 오선보는 후속) |
| 백엔드 | Python, FastAPI, Pydantic |
| 비동기 작업 | Celery + Redis |
| DB / 저장소 | PostgreSQL, S3 호환 임시 오브젝트 스토리지 |
| 미디어 처리 | FFmpeg, ffprobe |
| 오디오 분석 | librosa, NumPy, SciPy |
| 모델 후보 | Demucs 계열(분리), Spotify Basic Pitch 및 다성 전사 모델(비교 평가) |
| 타브 변환 | 자체 Python 로직 |
| 배포 | Vercel(웹), Docker 기반 Python 서버(웹과 분석 서버 분리) |
| 테스트 | Pytest, Playwright |

## 아키텍처

```
브라우저 → Nuxt → FastAPI ─ PostgreSQL
                        │
                        └→ Redis + Celery Worker
                             미디어 검증 → FFmpeg 전처리 → 음원 분리
                             → 음표 전사 → 코드 추정/MIDI 후처리
                             → 줄·프렛 배치 → 결과 검증 → 저장
→ Nuxt 결과 화면 + 자체 SVG 악보 렌더러
```

- 프론트엔드와 Python 분석 서버는 분리한다.
- 오디오 분석은 HTTP 요청 안에서 동기 처리하지 않고 반드시 백그라운드 작업으로 실행한다.
- AI 모델은 인터페이스 뒤에 두어 교체 가능하게 한다.
- 내부 악보 데이터와 화면 렌더링을 분리한다. 렌더러가 바뀌어도 분석 결과 스키마는 유지한다.
- 원본 미디어, 분리 오디오, MIDI, 코드·타브 결과는 수명과 보관 정책을 구분한다.
- 인프라는 작업량에 따라 단계적으로 도입한다. 처음부터 전부 갖추지 않는다.

## 분석 파이프라인과 상태

상태 값: `QUEUED` → `FETCHING` → `PREPROCESSING` → `SEPARATING` → `TRANSCRIBING`
→ `CHORD_ANALYSIS` → `TAB_GENERATION` → `VALIDATING` → `COMPLETED`
(예외: `PARTIAL` 부분 완료, `FAILED` 실패)

### 코드 추정

전사된 음표 + 크로마 특징으로 구간별 후보를 만들고, 음 구성 일치도와 앞뒤 진행 연속성으로
정렬한다. 음 3개가 검출됐다고 코드 하나로 확정하지 않는다. 전위, 텐션, 카포, 오픈 튜닝,
베이스 음을 고려한다.

### 타브 변환

- 기본 가정: 6현, 표준 튜닝 E2-A2-D3-G3-B3-E4, 카포 없음. 프렛 범위는 설정값.
- 순서: MIDI 음정 → 줄·프렛 후보 → 물리적 불가능 후보 제거 → 손 이동 거리·프렛 위치 평가
  → 동시 발음 가능성 검사 → 전체 구간 연주 편의성 기준 경로 선택.

## 데이터 모델 (초안)

- `AnalysisJob`: id(UUID), source_type(`instagram_url`|`upload`), source_reference, status,
  stage, error_code, created_at, expires_at
- `NoteEvent`: pitch, start_time, duration, confidence, source_track
- `ChordEvent`: chord_name, start_time, end_time, confidence, alternatives
- `TabNote`: pitch, string_number, fret_number, start_time, duration

## API (초안)

- `POST /api/analyses` — 작업 생성 (`source_type`, `source_url`) → `job_id`, `status`
- `GET /api/analyses/{job_id}` — 상태 조회 (`status`, `stage`)
- `GET /api/analyses/{job_id}/result` — 결과 조회 (`chords`, `tab`, `quality`)

## 미디어 접근 및 보안 규칙 (중요)

- Instagram URL이 있다고 해서 원본 미디어를 가져올 수 있다고 가정하지 않는다.
- 로그인·비공개·플랫폼 기술 제한을 **우회하는 코드는 작성하지 않는다.** 허용된 공식/적법한
  경로로만 확보하고, 실패 시 명확한 사유와 **업로드 대체 경로**를 안내한다.
- 업로드 시 분석 권한 보유 확인, 형식·크기·길이·MIME·실제 파일 시그니처 검사.
- SSRF 방지: 서버가 임의 URL을 무제한으로 가져오지 않게 하고, 내부 IP·메타데이터 서비스·
  로컬 파일 대상 요청을 차단한다.
- 작업 ID는 예측하기 어렵게 생성하고, 결과 API에서 소유권/접근 토큰을 검증한다.
- 미디어는 격리 저장소에 두고 실행 파일로 취급하지 않는다. 임시 데이터는 만료 후 삭제.
- 사용자 식별정보 수집 최소화. 외부 AI 제공업체로 미디어를 보내는 경우 보관·학습 정책을
  확인하고 사용자에게 고지한다.
- 인스타그램 영상 확인은 Apify Instagram Scraper(`apify~instagram-scraper`)로 한다(`server/utils/apify.ts`).
  공개 게시물만 대상이며 로그인·쿠키·세션은 다루지 않는다. 토큰은 `NUXT_APIFY_TOKEN`(서버 전용, 커밋 금지).
  꺼져 있는 것이 기본이고, 켜면 `rights_confirmed: true` 없이는 작업을 만들 수 없다. 액터가 준 영상 주소는
  https + Instagram CDN 호스트만 허용한다. 서드파티 스크래퍼 사용은 플랫폼 약관·비용 위험이 있으므로 업로드 대체
  경로를 계속 준비하고, 접근 실패는 우회하지 않고 실패로 처리한다.

## MVP 범위

**포함:** URL 입력·검증, 허용된 미디어 확보 또는 업로드 대안, 비동기 작업과 상태 표시,
전처리·음원 분리 실험, 음표 전사·코드 추정, 추정 타브 생성, 코드·TAB 결과 표시,
실패·부분 성공·불확실 구간 처리.

**제외:** 회원가입/로그인, 보관함, 커뮤니티·공유, 악보 편집, 기타 모델 식별, 다른 악기,
정확한 핑거링 복원, 출판 수준 오선보, 실시간 분석.

## 개발 단계

0. **기술 타당성 검증(최우선)** — 권한 확인된 샘플 10개 이상으로 분리 품질, 음표 P/R,
   코드 정확도, 타브 변환 가능 비율, 실제 연주 가능성 측정
1. 악보 데이터 엔진 (스키마, 줄·프렛 변환, 타브 렌더링)
2. 분석 백엔드 (FastAPI, Celery/Redis, FFmpeg, 모델 파이프라인, 만료 처리)
3. 웹 UI (입력·진행·결과 화면, 오류/부분 결과)
4. 통합·사용자 테스트 (모바일, 실패·재시도, 사용자 5명 이상)

## 작업 지침

- 모델 선택은 실제 테스트셋 지표(음표 precision/recall/F1, onset·offset 오차, 코드 구간
  정확도, 타브 물리적 연주 가능 비율)로 결정한다. 추측으로 확정하지 않는다.
- 새 분석 단계를 추가할 때는 상태 값, 오류 코드, 부분 성공 처리 방식을 함께 정의한다.
- API 응답 스키마는 Pydantic(백엔드)과 TypeScript 타입(프론트)을 일치시킨다.
- 명령어나 구조가 바뀌면 "빌드/테스트 명령" 섹션을 함께 갱신한다.
- 프론트엔드는 Nuxt 4(Vue)다. PRD에 나오는 Next.js/shadcn/TanStack Query/VexFlow는 위 기술 스택 표의
  Nuxt 대응 항목(CSS 변수 토큰, `useFetch`, 자체 SVG 악보 렌더러)으로 바꿔 읽는다.

## UI 디자인 가이드 (Airbnb 디자인 시스템 참고)

Airbnb 디자인 시스템을 시각적 기준으로 삼는다. 흰 바탕, 진한 잉크색 텍스트, 단 하나의 강조색,
둥근 모서리, 그림자 한 단계라는 원칙을 따른다. 아래 토큰은 `app/assets/css/main.css`의
CSS 변수(`:root`)로 등록해 사용한다. 값은 Airbnb 원본이며, 자체 브랜드 색을 정하면 `primary` 계열만 교체한다.

### 색상 토큰

| 토큰 | 값 | 용도 |
|---|---|---|
| canvas | #ffffff | 페이지 바탕 (다크 모드 없음) |
| ink | #222222 | 제목·본문 (순수 검정 금지) |
| body | #3f3f3f | 긴 설명 텍스트 |
| muted / muted-soft | #6a6a6a / #929292 | 보조 텍스트 / 비활성 |
| primary | #ff385c | 주요 CTA, 강조 (페이지당 한두 곳만) |
| primary-active | #e00b41 | CTA 눌림 상태 |
| primary-disabled | #ffd1da | CTA 비활성 |
| on-primary | #ffffff | primary 위 텍스트 |
| surface-soft / strong | #f7f7f7 / #f2f2f2 | 연한 채움 / 원형 아이콘 버튼 배경 |
| hairline / soft / strong | #dddddd / #ebebeb / #c1c1c1 | 1px 구분선·테두리 |
| error | #c13515 | 입력 오류 텍스트 (primary와 구분) |
| scrim | #000000, 불투명도 50% | 모달 배경 |

### 타이포그래피

- 폰트: Airbnb Cereal VF는 라이선스 폰트이므로 쓰지 않고, 대체 폰트 **Inter**를 사용한다.
  폴백은 `-apple-system, system-ui, Roboto, "Helvetica Neue", sans-serif`.
  Inter 사용 시 제목 line-height를 약 2% 줄인다.
- 제목은 작고 가볍게(22–28px, weight 500–700), 시각적 무게는 이미지와 악보가 담당한다.
- 주요 크기: h1 28/700, 섹션 제목 21/700, 서브 20/600, 카드 제목 16/600, 본문 16/400,
  보조 14/400, 캡션 14/500, 법적 문구 13/400, 버튼 16/500.

### 형태·간격·그림자

- 반경: 버튼·입력 8px, 카드 약 14px, 검색/입력 필 `full`, 아이콘 버튼 원형. 각진 모서리 없음.
- 간격: 4px 기본 단위(2/4/8/12/16/24/32/48), 큰 구획 세로 여백 64px, 카드 간격 16px,
  카드 내부 여백 24px(정보 카드) / 16px(메타 영역).
- 그림자는 단 한 단계만 사용한다 (호버로 떠오른 카드, 드롭다운):
  `0 0 0 1px rgba(0,0,0,.02), 0 2px 6px rgba(0,0,0,.04), 0 4px 8px rgba(0,0,0,.1)`.
  그 외는 모두 flat, 깊이는 흰 바탕 대비와 둥근 모서리로 표현한다.

### 컴포넌트 규칙 (이 프로젝트 화면에 적용)

- **기본 버튼**: primary 배경, 흰 글자, 8px 반경, 높이 48px, 패딩 14×24px, weight 500.
  눌림은 `primary-active` 색만 바꾼다 (transform·그림자 변화 없음).
  보조 버튼은 흰 바탕 + 1px ink 테두리. 텍스트 버튼은 hover 시 밑줄.
- **링크 입력(화면 1)**: 흰 바탕, 1px hairline, 8px 반경, 높이 56px. 위에 14/500 muted 라벨,
  placeholder는 muted. 포커스 시 테두리 2px ink (글로우·링 없음). 오류 문구는 `error` 색.
  URL 형식 오류와 서버 오류는 구분해서 표시한다.
- **진행 화면(화면 2)**: 실제 작업 상태(`stage`)만 텍스트로 표시한다. 가짜 퍼센트 금지.
  카드는 흰 바탕 + hairline + 14px 반경.
- **결과 화면(화면 3)**: 코드 악보와 타브를 섹션으로 구분하고 같은 시간 구간끼리 정렬한다.
  "추정 타브", "불확실 구간" 표시는 14px muted 보조 텍스트 + 작은 필 배지(11/600)로 한다.
  악보 영역은 흰 바탕에 ink 색 렌더링.
- **탭(코드/타브 전환)**: 활성 탭은 ink 라벨 + 2px ink 밑줄, 비활성은 muted 라벨.
- **배지**: `full` 반경 필, 11/600, 흰 바탕 (그림자 한 단계 허용).
- **모달·알림**: scrim 50% 배경, 흰 패널, 그림자 한 단계.
- **구분선**: 섹션 사이는 1px hairline, 목록 행에는 행 사이 테두리를 넣지 않는다.

### 반응형

| 구간 | 너비 | 변화 |
|---|---|---|
| Mobile | < 744px | 단일 열, 입력과 CTA는 전체 너비, 악보는 가로 스크롤 허용 |
| Tablet | 744–1128px | 2열 가능, 컨테이너 여백 확대 |
| Desktop | 1128–1440px | 콘텐츠 최대 너비 약 1080–1280px, 가운데 정렬 |
| Wide | > 1440px | 최대 1440px에서 고정, 나머지는 여백 |

- 열 수는 줄이되 행 단위로 재배치하지 않는다.
- 터치 타깃: 주요 CTA 최소 48×48px, 원형 아이콘 버튼 32px 이상(안쪽 여백 12px 확보).
- 컨테이너 좌우 여백 기본 16px.

### 사용하지 않을 것

- 강조색을 여러 곳에 쓰는 것 (primary는 한두 군데만)
- 다단계 그림자, 어두운 푸터, 다크 모드
- 별점 등 수치 아이콘에 노랑/금색 사용 (ink 사용)
- Airbnb 로고·워드마크·일러스트 아이콘·전용 문구 (참고는 스타일 토큰까지만)

## 빌드/테스트 명령

```bash
# 1단계 평가 하니스 (Python 3.11+, numpy/scipy/pytest, ffmpeg 필요)
cd analysis && python -m pytest -q
cd analysis && python -m tabeval.run_eval --synthetic --out reports/   # 합성음 동작 확인

# 2단계 악보 데이터 엔진 (Python, pydantic 필요)
cd engine && python -m pytest -q

# 웹 (Nuxt 4)
npm install          # postinstall에서 nuxt prepare 실행
npm run dev
npm run test:logic   # 공유 유틸·데모 API 로직 테스트 (Node 22.6+, Nuxt 설치 불필요)
npm run typecheck    # vue-tsc 타입 검사
```

- 화면: `app/pages/index.vue`(링크 입력) → `app/pages/analyses/[id]/index.vue`(진행, 1.5초 간격 상태 조회)
  → `app/pages/analyses/[id]/result.vue`(결과, `app/components/SheetRow.vue`가 코드 띠 + TAB을 SVG로 그림).
  작업 접근 토큰은 URL에 넣지 않고 sessionStorage에만 둔다(`app/composables/useJobAccess.ts`).
- 데모 API: 링크 경로에 `fail`/`partial`이 들어가면 실패·부분 성공 상태를 볼 수 있다(Apify를 켜지 않았을 때만).
  응답의 `is_demo: true`는 실제 분석이 아닌 샘플 악보라는 뜻이다.
- 진행 상황은 `docs/ROADMAP.md` 참고(PRD Phase 0~4 = 1~5단계).

## 미확정 사항

- 업로드 대체 경로를 MVP에 포함할지 (개발 착수 전 확정 필요)
- 보컬/반주 분리를 쓸지, 원본과 분리본 중 무엇이 전사에 유리한지 (Phase 0에서 결정)
- 최종 전사 모델 선택
- 성공 지표의 초기 목표치 (기준선 측정 후 결정)
