"""FFmpeg/ffprobe 전처리 (PRD 4.3). 접근 권한이 확인된 로컬 파일만 입력으로 받는다.

이 모듈은 URL을 내려받지 않는다. 미디어 확보는 PRD 5장의 정책에 따라 별도로 다룬다.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

TARGET_SAMPLE_RATE = 22050


class PreprocessError(RuntimeError):
    pass


def probe_duration(path: Path) -> float:
    """ffprobe로 길이(초)를 읽는다. 오디오 스트림이 없으면 PreprocessError."""
    cmd = [
        'ffprobe', '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_type:format=duration',
        '-of', 'json', str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise PreprocessError(f'ffprobe 실패: {proc.stderr.strip()[:200]}')
    info = json.loads(proc.stdout or '{}')
    if not info.get('streams'):
        raise PreprocessError('오디오 트랙이 없습니다.')
    try:
        return float(info['format']['duration'])
    except (KeyError, ValueError) as exc:
        raise PreprocessError('길이를 읽을 수 없습니다.') from exc


def to_mono_wav(src: Path, dst: Path, sample_rate: int = TARGET_SAMPLE_RATE) -> Path:
    """영상/오디오 파일에서 모노 16bit WAV를 만든다."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        'ffmpeg', '-y', '-v', 'error', '-i', str(src), '-vn',
        '-ac', '1', '-ar', str(sample_rate), '-c:a', 'pcm_s16le', str(dst),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0 or not dst.exists():
        raise PreprocessError(f'ffmpeg 변환 실패: {proc.stderr.strip()[:200]}')
    return dst
