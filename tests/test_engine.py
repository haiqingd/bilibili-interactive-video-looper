import copy
import tempfile
import unittest
from pathlib import Path
from looper.bilibili import collect, video_id, BilibiliError
from looper.demo import demo_graph
from looper.engine import analyze, normalize_edge, components
from looper.expressions import evaluate, execute, ExpressionError
from looper.storage import Store


class ExpressionTests(unittest.TestCase):
    def test_logical_and_numeric(self):
        self.assertTrue(evaluate('$x>=2 && ($y<3 || $y==4)', {'$x':2,'$y':4}))
        self.assertTrue(evaluate('!false && $x!==3', {'$x':2}))
        self.assertEqual(evaluate('-5 % 3', {}), -2)

    def test_sequential_assignments(self):
        self.assertEqual(execute('$x=$x+1;$y=$x*2;$x+=3;', {'$x':0,'$y':0}), {'$x':4,'$y':2})

    def test_javascript_precedence_and_equality(self):
        self.assertFalse(evaluate('1===true', {}))
        self.assertTrue(evaluate('1==true', {}))
        self.assertTrue(evaluate('1===1.0', {}))
        self.assertTrue(evaluate('!2==0', {}))
        self.assertFalse(evaluate('false && $unknown', {}))
        self.assertTrue(evaluate('true || $unknown', {}))
        self.assertEqual(evaluate('1+2*3', {}),7)

    def test_no_code_execution(self):
        for code in ["__import__('os').system('echo oops')", '().__class__', '$x[0]', '2**2000', '$unknown+1']:
            with self.subTest(code=code), self.assertRaises(ExpressionError): evaluate(code, {'$x':1})
        with self.assertRaises(ExpressionError): execute('$x=1/0', {'$x':1})
        with self.assertRaises(ExpressionError): evaluate('('*400+'1'+')'*400,{})


class EngineTests(unittest.TestCase):
    def test_score_cycle_requires_repeat(self):
        result=analyze(demo_graph())
        self.assertTrue(result['complete'])
        endings={e['id']:e for e in result['endings']}
        self.assertEqual([endings[k]['length'] for k in ['good','quiet','bad']], [7,4,3])
        self.assertEqual(endings['good']['final_values'], {'$trust':1,'$clue':2})
        self.assertEqual(sum(s['source']=='archive' for s in endings['good']['steps']), 2)
        self.assertEqual(result['traps'], [['loopA','loopB']])
        self.assertEqual(len(result['cycles']),2)

    def test_unbounded_score_loop_is_partial(self):
        g=demo_graph();g['nodes'][4]['questions'][0]['choices'][0]['condition']=''
        result=analyze(g,max_states=100,max_depth=30)
        self.assertFalse(result['complete']);self.assertTrue(result['truncated'])
        self.assertLessEqual(result['states'],100)
        self.assertFalse(any('archive' in t for t in result['traps']))

    def test_missing_not_an_ending(self):
        g=demo_graph();g['nodes'][5].update(missing=True,leaf=False,questions=[]);g['graph_complete']=False
        result=analyze(g);self.assertFalse(result['complete'])
        self.assertFalse(any(e['reachable'] for e in result['endings']))

    def test_random_and_unknown_are_not_assumed(self):
        g=demo_graph();g['variables'][0]['random']=True
        result=analyze(g);self.assertFalse(result['complete'])
        self.assertFalse(next(e for e in result['endings'] if e['id']=='good')['reachable'])
        g=demo_graph();g['nodes'][0]['questions'][0]['choices'][0]['condition']='Math.random()>0.5'
        self.assertFalse(analyze(g)['complete'])

    def test_multiple_questions_execute_before_jump(self):
        g=demo_graph();g['nodes'][0]['questions'].insert(0,{'type':2,'choices':[
            {'target':None,'text':'取得信任','condition':'','action':'$trust=1'}]})
        result=analyze(g)
        route=next(e for e in result['endings'] if e['id']=='good')
        self.assertEqual(route['steps'][0]['source'], 'start')
        self.assertEqual(route['steps'][0]['target'], 'start')
        self.assertEqual(route['steps'][0]['after']['$trust'], 1)
        self.assertTrue(result['complete'])

    def test_ambiguous_automatic_routing_is_unknown(self):
        g=demo_graph();g['nodes'][0]['questions'][0]['type']=0
        result=analyze(g);self.assertFalse(result['complete'])
        self.assertFalse(any(e['reachable'] for e in result['endings']))

    def test_leaf_root_zero_steps(self):
        g=demo_graph();g['root']='good'
        route=next(e for e in analyze(g)['endings'] if e['id']=='good')
        self.assertTrue(route['reachable']);self.assertEqual(route['length'],0)

    def test_invalid_graph(self):
        for mutate in [lambda g:g.update(root='missing'), lambda g:g['nodes'].append(copy.deepcopy(g['nodes'][0])),lambda g:g['variables'][0].update(value=float('nan'))]:
            g=demo_graph();mutate(g)
            with self.assertRaises(ValueError):analyze(g)

    def test_long_scc_graph(self):
        adjacency={str(i):[str(i+1)] for i in range(4999)};adjacency['4999']=['0']
        self.assertEqual(len(components(adjacency)[0]),5000)


