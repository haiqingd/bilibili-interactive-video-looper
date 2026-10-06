import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from looper.demo import demo_graph
from looper.engine import analyze
from looper.endings import group_endings, title_annotation, frame_candidate
from looper.ending_pipeline import identify_endings
from looper.bilibili import BilibiliError, collect
from looper.storage import Store
import test_ending_server as fixtures

class GroupTests(unittest.TestCase):
    def test_same_name_uses_shortest_reachable_and_preserves_nodes(self):
        graph={'nodes':[], 'analysis':{'endings':[
            {'id':'a','title':'video','reachable':True,'length':12},
            {'id':'b','title':'video','reachable':True,'length':3},
            {'id':'c','title':'video','reachable':False,'length':None}]},
            'ending_annotations':{i:{'name':n,'status':'recognized','category':k} for i,n,k in
            [('a','HE01 · 重逢','HE'),('b','ＨＥ０１ 重逢','HE'),('c','HE01重逢','HE')]}}
        groups=group_endings(graph);self.assertEqual(len(groups),1);self.assertEqual(groups[0]['id'],'b')
        self.assertEqual(groups[0]['length'],3);self.assertEqual(groups[0]['reachable_count'],2)
        self.assertEqual(groups[0]['member_ids'],['b','a','c']);self.assertEqual(len(graph['analysis']['endings']),3)
        graph['ending_annotations']['a']['category']='BE'
        result=group_endings(graph)[0];self.assertIsNone(result['category']);self.assertTrue(result['category_conflict'])

    def test_generic_titles_never_merge_unknown_endings(self):
        graph={'analysis':{'endings':[{'id':i,'title':'same video title','reachable':True,'length':1} for i in ['a','b']]}}
        self.assertEqual(len(group_endings(graph)),2)
        graph['ending_annotations']={i:title_annotation('结局：重逢') for i in ['a','b']}
        self.assertEqual(len(group_endings(graph)),1)
        self.assertIsNone(graph['ending_annotations']['a']['category'])

    def test_ocr_heading_ignores_body_noise_and_accepts_special_end(self):
        self.assertEqual(frame_candidate('BAD END 02\n神之一手\nGE BREE BOE garbage')['category'],'BE')
        self.assertEqual(frame_candidate('SPECIAL END 01\n失败的上帝')['name'],'SPECIAL END 01 · 失败的上帝')
        self.assertIsNone(frame_candidate('SPECIAL END 01\n失败的上帝')['category'])
        self.assertIsNone(frame_candidate('HE01\nBE02'))
        self.assertIsNone(frame_candidate('scene\ncaption\nspeaker\nscore\nNE'))
        self.assertEqual(frame_candidate('SPECIAL END 01\nFOC _E ti')['name'],'SPECIAL END 01')

    def test_title_names_collected_with_nodes(self):
        class Fake:
            def get(self,path,params):
                if path.endswith('/view'):return {'bvid':'BV1ECFQevEoD','cid':10,'title':'test'}
                if path.endswith('/v2'):return {'interaction':{'graph_version':1}}
                return {'edge_id':1,'title':'结局：重逢','is_leaf':1,'edges':{'questions':[]}}
        g=collect('BV1ECFQevEoD',client=Fake())
        self.assertEqual(g['ending_annotations']['1']['name'],'重逢')

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'test.db')
        self.graph=demo_graph();self.graph['metadata'].update(bvid='BV1ECFQevEoD',source='bilibili')
        for n in self.graph['nodes']:
            if n['leaf']:n['cid']=100
        self.graph['analysis']=analyze(self.graph);self.key=self.store.save(self.graph)
    def tearDown(self):self.temp.cleanup()
    def run_pipeline(self,**kwargs):return identify_endings(self.store,self.key,Path(self.temp.name)/'evidence',supported=True,**kwargs)
    def test_unique_cid_read_once_and_grouped_routes_persist(self):
        mock=Mock(return_value={'name':'BE01 同一个结局','category':'BE','status':'recognized','source':'ocr','frames':[]})
        result=self.run_pipeline(recognizer=mock);self.assertEqual(mock.call_count,1);self.assertEqual(result['named'],3);self.assertEqual(result['groups'],1)
        saved=Store(self.store.path).get(self.key)['graph'];self.assertEqual(len(saved['analysis']['endings']),3);self.assertEqual(len(saved['ending_groups']),1)
        self.assertEqual(saved['ending_recognition']['status'],'complete')
        mock.reset_mock();self.run_pipeline(recognizer=mock);mock.assert_not_called()
    def test_cached_named_cid_is_reused_without_media_components(self):
        self.store.set_ending_annotation(self.key,'good',{'name':'团圆','category':'HE','status':'recognized','source':'manual','frames':[]})
        mock=Mock();result=identify_endings(self.store,self.key,Path(self.temp.name),supported=False,recognizer=mock)
        mock.assert_not_called();self.assertEqual(result['named'],3)
    def test_non_risk_failures_continue_and_graph_is_saved(self):
        for i,n in enumerate(self.graph['nodes']):
            if n['leaf']:n['cid']=100+i
        self.store.save(self.graph)
        mock=Mock(side_effect=[BilibiliError('播放不可访问'),{'name':'结局名称','category':None,'status':'recognized','source':'ocr','frames':[]},BilibiliError('HTTP 412 风控')])
        result=self.run_pipeline(recognizer=mock);self.assertEqual(mock.call_count,3);self.assertEqual(result['named'],1);self.assertEqual(result['status'],'partial')
        self.assertTrue(self.store.get(self.key)['graph']['analysis']['complete'])

class AutomaticParseTests(unittest.TestCase):
    setUp = fixtures.EndingServerTests.setUp
    tearDown = fixtures.EndingServerTests.tearDown
    request = fixtures.EndingServerTests.request
    wait = fixtures.EndingServerTests.wait
    # Isolated HTTP fixture; exercise automatic naming before job completion.
    def test_parse_completes_only_after_names_and_groups_are_saved(self):
        graph=self.store.get(self.key)['graph'];graph.pop('ending_annotations');graph.pop('ending_groups')
        for n in graph['nodes']:
            if n['leaf']:n['cid']=300
        named={'name':'同一个结局','category':None,'source':'ocr','status':'recognized','frames':[]}
        with patch('server.collect',return_value=graph),patch('server.available',return_value=True),patch('server.recognize',return_value=named) as ocr:
            code,r=self.request('/api/parse',{'url':'BV1ECFQevEoD'})
            self.assertEqual(code,202);status=self.wait(r['job_id']);self.assertEqual(status['status'],'done');self.assertEqual(ocr.call_count,1)
            saved=self.store.get(status['guide_id'])['graph'];self.assertEqual(len(saved['ending_groups']),1);self.assertEqual(saved['ending_recognition']['named'],3)
            self.assertEqual(status['ending_recognition']['status'],'complete')
    def test_ocr_risk_does_not_lose_parsed_graph(self):
        graph=self.store.get(self.key)['graph']
        with patch('server.collect',return_value=graph),patch('server.available',return_value=True),patch('server.recognize',side_effect=BilibiliError('HTTP 412 风控')) as ocr:
            r=self.request('/api/parse',{'url':'BV1ECFQevEoD'})[1];status=self.wait(r['job_id'])
            self.assertEqual(status['status'],'done');self.assertEqual(ocr.call_count,1)
            saved=self.store.get(status['guide_id'])['graph'];self.assertTrue(saved['analysis']['complete']);self.assertEqual(saved['ending_recognition']['status'],'partial')

if __name__=='__main__':unittest.main()
