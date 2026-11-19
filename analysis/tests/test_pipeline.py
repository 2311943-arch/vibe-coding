import json
import shutil
import subprocess

import pytest

from tabeval.chroma_baseline import ChromaChordEstimator
from tabeval.manifest import load_manifest
from tabeval.metrics import chord_accuracy, is_consistent
from tabeval.models import Chord, TabNote
from tabeval.preprocess import PreprocessError, probe_duration, to_mono_wav
from tabeval.run_eval import run, synthetic_samples
from tabeval.synth import synth_progression, write_wav


def test_synth_ground_truth_is_consistent():
    audio, notes, chords = synth_progression(['C', 'G', 'Am', 'F'])
    assert len(chords) == 4 and len(notes) == 32
    assert all(40 <= n.pitch <= 79 for n in notes)
    assert abs(len(audio) / 22050 - 8.9) < 0.01  # 8초 + 마지막 음의 여운 0.9초


def test_chroma_baseline_on_synthetic_audio(tmp_path):
    """합성음에서 기준선이 맞게 돌아가는지만 확인한다(실제 연주 정확도와는 무관)."""
    audio, _, chords = synth_progression(['C', 'G', 'Am', 'F'])
    wav = tmp_path / 'a.wav'
    write_wav(wav, audio)
    est = ChromaChordEstimator().estimate(wav)
    assert chord_accuracy(chords, est, 'majmin') > 0.8


def test_run_synthetic_writes_report(tmp_path):
    samples = synthetic_samples(tmp_path)
    report = run(samples, [], tmp_path / 'out', synthetic=True)
    text = report.read_text(encoding='utf-8')
    assert '합성 데이터 결과' in text
    assert '10개 미만' in text  # 샘플 수 경고가 나와야 한다
    data = json.loads((tmp_path / 'out' / 'phase0-report.json').read_text(encoding='utf-8'))
    assert len(data) == 2


def test_manifest_requires_rights_confirmation(tmp_path):
    audio, notes, chords = synth_progression(['C', 'G'])
    write_wav(tmp_path / 'a.wav', audio)
    (tmp_path / 'ref.json').write_text(json.dumps({'notes': [], 'chords': [{'name': 'C', 'start': 0, 'end': 2}]}))
    manifest = {
        'samples': [
            {'id': 'ok', 'audio': 'a.wav', 'reference': 'ref.json', 'rights_confirmed': True},
            {'id': 'no-rights', 'audio': 'a.wav', 'reference': 'ref.json', 'rights_confirmed': False},
            {'id': 'missing', 'audio': 'nope.wav', 'reference': 'ref.json', 'rights_confirmed': True},
            {'id': 'ok', 'audio': 'a.wav', 'reference': 'ref.json', 'rights_confirmed': True},
        ]
    }
    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps(manifest))
    samples, skipped = load_manifest(path)
    assert [s.id for s in samples] == ['ok']
    assert len(skipped) == 3


@pytest.mark.skipif(shutil.which('ffmpeg') is None, reason='ffmpeg 없음')
def test_ffmpeg_preprocess(tmp_path):
    audio, _, _ = synth_progression(['C'])
    src = tmp_path / 'src.wav'
    write_wav(src, audio, sr=44100)  # 일부러 다른 샘플레이트로 기록
    out = to_mono_wav(src, tmp_path / 'out.wav')
    assert out.exists() and probe_duration(out) > 1.0

    not_audio = tmp_path / 'x.txt'
    not_audio.write_text('hello')
    with pytest.raises(PreprocessError):
        probe_duration(not_audio)


def test_tab_note_consistency_helper():
    assert is_consistent(TabNote(48, 5, 3, 0, 1))
    assert not is_consistent(TabNote(48, 5, 4, 0, 1))
    assert not is_consistent(TabNote(40, 7, 0, 0, 1))


def test_cli_synthetic(tmp_path):
    proc = subprocess.run(
        ['python3', '-m', 'tabeval.run_eval', '--synthetic', '--out', str(tmp_path / 'r')],
        capture_output=True, text=True, cwd=str(__import__('pathlib').Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    assert (tmp_path / 'r' / 'phase0-report.md').exists()