class CollectorTests(unittest.TestCase):
    def test_url_validation(self):
        self.assertEqual(video_id('https://www.bilibili.com/video/BV1ECFQevEoD/?p=2'),{'bvid':'BV1ECFQevEoD'})
        self.assertEqual(video_id('av73267982'),{'aid':73267982})
        for url in ['http://127.0.0.1/video/BV1ECFQevEoD/', 'https://www.bilibili.com.evil.test/video/BV1ECFQevEoD/', 'nope']:
            with self.assertRaises(BilibiliError):video_id(url)

    def test_normalize_all_questions_and_leaf_flag(self):
        data={'edge_id':1,'title':'root','is_leaf':0,'edges':{'questions':[
            {'type':2,'choices':[{'id':2,'cid':44,'platform_action':'JUMP 2 44','option':'A','condition':'$x>0','native_action':'$x+=1'}]},
            {'type':2,'choices':[{'id':3,'cid':55,'option':'B'}]}]}}
        node=normalize_edge(data,11)
        self.assertEqual(node['questions'][0]['choices'][0]['target'],'2')
        self.assertEqual(len(node['questions']),2);self.assertFalse(node['leaf'])

    def test_collect_visits_cycle_once_and_preserves_false_condition(self):
        class Fake:
            calls=[]
            def get(self,path,params):
                self.calls.append((path,params))
                if path.endswith('/view'):return {'bvid':'BV1ECFQevEoD','cid':10,'title':'test','owner':{'name':'UP'}}
                if path.endswith('/v2'):return {'interaction':{'graph_version':1}}
                key=params.get('edge_id','1')
                return {'edge_id':int(key),'title':key,'is_leaf':0,'hidden_vars':[],
                        'edges':{'questions':[{'type':2,'choices':[{'id':2 if key=='1' else 1,'cid':20,'option':'next','condition':'false'}]}]}}
        fake=Fake();g=collect('BV1ECFQevEoD',client=fake)
        self.assertEqual(len(g['nodes']),2);self.assertTrue(g['graph_complete'])
        self.assertEqual(len(fake.calls),4)

    def test_collection_error_keeps_pending_nodes(self):
        class Fake:
            def get(self,path,params):
                if path.endswith('/view'):return {'bvid':'BV1ECFQevEoD','cid':10,'title':'test'}
                if path.endswith('/v2'):return {'interaction':{'graph_version':1}}
                if 'edge_id' in params:raise BilibiliError('blocked')
                return {'edge_id':1,'is_leaf':0,'edges':{'questions':[{'choices':[{'id':2,'cid':22},{'id':3,'cid':33}]}]}}
        g=collect('BV1ECFQevEoD',client=Fake())
        self.assertEqual(len(g['nodes']),3);self.assertFalse(g['graph_complete'])
        self.assertFalse(analyze(g)['complete'])


class StorageTests(unittest.TestCase):
    def test_persistence_upsert_and_user_classification(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'guides.db';store=Store(path)
            g=demo_graph();g['analysis']=analyze(g)
            key=store.save(g);store.update(key,True,['悬疑','评分'])
            self.assertEqual(store.save(g),key)
            reopened=Store(path);self.assertEqual(reopened.get(key)['tags'],['悬疑','评分'])
            self.assertTrue(reopened.get(key)['favorite']);self.assertEqual(len(reopened.list()),1)
            self.assertTrue(reopened.delete(key));self.assertIsNone(reopened.get(key))


if __name__=='__main__':unittest.main()
