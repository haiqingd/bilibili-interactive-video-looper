"""Local ending-card OCR. Playback URLs and credentials are never stored."""
import csv
import io
import importlib.util
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlparse
from .bilibili import BilibiliError
from .endings import choose_evidence, frame_candidate, clean_text


def available():
    return bool(shutil.which('ffmpeg') and shutil.which('tesseract') and importlib.util.find_spec('PIL'))


def media_url(value):
    parsed = urlparse(str(value))
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443) or not any(
            (parsed.hostname or '').endswith('.' + suffix) for suffix in ('bilivideo.com', 'bilivideo.cn', 'hdslb.com')):
        raise BilibiliError('视频媒体地址不在允许的 Bilibili CDN 范围。')
    return value


def read_text(image, folder):
    from PIL import Image, ImageOps, ImageStat
    with Image.open(image) as original:
        grey = ImageOps.autocontrast(ImageOps.grayscale(original))
        if ImageStat.Stat(grey).mean[0] < 100: grey = ImageOps.invert(grey)
        grey = grey.resize((grey.width * 2, grey.height * 2))
        processed = folder / 'ocr.png'; grey.save(processed)
    output = subprocess.run(['tesseract', str(processed), 'stdout', '-l', 'chi_sim+chi_tra+eng', '--psm', '11', 'tsv'],
                            capture_output=True, timeout=25, env={**os.environ, "OMP_THREAD_LIMIT": "2"}, check=True)
    lines, confidence, bounds = {}, [], {}
    for item in csv.DictReader(io.StringIO(output.stdout.decode('utf-8', errors='replace')), delimiter='\t'):
        word = item.get('text', '').strip()
        if not word: continue
        key = tuple(item.get(k) for k in ('page_num', 'block_num', 'par_num', 'line_num'))
        lines.setdefault(key, []).append(word)
        bounds.setdefault(key, []).append((int(item['top']), int(item['height'])))
        try: confidence.append(float(item['conf']))
        except (ValueError, KeyError): pass
    rendered = [' '.join(words) for words in lines.values()]
    text = '\n'.join(rendered)[:4000]
    candidate = frame_candidate(text)
    if candidate and not re.search(r'[\u4e00-\u9fff]{2}', candidate['name']):
        # Sparse OCR can mistake thin Chinese headings for Latin letters. Isolate
        # the name below a recognized ending-code heading and use a Chinese pass.
        for index, (key, words) in enumerate(lines.items()):
            line = clean_text(' '.join(words))
            if not re.fullmatch(r'(?:HAPPY|BAD|NORMAL|TRUE|GOOD|OPEN|SECRET|SPECIAL) END(?:ING)?\s*\d{1,4}', line, re.I): continue
            top = min(y for y, h in bounds[key]); height = max(h for y, h in bounds[key])
            box = (int(grey.width * .1), min(grey.height - 1, top + height + 8), int(grey.width * .9), min(grey.height, top + height * 5))
            if box[3] <= box[1]: continue
            crop = folder / 'heading.png'; grey.crop(box).save(crop)
            extra = subprocess.run(['tesseract', str(crop), 'stdout', '-l', 'chi_sim+eng', '--psm', '6', 'tsv'],
                capture_output=True, timeout=15, env={**os.environ, 'OMP_THREAD_LIMIT': '2'}, check=True)
            tokens = list(csv.DictReader(io.StringIO(extra.stdout.decode('utf-8', errors='replace')), delimiter='\t'))
            words2 = [t['text'] for t in tokens if t.get('text', '').strip()]
            scores = [float(t['conf']) for t in tokens if t.get('text', '').strip()]
            name = clean_text(' '.join(words2))
            if 2 <= len(name) <= 35 and len(re.findall(r'[\u4e00-\u9fff]', name)) >= 2 and not re.search(r'[，。！？,;；]', name) and sum(scores) / max(1, len(scores)) >= 45:
                rendered.insert(index + 1, name); text = '\n'.join(rendered)[:4000]
            break
    return text, sum(confidence) / max(len(confidence), 1)


