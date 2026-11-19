# vibe-coding — 기타 영상 악보 변환

기타를 치며 노래하는 영상의 링크를 입력하면 코드 악보와 추정 기타 타브를 만들어 주는 웹서비스(MVP 개발 중).

- 기획: [`PRD.md`](PRD.md) · 디자인: [`DESIGN.md`](DESIGN.md) · 작업 지침: [`CLAUDE.md`](CLAUDE.md)
- 개발 단계와 현재 상태: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- 1단계 기술 타당성 검증 하니스: [`analysis/`](analysis/README.md)
- 2단계 악보 데이터 엔진(스키마, 줄·프렛 변환): [`engine/`](engine/README.md)
- Apify 영상 확인 설정: [`.env.example`](.env.example)
- 웹(Nuxt 4): `app/`, `server/`, `shared/`

현재 웹의 분석 API는 샘플 악보를 돌려주는 **데모**입니다. 실제 영상 분석은 1~3단계 이후에 연결합니다.
