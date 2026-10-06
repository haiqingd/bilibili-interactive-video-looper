import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from looper.bilibili import author_videos, sign_wbi, BilibiliError
from looper.demo import demo_graph
from looper.engine import analyze
from looper.storage import Store
import test_server


class AuthorAdapterTests(unittest.TestCase):
    def test_signature(self):
        params={'foo':'114','bar':'514','baz':1919810}
        signed=sign_wbi(params,'7cd084941338484aae1ad9425b84077c','4932caff0ff746eab6f01bf08b70ac45',1702204169)
        self.assertEqual(signed['w_rid'],'6149fdadf571698ca7e6a567265cd0ee')
        self.assertNotIn('wts',params)

    def test_flag_filtering_and_pagination(self):
        class Fake:
            def get_signed(self,path,params):
                self.path,self.params=path,params
                return {'page':{'count':65},'list':{'vlist':[
                    {'bvid':'BV1ECFQevEoD','title':'没有关键词也能识别','is_steins_gate':1,'created':100,'pic':'http://i0.hdslb.com/a.jpg'},
                    {'bvid':'BV1Ap3xz9EwL','title':'互动视频教程','is_steins_gate':0},
                    {'bvid':'BV1UE411y7Wy','title':'未知视频'}]}}
        fake=Fake();result=author_videos('123',2,client=fake)
        self.assertEqual([v['bvid'] for v in result['videos']],['BV1ECFQevEoD'])
        self.assertTrue(result['has_more']);self.assertEqual(result['scanned'],60)
        self.assertEqual(result['unclassified'],1);self.assertEqual(fake.params['keyword'],'')
        self.assertEqual(result['videos'][0]['cover'],'https://i0.hdslb.com/a.jpg')

    def test_risk_not_empty_and_validation(self):
        class Fake:
            def get_signed(self,*args):return {'is_risk':True,'list':{'vlist':[]}}
        with self.assertRaises(BilibiliError):author_videos('123',client=Fake())
        for mid,page in [('http://evil',1),('0',1),('123',False),('123',0)]:
            with self.assertRaises(BilibiliError):author_videos(mid,page,client=Fake())


class AuthorCacheTests(unittest.TestCase):
    def test_merge_known_guides_and_persistent_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'test.db';store=Store(path)
            g=demo_graph();g['metadata'].update(author_id=123,bvid='BV1ECFQevEoD',source='bilibili');g['analysis']=analyze(g)
            key=store.save(g)
            self.assertEqual(store.authors()[0]['id'],'123')
            self.assertEqual(store.author_catalog('123')['videos'][0]['guide_id'],key)
            payload={'page':1,'videos':[{'bvid':'BV1ECFQevEoD','title':'same'},{'bvid':'BV1Ap3xz9EwL','title':'new'}],
                'has_more':True,'scanned':30,'total_submissions':60,'warnings':[]}
            store.save_author_page('123',1,payload)
            catalog=Store(path).author_catalog('123')
            self.assertEqual(len(catalog['videos']),2);self.assertEqual(catalog['next_page'],2)
            self.assertEqual(next(v for v in catalog['videos'] if v['bvid']=='BV1ECFQevEoD')['guide_id'],key)
            self.assertFalse(any('cookie' in str(v).lower() for v in catalog['videos']))
            store.save_author_page('123',3,{**payload,'page':3})
            self.assertEqual(store.author_catalog('123')['next_page'],2)


class AuthorHTTPTests(test_server.ServerTests):
    # Inherit the server fixture and request helper, but not its test cases.
    def test_catalog_and_parse_entry(self):
        from looper.storage import Store
        store=Store(Path(self.temp.name)/'test.db')
        g=demo_graph();g['metadata'].update(author_id=123,bvid='BV1ECFQevEoD',source='bilibili');g['analysis']=analyze(g)
        store.save(g)
        self.assertEqual(self.request('/api/authors')[1][0]['id'],'123')
        result={'author_id':'123','page':1,'videos':[{'bvid':'BV1Ap3xz9EwL','title':'互动作品','published_at':100}],
            'has_more':False,'scanned':2,'total_submissions':2,'warnings':[]}
        with patch('server.author_videos',return_value=result) as fetch:
            code,catalog=self.request('/api/authors/123/videos','POST',{'page':1,'cookie':'SESSDATA=test'})
            self.assertEqual(code,200);self.assertEqual(len(catalog['videos']),2)
            fetch.assert_called_once_with('123',1,'SESSDATA=test')
        self.assertEqual(self.request('/api/authors/123/videos')[0],200)
        with patch('server.author_videos',side_effect=BilibiliError('HTTP 412')):
            self.assertEqual(self.request('/api/authors/123/videos','POST',{'page':1,'refresh':True})[0],502)
        self.assertEqual(len(self.request('/api/authors/123/videos')[1]['videos']),2)
        self.assertEqual(self.request('/api/authors/999/videos')[0],404)

    test_demo_export_import_and_library=None
    test_bad_import_is_rejected=None
    test_external_origin_is_rejected=None
    test_invalid_url=None


if __name__=='__main__':unittest.main()