def recognize(client, bvid, cid, evidence_dir):
    if not available(): raise BilibiliError('当前运行环境没有片尾识别组件，请使用更新后的 Docker 镜像。')
    if not re.fullmatch(r'BV[A-Za-z0-9]{10}', str(bvid)) or not str(cid).isdigit() or int(cid) <= 0:
        raise BilibiliError('这个结局没有可读取的 Bilibili 视频编号。')
    playback = client.get('/x/player/playurl', {'bvid': bvid, 'cid': cid, 'qn': 32, 'fnval': 0, 'fourk': 0})
    clips = playback.get('durl') or []
    if len(clips) != 1: raise BilibiliError('当前接口没有返回可读取的单段视频，暂时无法识别片尾。')
    url = media_url(clips[0].get('url', ''))
    duration = float(playback.get('timelength', clips[0].get('length', 0))) / 1000
    if not 0 < duration <= 14400: raise BilibiliError('视频时长无效。')
    # Sample the last 24 seconds, up to thirteen frames; includes the final second.
    start = max(0, duration - 25); interval = max(1, (duration - start - 1) / 12)
    evidence_dir = Path(evidence_dir); evidence_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ending-ocr-') as temporary:
        folder = Path(temporary)
        try:
            subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '2',
                            '-rw_timeout', '15000000', '-user_agent', 'Mozilla/5.0', '-referer', 'https://www.bilibili.com/',
                            '-ss', str(start), '-i', url, '-t', str(duration - start), '-an',
                            '-vf', f'fps=1/{interval}:start_time=0:round=down,scale=960:-2', '-frames:v', '13', '-threads', '2',
                            str(folder / 'frame-%02d.jpg')], capture_output=True, timeout=60, check=True)
            frames = []
            for index, image in enumerate(sorted(folder.glob('frame-*.jpg'))):
                text, confidence = read_text(image, folder)
                frames.append({'time': round(min(duration, start + index * interval), 2), 'text': text,
                               'confidence': round(confidence, 1), '_image': image})
            if not frames: raise BilibiliError('未能读取片尾画面。')
            result = choose_evidence(frames)
            if result['status'] != 'recognized':
                # Ending cards can appear only during the final fade: sample it densely.
                tail_start = max(0, duration - 3)
                subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '2',
                    '-rw_timeout', '15000000', '-user_agent', 'Mozilla/5.0', '-referer', 'https://www.bilibili.com/',
                    '-ss', str(tail_start), '-i', url, '-t', str(duration - tail_start), '-an',
                    '-vf', 'fps=4:start_time=0:round=down,scale=960:-2', '-frames:v', '12', '-threads', '2',
                    str(folder / 'tail-%02d.jpg')], capture_output=True, timeout=40, check=True)
                for index, image in enumerate(sorted(folder.glob('tail-*.jpg'))):
                    text, confidence = read_text(image, folder)
                    frames.append({'time': round(tail_start + index / 4, 2), 'text': text,
                                   'confidence': round(confidence, 1), '_image': image})
                result = choose_evidence(frames)
            if result['status'] != 'recognized' and duration > 15:
                # Some ending clips show the card first, followed by a long explanation.
                subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '2',
                    '-rw_timeout', '15000000', '-user_agent', 'Mozilla/5.0', '-referer', 'https://www.bilibili.com/',
                    '-i', url, '-t', '12', '-an', '-vf', 'fps=1:start_time=0:round=down,scale=960:-2',
                    '-frames:v', '12', '-threads', '2', str(folder / 'intro-%02d.jpg')],
                    capture_output=True, timeout=40, check=True)
                for index, image in enumerate(sorted(folder.glob('intro-*.jpg'))):
                    text, confidence = read_text(image, folder)
                    frames.append({'time': float(index), 'text': text, 'confidence': round(confidence, 1), '_image': image})
                result = choose_evidence(frames)
            for frame in result['frames']:
                filename = uuid.uuid4().hex + '.jpg'
                shutil.copyfile(frame.pop('_image'), evidence_dir / filename)
                frame.pop('candidate', None); frame['file'] = filename
            result['cid'] = int(cid)
            return result
        except (subprocess.SubprocessError, OSError, ValueError) as exc:
            if isinstance(exc, BilibiliError): raise
            # FFmpeg stderr contains signed URLs; do not return or log it.
            raise BilibiliError('片尾视频读取或文字识别失败，可稍后重试；已有分类仍会保留。') from None
