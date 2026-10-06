"""Explicit ending labels and local OCR evidence, separate from reachability."""
import re
import hashlib
import unicodedata
from collections import defaultdict

CATEGORIES = {'HE', 'BE', 'NE', 'TE', 'GE', 'OE', 'SE'}
MARKER = re.compile(r'(?<![A-Za-z])(HE|BE|NE|TE|GE|OE|SE)(?![A-Za-z])(?:[\s._#-]*\d{1,4})?')
PHRASES = {'HE': ('HAPPY ENDING', 'HAPPY END', '好结局', '幸福结局', '圆满结局', '美好结局'),
           'BE': ('BAD ENDING', 'BAD END', '坏结局', '悲剧结局'),
           'NE': ('NORMAL ENDING', 'NORMAL END', '普通结局', '正常结局'),
           'TE': ('TRUE ENDING', 'TRUE END', '真结局'),
           'GE': ('GOOD ENDING', 'GOOD END'), 'OE': ('OPEN ENDING', '开放结局'),
           'SE': ('SECRET ENDING', '隐藏结局')}


def clean_text(text):
    text = unicodedata.normalize('NFKC', str(text or ''))[:4000]
    # OCR often separates each Chinese character. Keep Latin word boundaries.
    for _ in range(2): text = re.sub(r'(?<=[\u4e00-\u9fff])[^\S\n]+(?=[\u4e00-\u9fff])', '', text)
    return text.strip()


def explicit_category(text):
    text = clean_text(text); categories = set(); matches = []
    candidates = [(m.start(), m.group(1).upper(), m.group()) for m in MARKER.finditer(text)]
    for kind, phrases in PHRASES.items():
        for phrase in phrases:
            for m in re.finditer(re.escape(phrase), text, re.I): candidates.append((m.start(), kind, m.group()))
    for position, kind, literal in candidates:
        if kind == 'BE' and re.search(r'TO\s+BE\s+CONTINUED', text[max(0, position - 4):position + 20], re.I): continue
        if re.search(r'(?:不是|没有|非|无|未达成|未获得|不算|NOT)\s*$', text[max(0, position - 12):position], re.I): continue
        categories.add(kind); matches.append(literal)
    return (next(iter(categories)) if len(categories) == 1 else None), list(dict.fromkeys(matches)), len(categories) > 1


def title_annotation(title):
    text = clean_text(title); category, markers, ambiguous = explicit_category(text)
    candidate = frame_candidate(text) if not ambiguous else None
    name = candidate['name'] if candidate else text if category else None
    return {'name': name, 'category': category, 'source': 'title' if name or markers else 'unknown',
            'status': 'ambiguous' if ambiguous else 'recognized' if name else 'unknown',
            'needs_review': False, 'text': text if name or markers else '', 'frames': [],
            'reason': '标题包含多种结局标记' if ambiguous else '作者标题明确标注' if name else '标题没有明确的结局名称'}


def normalized_name(name):
    # Normalize typography only; never merge merely similar names or ending codes.
    return re.sub(r'[\s·•「」【】]+', '', clean_text(name)).casefold()


def group_endings(graph):
    annotations = graph.get('ending_annotations', {}); grouped = {}
    for ending in graph.get('analysis', {}).get('endings', []):
        annotation = annotations.get(str(ending['id']), {})
        name = annotation.get('name') if annotation.get('status') == 'recognized' else None
        normalized = normalized_name(name) if name else ''
        key = 'name:' + normalized if normalized else 'node:' + str(ending['id'])
        grouped.setdefault(key, []).append((ending, annotation))
    result = []
    for key, members in grouped.items():
        ordered = sorted(members, key=lambda pair: (not pair[0]['reachable'],
                         pair[0]['length'] if pair[0]['length'] is not None else float('inf'), str(pair[0]['id'])))
        best, annotation = ordered[0]
        categories = {a.get('category') for _, a in members if a.get('category')}
        result.append({'key': hashlib.sha256(key.encode()).hexdigest()[:24], 'id': best['id'],
            'name': annotation.get('name') or best['title'], 'category': next(iter(categories)) if len(categories) == 1 else None,
            'category_conflict': len(categories) > 1, 'needs_review': len(categories) > 1 or any(a.get('needs_review') for _, a in members),
            'member_ids': [e['id'] for e, _ in ordered], 'reachable': best['reachable'], 'length': best['length'],
            'reachable_count': sum(e['reachable'] for e, _ in members), 'source': annotation.get('source', 'unknown')})
    return result


