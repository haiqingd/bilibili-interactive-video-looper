import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from server import create_server


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.server=create_server(port=0,db_path=Path(cls.temp.name)/'test.db')
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.base=f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.temp.cleanup()

    def request(self,path,method='GET',body=None,headers=None):
        defaults={'Content-Type':'application/json'}
        defaults.update(headers or {})
        request=urllib.request.Request(self.base+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers=defaults)
        try: response=urllib.request.urlopen(request)
        except urllib.error.HTTPError as error: response=error
        with response:return response.status,json.loads(response.read())

    def test_demo_export_import_and_library(self):
        code,result=self.request('/api/demo','POST',{})
        self.assertEqual(code,201);key=result['guide_id']
        code,guide=self.request('/api/guides/'+key)
        self.assertEqual(code,200);self.assertTrue(guide['graph']['analysis']['complete'])
        code,imported=self.request('/api/import','POST',{'graph':guide['graph']})
        self.assertEqual(code,201);self.assertEqual(imported['guide_id'],key)
        code,result=self.request('/api/guides/'+key,'PATCH',{'favorite':True,'tags':['测试']})
        self.assertTrue(result['favorite']);self.assertEqual(result['tags'],['测试'])
        code,rows=self.request('/api/guides');self.assertEqual(len(rows),1)
        self.assertEqual(self.request('/api/guides/'+key,'DELETE')[0],200)

    def test_bad_import_is_rejected(self):
        self.assertEqual(self.request('/api/import','POST',{'graph':{}})[0],400)
        self.assertEqual(self.request('/api/import','POST',[])[0],400)

    def test_external_origin_is_rejected(self):
        self.assertEqual(self.request('/api/demo','POST',{}, {'Origin':'https://evil.test'})[0],403)
        self.assertEqual(self.request('/api/guides',headers={'Host':'evil.test'})[0],403)

    def test_invalid_url(self):
        self.assertEqual(self.request('/api/parse','POST',{'url':'http://127.0.0.1/private'})[0],400)


if __name__=='__main__':unittest.main()
