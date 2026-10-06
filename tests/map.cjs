const assert=require('node:assert/strict');
const S=require('../static/map.js');
function node(id,targets=[],leaf=false,title=id){return {id,title,leaf,questions:targets.length?[{choices:targets.map((target,i)=>({target,key:id+':'+i,text:'choice '+i,condition:'',action:''}))}]:[]};}
function graph(nodes,cycles=[]){return {root:nodes[0].id,nodes,analysis:{cycles,traps:[]}};}
function lossless(model,view){
  for(const n of model.graph.nodes)assert.ok(view.membership.has(n.id),'missing member '+n.id);
  for(const e of model.edges){const a=view.membership.get(e.source),b=view.membership.get(e.target);if(a!==b)assert.ok(view.edges.some(v=>v.source===a&&v.target===b&&v.choices.some(c=>c.key===e.key)),'missing choice '+e.key);}
}
const loop=graph([node('r',['a']),node('a',['b','end']),node('b',['a']),node('end',[],true)],[['a','b']]);
const model=S.create(loop),collapsed=S.build(model,{mode:'compact'});
assert.equal(collapsed.nodes.length,3);assert.equal(collapsed.nodes.find(n=>n.kind==='cycle').members.length,2);lossless(model,collapsed);
const unfolded=S.build(model,{mode:'full',cycles:false,chains:false});assert.equal(unfolded.nodes.length,4);lossless(model,unfolded);
const chain=graph(Array.from({length:30},(_,i)=>node('n'+i,i<29?['n'+(i+1)]:[],i===29)));
const chainModel=S.create(chain),short=S.build(chainModel,{mode:'compact'});assert.equal(short.nodes.length,3);assert.equal(short.nodes.find(n=>n.kind==='chain').members.length,28);lossless(chainModel,short);
const route={steps:[{source:'r',target:'a',key:'r:0',choice:'a'},{source:'a',target:'b',key:'a:0',choice:'b'},{source:'b',target:'a',key:'b:0',choice:'a'},{source:'a',target:'end',key:'a:1',choice:'end'}]};
const routeView=S.build(model,{route});assert.equal(routeView.nodes.length,5);assert.equal(routeView.nodes.filter(n=>n.original==='a').length,2);assert.equal(new Set(routeView.nodes.map(n=>n.id)).size,5);
const positions=S.layout(routeView).positions;for(const e of routeView.edges)assert.ok(positions.get(e.target).y>positions.get(e.source).y);
const chapterGraph=graph(Array.from({length:60},(_,i)=>node('n'+i,i<59?['n'+(i+1)]:[],i===59,`${Math.floor(i/10)}-第${Math.floor(i/10)}天-${i}`)));
const chapterModel=S.create(chapterGraph),overview=S.build(chapterModel,{mode:'overview'});assert.ok(overview.nodes.length<10);lossless(chapterModel,overview);
const local=S.build(chapterModel,{focus:[...chapterModel.chapters.values()][2],center:'n25'});assert.ok(local.nodes.length<15);assert.ok(local.nodes.some(n=>n.kind==='portal'));
const chaptersBefore=JSON.stringify(chapterModel.graph);S.layout(local);assert.equal(JSON.stringify(chapterModel.graph),chaptersBefore);
const large=graph(Array.from({length:1500},(_,i)=>node('l'+i,i<1499?['l'+(i+1)]:[],i===1499)));
assert.equal(S.build(S.create(large),{mode:'compact'}).nodes.length,3);
const duplicateGraph=graph([
  node('root',['p0','p1','p2','p3']),
  ...Array.from({length:4},(_,i)=>node('p'+i,['copy'+i])),
  ...Array.from({length:4},(_,i)=>node('copy'+i,['yes','no'],false,'Same scene')),
  node('yes',[],true),node('no',[],true)
]);
const untouched=JSON.stringify(duplicateGraph),duplicatesModel=S.create(duplicateGraph);
const merged=S.build(duplicatesModel,{mode:'compact',chains:false,cycles:false});
const copy=merged.nodes.find(n=>n.kind==='duplicates');
assert.deepEqual(copy.members,['copy0','copy1','copy2','copy3']);
assert.equal(merged.edges.filter(e=>e.target===copy.id).length,4);
assert.equal(merged.edges.filter(e=>e.source===copy.id).length,2);
for(const edge of merged.edges.filter(e=>e.source===copy.id)){
  assert.equal(edge.choices.length,4);assert.equal(S.displayChoices(edge.choices).length,1);
}
lossless(duplicatesModel,merged);
assert.equal(JSON.stringify(duplicateGraph),untouched);
assert.equal(S.build(duplicatesModel,{mode:'compact',duplicates:false,chains:false,cycles:false}).nodes.length,duplicateGraph.nodes.length);
assert.equal(S.build(duplicatesModel,{mode:'full',chains:false,cycles:false}).nodes.length,duplicateGraph.nodes.length);
const localCopies=S.build(duplicatesModel,{mode:'compact',focus:{members:['copy1','copy2']},chains:false,cycles:false});
assert.deepEqual(localCopies.nodes.find(n=>n.kind==='duplicates').members,['copy1','copy2']);
const duplicateRoute={steps:[{source:'root',target:'copy0',key:'r:0'},{source:'copy0',target:'copy1',key:'c:0'}]};
const duplicateRouteView=S.build(duplicatesModel,{route:duplicateRoute});
assert.equal(duplicateRouteView.nodes.length,3);assert.equal(duplicateRouteView.nodes.filter(n=>n.title==='Same scene').length,2);
// Every behavior difference blocks merging, including question/choice order.
const mutations=[
  n=>n.title+=' ',n=>n.questions[0].title='Different question',n=>n.questions[0].type=0,
  n=>n.questions[0].choices[0].text='Different choice',n=>n.questions[0].choices[0].target='no',
  n=>n.questions[0].choices[0].condition='score > 1',n=>n.questions[0].choices[0].action='score += 1',
  n=>n.questions[0].choices[0].hidden=true,n=>n.questions[0].choices[0].default=true,
  n=>n.questions[0].choices.reverse(),n=>n.missing=true,n=>n.leaf=true,
  n=>n.questions.push({title:'extra',type:1,choices:[]})
];
for(const mutate of mutations){
  const different=JSON.parse(untouched);mutate(different.nodes.find(n=>n.id==='copy3'));
  const view=S.build(S.create(different),{mode:'compact',chains:false,cycles:false});
  assert.deepEqual(view.nodes.find(n=>n.kind==='duplicates').members,['copy0','copy1','copy2']);
  assert.notEqual(view.membership.get('copy3'),view.membership.get('copy0'));
}
const ordered=JSON.parse(untouched);
for(const n of ordered.nodes.filter(n=>n.id.startsWith('copy')))n.questions.push({title:'second question',type:1,choices:[]});
ordered.nodes.find(n=>n.id==='copy3').questions.reverse();
assert.deepEqual(S.create(ordered).duplicates[0].members,['copy0','copy1','copy2']);
const metadata=JSON.parse(untouched);metadata.nodes.find(n=>n.id==='copy3').cid=42;
assert.equal(S.create(metadata).duplicates[0].members.length,4);
const selfCopies=graph([node('r',['a','b']),node('a',['a','end'],false,'same'),node('b',['a','end'],false,'same'),node('end',[],true)]);
const selfModel=S.create(selfCopies),selfView=S.build(selfModel,{mode:'compact',chains:false,cycles:false}),selfGroup=selfView.nodes.find(n=>n.kind==='duplicates');
assert.ok(selfView.edges.some(e=>e.source===selfGroup.id&&e.target===selfGroup.id&&e.choices.length===2));
lossless(selfModel,selfView);
console.log('Identical scenes merge losslessly; behavior differences, full view, local groups and route occurrences stay distinct: passed');
console.log('Lossless reduction, cycles, long chains, repeated route steps, chapters, portals and 1500-node graph: passed');
