"""Automatic naming pass inside a parse job, with persisted evidence and CID reuse."""
from .bilibili import Client, BilibiliError
from .ending_ocr import recognize, available


def identify_endings(store, guide_id, evidence_dir, cookie='', progress=lambda *args: None,
                     cancelled=lambda: False, recognizer=recognize, supported=None, nodes=None, force=False):
    guide = store.get(guide_id); graph = guide['graph']; annotations = graph['ending_annotations']
    leaves = [n for n in graph['nodes'] if n['leaf']]
    pending = nodes if nodes is not None else [n for n in leaves if not annotations[str(n['id'])].get('name')]
    cached = {}; errors = []; processed = 0
    if not force:
        # A video clip always has the same ending card regardless of entry state.
        for node in leaves:
            a = annotations[str(node['id'])]
            if node.get('cid') and a.get('name') and a.get('status') == 'recognized':
                previous = cached.get(node['cid'])
                if not previous or a.get('source') in {'manual', 'ocr'}: cached[node['cid']] = a
    supported = available() if supported is None else supported
    client = Client(cookie)
    try:
        for node in pending:
            if cancelled(): break
            progress('自动识别结局名称 · 标题／片尾关键帧', processed, len(pending))
            cid = node.get('cid')
            if cid not in cached:
                if not supported:
                    errors.append('当前环境缺少片尾识别组件，未识别的结局名称仍待补齐。'); break
                if not cid:
                    result = {'name': None, 'category': None, 'source': 'unknown', 'status': 'not_found',
                              'frames': [], 'needs_review': True, 'reason': '节点没有可读取的视频 CID'}
                else:
                    try:
                        result = recognizer(client, graph['metadata']['bvid'], cid, evidence_dir)
                    except BilibiliError as exc:
                        message = str(exc)
                        result = {'name': None, 'category': None, 'source': 'ocr', 'status': 'error',
                                  'frames': [], 'needs_review': True, 'reason': message}
                        if any(marker in message for marker in ('412', '429', '-352')):
                            errors.append(message); break
                        errors.append(message)
                cached[cid] = result
            result = cached[cid]
            prior = annotations[str(node['id'])]
            if result.get('name') or not prior.get('name'):
                annotations[str(node['id'])] = store.set_ending_annotation(guide_id, node['id'], result, protect_manual=True)
            processed += 1
            progress('自动识别结局名称 · 标题／片尾关键帧', processed, len(pending))
        fresh = store.get(guide_id)['graph']
        named = sum(bool(a.get('name')) for a in fresh['ending_annotations'].values())
        summary = {'status': 'cancelled' if cancelled() else 'complete' if named == len(leaves) else 'partial',
                   'named': named, 'total': len(leaves), 'processed': processed,
                   'groups': len(fresh['ending_groups']), 'warnings': list(dict.fromkeys(errors))[:10]}
        if cancelled(): summary['warnings'].append('用户停止识别，已识别名称和流程已保存。')
        if named < len(leaves): summary['warnings'].append(f'{len(leaves) - named} 个结局节点尚未识别名称，暂时独立展示。')
        store.set_ending_recognition(guide_id, summary)
        return summary
    finally:
        client.cookie = ''; cookie = ''