def frame_candidate(text):
    text = clean_text(text)
    lines = [s.strip(' \t:：-—「」【】') for s in text.splitlines() if s.strip()]
    cards = []
    for index, line in enumerate(lines):
        category, markers, ambiguous = explicit_category(line)
        # Read the ending heading, not incidental abbreviations in the explanation.
        explicit = re.match(r'^(?:(?:达成|获得|解锁|触发)\s*)?(?:结局|ENDING)\s*(?:[一二三四五六七八九十\d]{1,4})?\s*[:：\-—]\s*(.{2,100})$', line, re.I)
        label = re.fullmatch(r'(?:达成|获得|解锁|触发)?(?:结局|ENDING)(?:[一二三四五六七八九十\d]{1,4})?', line, re.I)
        english = re.match(r'^(?:HAPPY|BAD|NORMAL|TRUE|GOOD|OPEN|SECRET|SPECIAL) END(?:ING)?(?:\s*\d{1,4})?(?:$|[ :：·-])', line, re.I)
        short = re.match(r'^(?:HE|BE|NE|TE|GE|OE|SE)(?:[\s._#-]*\d{1,4})(?:$|[^A-Za-z])', line) or re.fullmatch(r'HE|BE|NE|TE|GE|OE|SE', line)
        chinese = any(line.startswith(phrase) for phrases in PHRASES.values() for phrase in phrases if '结局' in phrase)
        if not (explicit or label or english or short or chinese): continue
        if ambiguous: return None
        if short and not re.search(r'\d', line) and index > 3: continue
        name = explicit.group(1).strip() if explicit else line
        if (label or re.fullmatch(r'(?:HE|BE|NE|TE|GE|OE|SE)\s*\d{0,4}|(?:HAPPY|BAD|NORMAL|TRUE|GOOD|OPEN|SECRET|SPECIAL) END(?:ING)?(?:\s*\d{1,4})?', line, re.I)) and index + 1 < len(lines):
            following = lines[index + 1]
            if 2 <= len(following) <= 35 and not re.search(r'[，。！？,;；]', following) and not explicit_category(following)[1] and (len(re.findall(r'[\u4e00-\u9fff]', following)) >= 2 or re.fullmatch(r'[A-Za-z]+(?:[ \'-][A-Za-z]+){0,4}', following)):
                name = following if label else name + ' · ' + following
        if (label or (short and not re.search(r'\d', line))) and name == line: continue
        if re.match(r'^(?:条件|攻略|说明|列表|尚未|未达成|未解锁)', name): continue
        cards.append({'name': name[:120], 'category': category, 'explicit_name': bool(explicit or label), 'text': text, 'markers': markers})
    # Multiple distinct headings are a collection/list, not a single ending.
    if len({normalized_name(c['name']) for c in cards}) > 1: return None
    return cards[0] if cards else None


def choose_evidence(frames):
    """Require agreement across distinct samples; preserve ambiguity for review."""
    grouped = defaultdict(list)
    for frame in frames:
        candidate = frame_candidate(frame['text'])
        if candidate:
            key = (re.sub(r'\s+', '', candidate['name']).casefold(), candidate['category'])
            grouped[key].append({**frame, 'candidate': candidate})
    qualified = [items for items in grouped.values()
                 if len({f['time'] for f in items}) >= 2 and sum(f.get('confidence', 0) for f in items) / len(items) >= 35]
    if not qualified:
        return {'name': None, 'category': None, 'source': 'ocr', 'status': 'ambiguous' if grouped else 'not_found',
                'needs_review': True, 'text': '\n\n'.join(f['text'] for f in frames[-3:])[:4000],
                'reason': '只在单帧或低清文字中发现疑似结局，未自动采用' if grouped else '片尾未识别到明确结局文字',
                'frames': sorted(frames, key=lambda f: f.get('confidence', 0), reverse=True)[:3]}
    qualified.sort(key=lambda items: (max(f['time'] for f in items), len(items)), reverse=True)
    latest = qualified[0]
    # Competing types in the sampled tail stay unknown rather than guess.
    kinds = {items[0]['candidate']['category'] for items in qualified if items[0]['candidate']['category']}
    if len(kinds) > 1:
        return {'name': None, 'category': None, 'source': 'ocr', 'status': 'ambiguous', 'needs_review': True,
                'text': '\n\n'.join(f['text'] for items in qualified for f in items[:1])[:4000],
                'reason': '片尾画面出现多种结局分类，需核对截图', 'frames': [items[-1] for items in qualified[:3]]}
    best = max(latest, key=lambda f: (f.get('confidence', 0), f['time']))
    c = best['candidate']
    return {'name': c['name'], 'category': c['category'], 'source': 'ocr', 'status': 'recognized',
            'needs_review': True, 'text': c['text'], 'reason': f"{len(latest)} 个采样画面出现一致的结局文字，请核对",
            'frames': sorted(latest, key=lambda f: f['time'], reverse=True)[:3]}
