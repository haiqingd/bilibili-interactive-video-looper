"""Semantic equivalence and concrete witness replay for projected states."""
import copy
import random
import unittest
from looper.engine import analyze
from looper.expressions import evaluate, execute


def choice(target, action='', condition='', text='continue'):
    return {'target': target, 'action': action, 'condition': condition, 'text': text}


def node(key, choices=None, leaf=False, questions=None):
    return {'id': key, 'title': key, 'leaf': leaf, 'questions': questions if questions is not None else
            ([{'type': 2, 'choices': choices}] if choices else [])}


def graph(nodes, variables):
    return {'metadata': {}, 'root': nodes[0]['id'], 'nodes': nodes,
            'variables': [{'id': k, 'name': k, 'value': v} for k, v in variables.items()]}


def replay(test, g, ending):
    values = {v['id']: v['value'] for v in g['variables'] if not v.get('random')}
    nodes = {n['id']: n for n in g['nodes']}; current = g['root']; qi = 0
    for step in ending['steps']:
        test.assertEqual(step['source'], current); test.assertEqual(step['before'], values)
        q = nodes[current]['questions'][qi]
        selected = next(c for c in q['choices'] if c['key'] == step['key'])
        test.assertTrue(evaluate(selected['condition'], values))
        if q['type'] == 0:
            test.assertEqual(sum(bool(evaluate(c['condition'], values)) for c in q['choices']), 1)
        values = execute(selected['action'], values)
        test.assertEqual(step['after'], values)
        current, qi = (selected['target'], 0) if selected['target'] else (current, qi + 1)
        test.assertEqual(step['target'], current)
    test.assertEqual(current, ending['id']); test.assertTrue(nodes[current]['leaf'])
    test.assertEqual(values, ending['final_values'])


class StateReductionTests(unittest.TestCase):
    def test_independent_history_flags_do_not_explode(self):
        count = 16
        g = graph([node(str(i), [choice(str(i + 1), f'$f{i}=0'), choice(str(i + 1), f'$f{i}=1')])
                   for i in range(count)] + [node(str(count), leaf=True)], {f'$f{i}': 0 for i in range(count)})
        full = analyze(copy.deepcopy(g), max_states=1000, reduce_states=False)
        reduced = analyze(g, max_states=1000)
        self.assertTrue(full['truncated']); self.assertTrue(reduced['complete'])
        self.assertEqual(reduced['states'], 17)
        self.assertEqual(reduced['endings'][0]['length'], 16)
        self.assertEqual(len(reduced['endings'][0]['final_values']), count)
        replay(self, g, reduced['endings'][0])

    def test_constant_reset_kills_old_value_but_preserves_witness(self):
        g = graph([node('start', [choice('reset', '$x=0'), choice('reset', '$x=5')]),
                   node('reset', [choice('check', '$x=1')]),
                   node('check', [choice('yes', condition='$x===1'), choice('no', condition='$x!==1')]),
                   node('yes', leaf=True), node('no', leaf=True)], {'$x': 0})
        reduced = analyze(g); full = analyze(copy.deepcopy(g), reduce_states=False)
        self.assertLess(reduced['states'], full['states']); self.assertTrue(reduced['complete'])
        self.assertEqual([e['reachable'] for e in reduced['endings']], [True, False])
        replay(self, g, reduced['endings'][0])

    def test_sequential_reads_and_runtime_errors_are_kept(self):
        g = graph([node('start', [choice('calc', '$x=0'), choice('calc', '$x=1')]),
                   node('calc', [choice('end', '$unused=1/$x')]), node('end', leaf=True)], {'$x': 0, '$unused': 0})
        result = analyze(g); self.assertFalse(result['complete'])
        self.assertTrue(any('运算失败' in w for w in result['warnings']))
        replay(self, g, result['endings'][0])
        g['nodes'][1]['questions'][0]['choices'][0]['action'] = '$x=1;$unused=1/$x'
        self.assertTrue(analyze(g)['complete'])

    def test_compound_update_propagates_dependencies(self):
        g = graph([node('start', [choice('next', '$x=0'), choice('next', '$x=1')]),
                   node('next', [choice('check', '$x+=$y;$y=$x')]),
                   node('check', [choice('yes', condition='$y===2'), choice('no', condition='$y!==2')]),
                   node('yes', leaf=True), node('no', leaf=True)], {'$x': 0, '$y': 1})
        result = analyze(g); self.assertTrue(result['complete'])
        self.assertTrue(all(e['reachable'] for e in result['endings']))
        for e in result['endings']: replay(self, g, e)

    def test_bool_and_number_do_not_merge(self):
        g = graph([node('start', [choice('check', '$x=true'), choice('check', '$x=1')]),
                   node('check', [choice('bool', condition='$x===true'), choice('number', condition='$x===1')]),
                   node('bool', leaf=True), node('number', leaf=True)], {'$x': 0})
        result = analyze(g); self.assertTrue(all(e['reachable'] for e in result['endings']))
        self.assertIsInstance(result['endings'][0]['final_values']['$x'], bool)
        self.assertNotIsInstance(result['endings'][1]['final_values']['$x'], bool)

    def test_unread_random_value_does_not_block_completeness(self):
        g = graph([node('start', [choice('end')]), node('end', leaf=True)], {})
        g['variables'] = [{'id': '$random', 'name': '随机数', 'random': True, 'value': 42}]
        self.assertTrue(analyze(g)['complete'])
        g['nodes'][0]['questions'][0]['choices'][0]['condition'] = '$random>0'
        self.assertFalse(analyze(g)['complete'])

    def test_differential_against_full_state_search(self):
        rng = random.Random(314159)
        for case in range(80):
            nodes = []
            for i in range(8):
                if i >= 6: nodes.append(node(str(i), leaf=True)); continue
                picks = []
                for _ in range(3):
                    var = rng.choice(['$x', '$y', '$z']); target = str(rng.randrange(i + 1, 8))
                    action = rng.choice([f'{var}={rng.randrange(-2, 3)}', f'{var}+={rng.randrange(-1, 2)}', '$y=$x;$x=0', ''])
                    condition = rng.choice(['', '$x>0', '$y<=1', '$z==0', '$x>0 || $y<0'])
                    picks.append(choice(target, action, condition))
                qs = [{'type': 2, 'choices': picks}]
                if i % 3 == 0: qs.insert(0, {'type': 2, 'choices': [choice(None, '$z=$x'), choice(None, '$z=0')]})
                nodes.append(node(str(i), questions=qs))
            g = graph(nodes, {'$x': 0, '$y': 0, '$z': 0})
            full = analyze(copy.deepcopy(g), reduce_states=False); reduced = analyze(g)
            with self.subTest(case=case):
                self.assertEqual(full['complete'], reduced['complete'])
                self.assertEqual(full['reachable_nodes'], reduced['reachable_nodes'])
                self.assertEqual([(e['id'], e['reachable'], e['length']) for e in full['endings']],
                                 [(e['id'], e['reachable'], e['length']) for e in reduced['endings']])
                self.assertLessEqual(reduced['states'], full['states'])
                for e in reduced['endings']:
                    if e['reachable']: replay(self, g, e)
