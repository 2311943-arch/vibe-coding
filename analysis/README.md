# analysis — 1단계(PRD Phase 0) 기술 타당성 검증 하니스

PRD가 가장 먼저 증명하라고 한 가설을 측정하기 위한 도구입니다.

> 권한이 확인된 기타 노래 반주 오디오 → 실제로 따라 칠 수 있는 수준의 코드·타브 악보로 바꿀 수 있는가?

## 현재 상태 (솔직하게)

| 항목 | 상태 |
|---|---|
| 평가 지표 (음표 P/R/F1·onset 오차, 코드 구간 정확도, 타브 연주 가능 비율, 기타 음역 비율) | 구현, 테스트 통과 |
| FFmpeg 전처리 (`to_mono_wav`, `probe_duration`) | 구현, 테스트 통과 |
| 코드 추정 기준선 (크로마 템플릿 + Viterbi) | 구현. **합성음에서만** 확인함 |
| 매니페스트 로더 (`rights_confirmed: true`인 샘플만 사용) | 구현, 테스트 통과 |
| Basic Pitch 어댑터 | 코드만 작성. **실행해 본 적 없음** (개발 환경에 미설치) |
| Demucs 분리 평가 | 미구현 |
| 실제 기타 영상 샘플 10개 이상 | **없음. 사용자가 준비해야 함** |

따라서 지금 이 하니스로 낼 수 있는 점수는 합성음 기준이며, 기술 타당성의 증거가 아닙니다.
1단계는 아래 "남은 일"이 끝나야 완료됩니다.

## 실행

```bash
cd analysis
pip install -r requirements.txt
python -m pytest -q                                   # 테스트
python -m tabeval.run_eval --synthetic --out reports/ # 하니스 동작 확인(합성음)
python -m tabeval.run_eval --manifest samples/manifest.json --out reports/
```

리포트는 `reports/phase0-report.md`, `reports/phase0-report.json`으로 저장됩니다.
PRD 11장에 따라 목표치는 기준선을 측정한 뒤 정하므로, 리포트는 합격/불합격을 판정하지 않습니다.

## 샘플 준비 방법

1. 분석 권한이 있는 영상(직접 촬영했거나 사용 허락을 받은 것)을 `samples/`에 둔다.
2. `ffmpeg`로 오디오를 뽑거나, `tabeval.preprocess.to_mono_wav`를 쓴다.
3. 사람이 정답 음표·코드를 `reference` JSON으로 작성한다. 형식은 `tabeval/manifest.py` 상단 주석 참고.
4. `samples/manifest.json`에 항목을 추가한다. 형식은 `samples/manifest.example.json`.
   `rights_confirmed`가 `true`가 아니면 평가에서 제외됩니다.

## 남은 일 (1단계 완료 조건)

- [ ] 권한이 확인된 샘플 10개 이상과 정답 작성
- [ ] Basic Pitch 설치 후 어댑터 실행 확인, 필요하면 다성 전사 모델 어댑터 추가
- [ ] Demucs 계열 분리 전/후 비교 (원본과 분리본 모두 평가)
- [ ] 사람이 결과 타브를 직접 쳐 보는 평가 항목 추가
- [ ] 결과를 보고 모델·파이프라인 선정 또는 지원 영상 범위 축소 결정

## 구조

```
tabeval/
  models.py          Note, Chord, TabNote
  metrics.py         평가 지표
  preprocess.py      FFmpeg 전처리
  chroma_baseline.py 코드 추정 기준선
  adapters.py        전사 모델 어댑터 인터페이스
  manifest.py        샘플 매니페스트 로더
  synth.py           하니스 확인용 합성 소리
  run_eval.py        평가 실행기와 리포트
tests/               pytest
samples/             매니페스트 예시 (실제 오디오는 커밋하지 않음)
```
