# engine — 2단계(PRD Phase 1) 악보 데이터 엔진

분석 결과를 담는 **스키마**, MIDI 음정을 기타 줄·프렛으로 옮기는 **변환**, 텍스트 **타브 렌더러**입니다.

```bash
cd engine
pip install -r requirements.txt
python -m pytest -q
```

## 구성

| 파일 | 역할 |
|---|---|
| `guitartab/schema.py` | `NoteEvent`, `ChordEvent`, `TabNote`, `Score` 등 Pydantic 모델. 필드 이름은 API·`shared/types/analysis.ts`와 같고, 테스트가 일치를 검사합니다. |
| `guitartab/fretting.py` | `arrange(notes)` — 동시 음 묶음별 후보 생성 후 Viterbi로 경로 선택 |
| `guitartab/render_ascii.py` | `render_ascii(tab, chords)` — 미리보기·내보내기용 ASCII 타브 |

## 변환 방식과 한계

- 표준 튜닝, 카포 없음, 기본 15프렛, 손 벌림 4프렛이 기본값이며 `ArrangeConfig`로 바꿀 수 있습니다.
- 낮은 포지션과 적은 손 이동을 선호합니다. 가중치는 합성 화음으로 맞춘 임시값입니다.
- **원 연주자의 운지를 복원하지 않습니다.** 같은 음정을 여러 줄에서 낼 수 있으므로 "칠 수 있는 추정 타브"입니다.
- 칠 수 없는 음표는 버리지 않고 `unplayable`에 이유(`OUT_OF_RANGE`, `TOO_MANY_VOICES`, `NO_PLAYABLE_FINGERING`)와 함께 돌려줍니다.
  `ArrangeResult.coverage`가 옮긴 비율입니다(1단계의 "타브 변환 가능 비율" 지표에 씁니다).
- 슬라이드·해머온 같은 주법, 전위·텐션에 따른 보이싱 선택, 리듬 양자화는 다루지 않습니다.

## 아직 안 한 것

- 실제 전사 결과(잡음 섞인 음표)로의 검증 — 1단계 샘플이 필요합니다.
- 코드 이름을 보고 보이싱을 고르는 로직(현재는 음표 기준으로만 배치).
- `analysis/tabeval/metrics.py`와 `STANDARD_TUNING`이 중복되어 있습니다. 한쪽을 기준으로 합칠 예정입니다.
