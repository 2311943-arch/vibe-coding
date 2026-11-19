"""1단계 평가 실행기.

사용법 (analysis/ 폴더에서):
  python -m tabeval.run_eval --manifest samples/manifest.json --out reports/
  python -m tabeval.run_eval --synthetic --out reports/      # 하니스 동작 확인용(타당성 증거 아님)

PRD 11장: 초기 목표치는 기준선을 측정한 뒤 정한다. 그래서 이 리포트는 합격/불합격을 판정하지 않고 측정값만 보고한다.
"""

from __future__ import annotations

import argparse
import json
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from statistics import mean

from .adapters import available_transcribers
from .chroma_baseline import ChromaChordEstimator
from .manifest import Sample, load_manifest
from .metrics import chord_accuracy, guitar_range_coverage, note_scores
from .models import Chord, Note
from .synth import synth_progression, write_wav

MIN_SAMPLES = 10  # PRD 10장 Phase 0


@dataclass
class SampleResult:
    sample_id: str
    chord_exact: float | None = None
    chord_majmin: float | None = None
    chord_root: float | None = None
    transcribers: dict[str, dict[str, float | None]] = field(default_factory=dict)


def evaluate_sample(sample: Sample) -> SampleResult:
    result = SampleResult(sample.id)

    est_chords = ChromaChordEstimator().estimate(sample.audio)
    if sample.chords:
        result.chord_exact = chord_accuracy(sample.chords, est_chords, 'exact')
        result.chord_majmin = chord_accuracy(sample.chords, est_chords, 'majmin')
        result.chord_root = chord_accuracy(sample.chords, est_chords, 'root')

    transcribers, _ = available_transcribers()
    for t in transcribers:
        est_notes: list[Note] = t.transcribe(sample.audio)
        scores = note_scores(sample.notes, est_notes) if sample.notes else None
        result.transcribers[t.name] = {
            'precision': scores.precision if scores else None,
            'recall': scores.recall if scores else None,
            'f1': scores.f1 if scores else None,
            'mean_onset_error_s': scores.mean_onset_error if scores else None,
            'guitar_range_coverage': guitar_range_coverage(est_notes),
        }
    return result


def _avg(values: list[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return mean(present) if present else None


def _fmt(v: float | None) -> str:
    return '-' if v is None else f'{v:.3f}'


def render_markdown(results: list[SampleResult], skipped: list[str], adapter_skips: list[str], synthetic: bool) -> str:
    lines = ['# 1단계 기술 타당성 검증 리포트', '']
    if synthetic:
        lines += [
            '> **합성 데이터 결과입니다.** 하니스가 맞게 동작하는지 확인하는 용도이며, '
            '실제 기타 연주 영상에서의 정확도를 뜻하지 않습니다.',
            '',
        ]
    n = len(results)
    lines.append(f'- 평가한 샘플: **{n}개** (PRD 기준 최소 {MIN_SAMPLES}개)')
    if n < MIN_SAMPLES:
        lines.append(f'- ⚠ 샘플이 {MIN_SAMPLES}개 미만이라 모델·파이프라인을 선정할 근거로 쓸 수 없습니다.')
    for s in skipped:
        lines.append(f'- 제외된 샘플: {s}')
    for s in adapter_skips:
        lines.append(f'- 건너뛴 모델: {s}')
    lines += ['', '## 코드 구간 정확도 (크로마 템플릿 기준선)', '',
              '| 샘플 | exact | 장/단 | 근음 |', '|---|---|---|---|']
    for r in results:
        lines.append(f'| {r.sample_id} | {_fmt(r.chord_exact)} | {_fmt(r.chord_majmin)} | {_fmt(r.chord_root)} |')
    lines.append(
        f'| **평균** | {_fmt(_avg([r.chord_exact for r in results]))} | '
        f'{_fmt(_avg([r.chord_majmin for r in results]))} | {_fmt(_avg([r.chord_root for r in results]))} |'
    )

    names = sorted({name for r in results for name in r.transcribers})
    if names:
        lines += ['', '## 음표 전사 (onset 허용 오차 50ms)', '',
                  '| 모델 | 샘플 | precision | recall | F1 | 평균 onset 오차(초) | 기타 음역 비율 |',
                  '|---|---|---|---|---|---|---|']
        for name in names:
            for r in results:
                m = r.transcribers.get(name)
                if not m:
                    continue
                lines.append(
                    f'| {name} | {r.sample_id} | {_fmt(m["precision"])} | {_fmt(m["recall"])} | {_fmt(m["f1"])} | '
                    f'{_fmt(m["mean_onset_error_s"])} | {_fmt(m["guitar_range_coverage"])} |'
                )
    else:
        lines += ['', '## 음표 전사', '', '사용 가능한 전사 모델이 없어 측정하지 못했습니다. '
                  '`analysis/README.md`의 설치 안내를 참고하세요.']

    lines += ['', '## 아직 측정하지 못한 항목', '',
              '- 기타/보컬 분리 품질 (Demucs 계열 미설치)',
              '- 사람이 실제로 따라 연주할 수 있는지 (사람 평가 필요)',
              '- 타브 변환 가능 비율 (2단계의 줄·프렛 배치 구현 후)', '']
    return '\n'.join(lines)


def run(samples: list[Sample], skipped: list[str], out_dir: Path, synthetic: bool) -> Path:
    results = [evaluate_sample(s) for s in samples]
    _, adapter_skips = available_transcribers()

    out_dir.mkdir(parents=True, exist_ok=True)
    md = render_markdown(results, skipped, adapter_skips, synthetic)
    (out_dir / 'phase0-report.md').write_text(md, encoding='utf-8')
    (out_dir / 'phase0-report.json').write_text(
        json.dumps([r.__dict__ for r in results], ensure_ascii=False, indent=2), encoding='utf-8'
    )
    return out_dir / 'phase0-report.md'


def synthetic_samples(directory: Path) -> list[Sample]:
    progressions = [['C', 'G', 'Am', 'F'], ['Am', 'F', 'C', 'G']]
    samples: list[Sample] = []
    for i, prog in enumerate(progressions, start=1):
        audio, notes, chords = synth_progression(prog)
        path = directory / f'synthetic-{i}.wav'
        write_wav(path, audio)
        samples.append(Sample(f'synthetic-{i}', path, notes, chords, 'synthetic'))
    return samples


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--synthetic', action='store_true')
    parser.add_argument('--out', type=Path, default=Path('reports'))
    args = parser.parse_args()

    if bool(args.manifest) == bool(args.synthetic):
        parser.error('--manifest 와 --synthetic 중 하나만 지정하세요.')

    if args.synthetic:
        with tempfile.TemporaryDirectory() as tmp:
            report = run(synthetic_samples(Path(tmp)), [], args.out, synthetic=True)
    else:
        samples, skipped = load_manifest(args.manifest)
        report = run(samples, skipped, args.out, synthetic=False)
    print(f'리포트: {report}')


if __name__ == '__main__':
    main()
