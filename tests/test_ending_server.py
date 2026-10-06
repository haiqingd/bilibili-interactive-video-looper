import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch
from looper.demo import demo_graph
from looper.engine import analyze
from looper.storage import Store
from looper.bilibili import BilibiliError
from server import create_server

class EndingServerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'test.db';self.store=Store(self.path)
        graph=demo_graph();graph['metadata'].update(bvid='BV1ECFQevEoD',source='bilibili')
        for i,n in enumerate(graph['nodes']):
            if n['leaf']:n['cid']=100+i
        graph['analysis']=analyze(graph);self.key=self.store.save(graph)
        self.server=create_server(port=0,db_path=self.path);threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.base=f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.temp.cleanup()

    def request(self,path,body=None):
        request=urllib.request.Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
        try:response=urllib.request.urlopen(request)
        except urllib.error.HTTPError as e:response=e
        with response:return response.status,json.loads(response.read())

    def wait(self,key):
        for _ in range(100):
            result=self.request('/api/jobs/'+key)[1]
            if result['status']!='running':return result
            time.sleep(.02)
        self.fail('job did not finish')

    def test_manual_edit_and_unknown_category(self):
        code,r=self.request(f'/api/guides/{self.key}/ending-annotation',{'node_id':'good','name':'团圆','category':''})
        self.assertEqual(code,200);self.assertIsNone(r['category']);self.assertEqual(r['source'],'manual')
        self.assertEqual(self.request(f'/api/guides/{self.key}/ending-annotation',{'node_id':'good','name':'团圆','category':'FAKE'})[0],400)
        self.assertEqual(self.request(f'/api/guides/{self.key}/ending-annotation',{'node_id':'root','name':'x'})[0],400)

    def test_batch_and_same_cid_cache(self):
        g=self.store.get(self.key)['graph']
        for n in g['nodes']:
            if n['leaf']:n['cid']=200
        self.store.save(g)
        with patch('server.available',return_value=True),patch('server.recognize',return_value={'name':'BE01','category':'BE','source':'ocr','status':'recognized','needs_review':True,'frames':[]}) as mocked:
            code,r=self.request(f'/api/guides/{self.key}/recognize-endings',{})
            self.assertEqual(code,202);status=self.wait(r['job_id']);self.assertEqual(status['status'],'done');self.assertEqual(mocked.call_count,1)
        annotations=self.store.get(self.key)['graph']['ending_annotations'];self.assertTrue(all(a['category']=='BE' for a in annotations.values()))

    def test_risk_stops_and_preserves_finished_results(self):
        result={'name':'HE01','category':'HE','source':'ocr','status':'recognized','frames':[]}
        with patch('server.available',return_value=True),patch('server.recognize',side_effect=[result,BilibiliError('HTTP 412 风控')]) as mocked:
            r=self.request(f'/api/guides/{self.key}/recognize-endings',{})[1];status=self.wait(r['job_id'])
            self.assertEqual(status['status'],'error');self.assertIn('412',status['error']);self.assertEqual(mocked.call_count,2)
        self.assertEqual(sum(a['category']=='HE' for a in self.store.get(self.key)['graph']['ending_annotations'].values()),1)

    def test_cancel_and_manual_annotation_protection(self):
        entered=threading.Event();release=threading.Event()
        def recognize(*args):
            entered.set();release.wait(2)
            return {'name':'BE01','category':'BE','source':'ocr','status':'recognized','frames':[]}
        with patch('server.available',return_value=True),patch('server.recognize',side_effect=recognize) as mocked:
            r=self.request(f'/api/guides/{self.key}/recognize-endings',{})[1];self.assertTrue(entered.wait(1))
            self.request('/api/jobs/'+r['job_id']+'/cancel',{})
            release.set();self.assertEqual(self.wait(r['job_id'])['status'],'done');self.assertEqual(mocked.call_count,1)
        prior=self.store.get(self.key)['graph']['ending_annotations']['good']
        self.store.set_ending_annotation(self.key,'good',{**prior,'name':'人工名称','category':'HE','source':'manual','status':'recognized'})
        with patch('server.available',return_value=True),patch('server.recognize',return_value={'name':'BE01','category':'BE','source':'ocr','status':'recognized','frames':[]}):
            r=self.request(f'/api/guides/{self.key}/recognize-endings',{'node_id':'good'})[1];self.wait(r['job_id'])
        result=self.store.get(self.key)['graph']['ending_annotations']['good'];self.assertEqual(result['name'],'人工名称');self.assertEqual(result['category'],'HE')

    def test_scoped_evidence_and_invalid_import(self):
        filename='a'*32+'.jpg';folder=Path(self.temp.name)/'ending-evidence';folder.mkdir();(folder/filename).write_bytes(b'jpeg-test')
        self.store.set_ending_annotation(self.key,'good',{'name':'x','category':None,'source':'ocr','status':'recognized','frames':[{'file':filename,'time':1}]})
        with urllib.request.urlopen(f'{self.base}/api/guides/{self.key}/ending-evidence?node=good&frame=0') as r:
            self.assertEqual(r.headers['Content-Type'],'image/jpeg');self.assertEqual(r.read(),b'jpeg-test')
        for query in ('node=good&frame=-1','node=bad&frame=0','node=../../secret&frame=0'):
            self.assertEqual(self.request(f'/api/guides/{self.key}/ending-evidence?'+query)[0],404)
        graph=self.store.get(self.key)['graph'];graph['ending_annotations']={'root':{'category':'HE'}}
        self.assertEqual(self.request('/api/import',{'graph':graph})[0],400)
        self.assertEqual(self.store.get(self.key)['graph']['ending_annotations']['good']['name'],'x')

if __name__=='__main__':unittest.main()
