import json
import tempfile
import unittest
from pathlib import Path
from looper.endings import explicit_category, title_annotation, frame_candidate, choose_evidence
from looper.ending_ocr import media_url
from looper.bilibili import BilibiliError
from looper.demo import demo_graph
from looper.engine import analyze
from looper.storage import Store

class EndingTests(unittest.TestCase):
    def test_explicit_titles(self):
        for title, kind in [('HE02', 'HE'), ('BE015刺客', 'BE'), ('幸福结局：回家', 'HE'), ('True Ending', 'TE'), ('Bad Ending 03', 'BE'), ('【ＨＥ】团圆', 'HE')]:
            self.assertEqual(title_annotation(title)['category'], kind)
        for title in ('BECAUSE', 'SHE', '第六天：你失败了', '胜利', '评分100', 'to be continued', 'TO BE CONTINUED', '不是BE', '未达成HE'):
            self.assertIsNone(title_annotation(title)['category'])
        self.assertEqual(title_annotation('HE/BE合集')['status'], 'ambiguous')

    def test_explicit_card_names(self):
        self.assertEqual(frame_candidate('结 局 ：\n重 逢')['name'], '重逢')
        self.assertEqual(frame_candidate('结局：重逢')['name'], '重逢')
        self.assertEqual(frame_candidate('BE03\n孤独的夜晚')['category'], 'BE')
        self.assertEqual(frame_candidate('BAD END 01\n全部醉酒')['name'], 'BAD END 01 · 全部醉酒')
        self.assertIsNone(frame_candidate('你输了\n评分20'))
        self.assertIsNone(frame_candidate('未达成HE\n条件：分数100'))

    def test_frame_agreement_and_unknown_category(self):
        frames=[{'time':t,'text':'结局：重逢','confidence':80} for t in [10,12]]
        result=choose_evidence(frames)
        self.assertEqual(result['name'],'重逢');self.assertIsNone(result['category']);self.assertTrue(result['needs_review'])
        self.assertEqual(choose_evidence(frames[:1])['status'],'ambiguous')
        self.assertEqual(choose_evidence([{**f,'confidence':10} for f in frames])['status'],'ambiguous')
        self.assertIsNone(choose_evidence([{'time':t,'text':s,'confidence':90} for t,s in [(1,'HE01'),(2,'HE01'),(3,'BE02'),(4,'BE02')]])['category'])

    def test_media_hosts(self):
        self.assertEqual(media_url('https://upos.bilivideo.com/a'), 'https://upos.bilivideo.com/a')
        for url in ('https://127.0.0.1/a','file:///etc/passwd','https://evilbilivideo.com/a','https://a.bilivideo.com:123/a','https://a.bilivideo.com@evil.test/a'):
            with self.assertRaises(BilibiliError): media_url(url)

    def test_annotations_persist_independently_and_import_drops_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            store=Store(Path(folder)/'test.db');graph=demo_graph();graph['analysis']=analyze(graph)
            key=store.save(graph);store.update(key,True,['保留'])
            store.set_ending_annotation(key,'good',{'name':'团圆','category':'HE','source':'manual','status':'recognized','frames':[]})
            store.save(graph)
            result=store.get(key);self.assertEqual(result['graph']['ending_annotations']['good']['name'],'团圆')
            self.assertTrue(result['favorite']);self.assertEqual(result['tags'],['保留'])
            exported=result['graph'];exported['metadata']['bvid']='another';exported['ending_annotations']['good']['frames']=[{'file':'../../secret','time':1}]
            imported=store.get(store.save(exported))['graph']['ending_annotations']['good']
            self.assertEqual(imported['name'],'团圆');self.assertEqual(imported['frames'],[]);self.assertTrue(imported['needs_review'])
            with self.assertRaises(ValueError):store.set_ending_annotation(key,'root',{'category':'HE'})
            store.delete(key)
            with store.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM ending_annotations WHERE guide_id=?',(key,)).fetchone()[0],0)

if __name__=='__main__':unittest.main()
