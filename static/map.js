/* Display-only graph reduction. Original nodes, conditions and route steps stay intact. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.StoryMap=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const edgesOf=g=>g.nodes.flatMap(n=>n.questions.flatMap((q,questionIndex)=>q.choices.flatMap((c,choiceIndex)=>c.target?[{...c,source:n.id,automatic:q.type===0||!!c.hidden,questionIndex,choiceIndex}]:[])));
  // IDs and media CIDs identify copies; ordered questions and choices define behavior.
  const choiceSignature=c=>[c.text??'',c.target??null,c.condition??'',c.action??'',!!c.hidden,!!c.default];
  const sceneSignature=n=>JSON.stringify([n.title,n.questions.map(q=>[q.title??'',q.type??null,q.choices.map(choiceSignature)])]);
  function displayChoices(choices){
    const unique=new Map();
    for(const c of choices){
      const key=JSON.stringify([choiceSignature(c),!!c.automatic,c.questionIndex,c.choiceIndex]);
      if(!unique.has(key))unique.set(key,c);
    }
    return [...unique.values()];
  }
  function endingForks(graph){
    const nodes=new Map(graph.nodes.map(n=>[n.id,n])),identity=new Map();
    for(const group of graph.ending_groups||[])for(const id of group.member_ids)identity.set(id,group.key||group.id);
    const resolved=new Map();
    // Follow only unconditional automatic transitions: another decision, unknown
    // scene, state-dependent jump or loop cannot be called a direct ending.
    function destination(id){
      const visited=new Set(),path=[];let cursor=id,result=null;
      while(cursor&&!visited.has(cursor)){
        if(resolved.has(cursor)){result=resolved.get(cursor);break;}
        visited.add(cursor);const n=nodes.get(cursor);
        if(!n||n.missing)break;
        if(n.leaf){result={endingId:cursor,hops:0};break;}
        if(n.questions.length!==1)break;
        const q=n.questions[0];if(q.choices.length!==1)break;
        const c=q.choices[0];
        if(!(q.type===0||c.hidden)||!c.target||String(c.condition||'').trim()||String(c.action||'').trim())break;
        path.push(cursor);cursor=c.target;
      }
      for(const member of path.reverse()){
        if(result)result={...result,hops:result.hops+1};
        resolved.set(member,result);
      }
      if(!resolved.has(id))resolved.set(id,result);
      return resolved.get(id);
    }
    const forks=new Map(),choices=new Map();
    for(const n of graph.nodes){
      if(n.leaf||n.missing)continue;
      const options=[];
      n.questions.forEach((q,questionIndex)=>{
        const candidates=q.choices.flatMap((c,choiceIndex)=>{
          const target=c.target&&destination(c.target);
          return target?[{...c,...target,questionIndex,choiceIndex,automatic:q.type===0||!!c.hidden,
            endingKey:identity.get(target.endingId)||target.endingId}]:[];
        });
        if(new Set(candidates.map(c=>c.endingKey)).size>1)options.push(...candidates);
      });
      if(!options.length)continue;
      const fork={node:n.id,options,endingCount:new Set(options.map(c=>c.endingKey)).size};
      forks.set(n.id,fork);options.forEach(c=>choices.set(c.key,c));
    }
    return {forks,choices};
  }
  function scc(ids,edges){
    const next=new Map(ids.map(id=>[id,[]])),prev=new Map(ids.map(id=>[id,[]]));
    for(const e of edges)if(next.has(e.source)&&next.has(e.target)){next.get(e.source).push(e.target);prev.get(e.target).push(e.source);}
    const seen=new Set(),order=[];
    for(const root of ids){if(seen.has(root))continue;seen.add(root);const stack=[[root,0]];
      while(stack.length){const top=stack[stack.length-1],children=next.get(top[0]);if(top[1]>=children.length){order.push(top[0]);stack.pop();continue;}const child=children[top[1]++];if(!seen.has(child)){seen.add(child);stack.push([child,0]);}}}
    seen.clear();const groups=[];
    for(const root of order.reverse()){if(seen.has(root))continue;const group=[],stack=[root];seen.add(root);while(stack.length){const id=stack.pop();group.push(id);for(const child of prev.get(id))if(!seen.has(child)){seen.add(child);stack.push(child);}}groups.push(group);}
    return groups;
  }
  function create(graph){
    const nodes=new Map(graph.nodes.map(n=>[n.id,n])),edges=edgesOf(graph),cycleOf=new Map();
    graph.analysis.cycles.forEach((members,index)=>members.forEach(id=>cycleOf.set(id,index)));
    const depth=new Map([[graph.root,0]]),queue=[graph.root],out=new Map(graph.nodes.map(n=>[n.id,[]]));
    edges.forEach(e=>out.get(e.source)?.push(e.target));for(let i=0;i<queue.length;i++)for(const child of out.get(queue[i])||[])if(!depth.has(child)){depth.set(child,depth.get(queue[i])+1);queue.push(child);}
    const maxDepth=Math.max(1,...depth.values()),size=Math.max(1,Math.ceil((maxDepth+1)/9)),chapters=new Map(),chapterOf=new Map();
    const coded=graph.nodes.filter(n=>!n.leaf&&/^([0-9]+[A-Z]?)\s*[-－·]/i.test(n.title));
    const named=coded.length>graph.nodes.length*.6;
    for(const n of graph.nodes){if(n.leaf||n.id===graph.root){chapterOf.set(n.id,n.id);continue;}
      const code=named?n.title.match(/^([0-9]+[A-Z]?)\s*[-－·]/i)?.[1]:null;
      const key=code?`chapter:${code}`:`stage:${Math.floor((depth.get(n.id)||0)/size)}`;
      if(!chapters.has(key))chapters.set(key,{id:key,kind:'chapter',members:[],code,title:code?`章节 ${code}`:`阶段 ${Math.floor((depth.get(n.id)||0)/size)+1}`});
      chapters.get(key).members.push(n.id);chapterOf.set(n.id,key);
    }
    for(const group of chapters.values()){
      if(group.code==='0')group.title='序章 · 规则与角色';
      else if(group.code){const day=group.members.map(id=>nodes.get(id).title.match(/第[一二三四五六七八九十百0-9]+天/)?.[0]).find(Boolean);if(day)group.title=day+(/[A-Z]$/i.test(group.code)?' · 分线 '+group.code.slice(-1):'');}
      group.cycles=new Set(group.members.map(id=>cycleOf.get(id)).filter(i=>i!==undefined)).size;
    }
    const copies=new Map();
    for(const n of graph.nodes){
      if(n.leaf||n.missing)continue;
      const signature=sceneSignature(n);
      if(!copies.has(signature))copies.set(signature,[]);
      copies.get(signature).push(n.id);
    }
    const duplicates=[...copies.values()].filter(members=>members.length>1).map(members=>({
      id:'duplicate:'+members.slice().sort()[0],kind:'duplicates',title:nodes.get(members[0]).title,members
    }));
    const endings=endingForks(graph);
    return {graph,nodes,edges,cycleOf,depth,chapters,chapterOf,duplicates,endingForks:endings.forks,endingChoices:endings.choices};
  }
  function aggregate(groups,edges,root){
    const membership=new Map(),byId=new Map(groups.map(g=>[g.id,g]));groups.forEach(g=>g.members.forEach(id=>membership.set(id,g.id)));
    const reduced=new Map();
    for(const e of edges){const source=membership.get(e.source),target=membership.get(e.target);if(!source||!target||(source===target&&byId.get(source).kind!=='duplicates'))continue;
      const key=JSON.stringify([source,target]);if(!reduced.has(key))reduced.set(key,{id:key,source,target,choices:[]});reduced.get(key).choices.push(e);}
    return {nodes:groups,edges:[...reduced.values()],root:membership.get(root),membership};
  }
  function scene(model,id){const n=model.nodes.get(id);return {id,kind:'scene',title:n.title,members:[id],leaf:n.leaf,missing:n.missing,cycle:model.cycleOf.has(id)};}
  function compact(model,ids,{cycles=true,chains=true,endings=true,duplicates=true}={}){
    const allowed=new Set(ids),groups=[],used=new Set();
    if(cycles)model.graph.analysis.cycles.forEach((members,index)=>{const local=members.filter(id=>allowed.has(id));if(!local.length)return;
      local.forEach(id=>used.add(id));const entry=local.find(id=>model.edges.some(e=>e.target===id&&!local.includes(e.source)))||local[0];
      groups.push({id:`cycle:${index}`,kind:'cycle',title:model.nodes.get(entry).title,members:local,cycles:1,entry,
        fullMembers:members,
        trapped:model.graph.analysis.traps.some(t=>t.some(id=>local.includes(id)))});});
    if(endings)for(const ending of model.graph.ending_groups||[]){
      const local=ending.member_ids.filter(id=>allowed.has(id)&&!used.has(id));
      if(local.length<2)continue;
      local.forEach(id=>used.add(id));groups.push({id:'ending:'+ending.key,kind:'ending-group',title:ending.name,
        members:local,fullMembers:ending.member_ids,leaf:true,category:ending.category,endingId:ending.id});
    }
    if(duplicates)for(const group of model.duplicates){
      const local=group.members.filter(id=>allowed.has(id)&&!used.has(id));
      if(local.length<2)continue;
      local.forEach(id=>used.add(id));groups.push({...group,members:local});
    }
    ids.filter(id=>!used.has(id)).forEach(id=>groups.push(scene(model,id)));
    let result=aggregate(groups,model.edges,model.graph.root);
    if(!chains)return result;
    const outgoing=new Map(groups.map(g=>[g.id,[]])),incoming=new Map(groups.map(g=>[g.id,[]])),byId=new Map(groups.map(g=>[g.id,g]));
    result.edges.forEach(e=>{outgoing.get(e.source).push(e.target);incoming.get(e.target).push(e.source);});
    const eligible=id=>{const g=byId.get(id);return g.kind==='scene'&&!g.leaf&&!g.missing&&g.id!==result.root&&outgoing.get(id).length===1&&incoming.get(id).length===1;};
    const consumed=new Set(),newGroups=[];
    for(const group of groups){if(consumed.has(group.id))continue;
      if(!eligible(group.id)||eligible(incoming.get(group.id)[0]))continue;
      const run=[],seen=new Set();let id=group.id;
      while(eligible(id)&&!seen.has(id)&&!consumed.has(id)){run.push(id);seen.add(id);id=outgoing.get(id)[0];}
      if(run.length<3)continue;
      run.forEach(id=>consumed.add(id));newGroups.push({id:`chain:${run[0]}`,kind:'chain',title:byId.get(run[0]).title,members:run,entry:run[0]});
    }
    newGroups.push(...groups.filter(g=>!consumed.has(g.id)));
    return aggregate(newGroups,model.edges,model.graph.root);
  }
  function buildView(model,options={}){
    if(options.route){const r=options.route;
      const ids=[model.graph.root,...r.steps.map(s=>s.target)],nodes=ids.map((id,i)=>({...scene(model,id),id:`route:${i}`,occurrence:i,original:id}));
      const edges=r.steps.map((step,i)=>({id:`route-edge:${i}`,source:`route:${i}`,target:`route:${i+1}`,choices:[{...step,text:step.choice}]}));
      return {nodes,edges,root:'route:0',membership:new Map(ids.map((id,i)=>[id,`route:${i}`])),route:true};}
    if(options.mode==='overview'&&!options.focus){
      const chapters=[...model.chapters.values()].sort((a,b)=>a.code&&b.code?parseInt(a.code)-parseInt(b.code)||a.code.localeCompare(b.code):Math.min(...a.members.map(id=>model.depth.get(id)||0))-Math.min(...b.members.map(id=>model.depth.get(id)||0)));
      const groups=[scene(model,model.graph.root),...chapters.map(g=>({...g}))];
      const endings=model.graph.nodes.filter(n=>n.leaf&&n.id!==model.graph.root).map(n=>n.id);
      if(endings.length)groups.push({id:'all-endings',kind:'endings',title:'故事的所有结局',members:endings});
      return {...aggregate(groups,model.edges,model.graph.root),overview:true};
    }
    let ids=options.focus?.members||model.graph.nodes.map(n=>n.id);
    if(options.focus?.kind==='chapter'&&ids.length>45&&options.mode==='overview'&&!options.center){
      const sections=new Map();
      for(const id of ids){const n=model.nodes.get(id),parts=n.title.split(/[-－]/),name=parts.length>1?parts[1]:'其他片段';
        if(!sections.has(name))sections.set(name,{id:'section:'+options.focus.id+':'+name,kind:'section',title:name,members:[]});sections.get(name).members.push(id);}
      if(sections.size>1){
        const groups=[...sections.values()];groups.forEach(g=>g.cycles=new Set(g.members.map(id=>model.cycleOf.get(id)).filter(i=>i!==undefined)).size);
        const allowed=new Set(ids),portals=new Map();
        for(const e of model.edges)if(allowed.has(e.source)&&!allowed.has(e.target)){const key=model.chapterOf.get(e.target)||e.target;if(!portals.has(key))portals.set(key,{id:'exit:'+key,kind:'portal',title:model.chapters.get(key)?.title||model.nodes.get(e.target).title,members:[],destination:key});if(!portals.get(key).members.includes(e.target))portals.get(key).members.push(e.target);}
        return {...aggregate([...groups,...portals.values()],model.edges,model.graph.root),overview:true};
      }
    }
    if(options.center){const allowed=new Set(ids),neighbors=new Map(ids.map(id=>[id,new Set()]));for(const e of model.edges)if(allowed.has(e.source)&&allowed.has(e.target)){neighbors.get(e.source).add(e.target);neighbors.get(e.target).add(e.source);}
      const chosen=new Set([options.center]),queue=[[options.center,0]];
      for(let i=0;i<queue.length&&chosen.size<24;i++){const [id,depth]=queue[i];if(depth>=2)continue;for(const child of neighbors.get(id)||[])if(!chosen.has(child)&&chosen.size<24){chosen.add(child);queue.push([child,depth+1]);}}
      ids=[...chosen];}
    const result=compact(model,ids,{cycles:options.center?false:options.cycles!==false,chains:options.center?false:options.chains!==false,endings:options.mode!=='full'&&!options.center,duplicates:options.mode!=='full'&&options.duplicates!==false});
    if(options.focus||options.center){const allowed=new Set(ids),allFocus=new Set(options.focus?.members||ids),portals=new Map();
      for(const e of model.edges){if(!allowed.has(e.source)||allowed.has(e.target))continue;const groupId=model.chapterOf.get(e.target)||e.target;
        const key=allFocus.has(e.target)?'more:'+groupId:'exit:'+groupId;
        if(!portals.has(key))portals.set(key,{id:key,kind:'portal',title:allFocus.has(e.target)?'区域内更多片段':model.chapters.get(groupId)?.title||model.nodes.get(e.target).title,members:[],destination:groupId});
        if(!portals.get(key).members.includes(e.target))portals.get(key).members.push(e.target);}
      const focused=aggregate([...result.nodes,...portals.values()],model.edges,model.graph.root);
      focused.root=focused.membership.get(options.center||options.focus?.entry||options.focus?.members[0])||focused.root;
      return focused;
    }
    return result;
  }
  function build(model,options={}){
    const view=buildView(model,options),copyOf=new Map();
    model.duplicates.forEach(g=>g.members.forEach(id=>copyOf.set(id,g.id)));
    for(const n of view.nodes){
      const forks=n.members.map(id=>model.endingForks.get(id)).filter(Boolean);
      n.forkCount=new Set(forks.map(f=>copyOf.get(f.node)||f.node)).size;
      if(['scene','duplicates'].includes(n.kind)&&forks.length)n.endingFork=forks[0];
    }
    return view;
  }
  const cardHeight=n=>82+(n.endingFork?n.endingFork.options.length*38+8:0);
  function layout(view){
    if(!view.nodes.length)return {positions:new Map(),w:600,h:400};
    if(view.overview){
      const cols=3,nodeW=216,nodeH=82,gapX=50,gapY=64,padding=65,positions=new Map();let y=padding;
      for(let i=0;i<view.nodes.length;i+=cols){
        const row=Math.floor(i/cols),nodes=view.nodes.slice(i,i+cols);
        nodes.forEach((n,index)=>{const col=row%2?cols-1-index:index;positions.set(n.id,{x:padding+col*(nodeW+gapX),y,w:nodeW,h:cardHeight(n),rank:row});});
        y+=Math.max(...nodes.map(cardHeight))+gapY;
      }
      return {positions,w:cols*(nodeW+gapX)-gapX+padding*2,h:y-gapY+padding,nodeW,nodeH};
    }
    const groups=scc(view.nodes.map(n=>n.id),view.edges),component=new Map();groups.forEach((g,i)=>g.forEach(id=>component.set(id,i)));
    const next=new Map(groups.map((_,i)=>[i,new Set()])),prev=new Map(groups.map((_,i)=>[i,new Set()]));
    for(const e of view.edges){const a=component.get(e.source),b=component.get(e.target);if(a!==b){next.get(a).add(b);prev.get(b).add(a);}}
    // A loop's members use breadth-first levels inside their component.
    // Back edges remain visible, rather than forcing 70 scenes into one row.
    const internal=new Map(),heights=new Map();
    const connected=new Map(view.nodes.map(n=>[n.id,[]]));view.edges.forEach(e=>connected.get(e.source).push(e.target));
    groups.forEach((members,i)=>{
      const externalEntry=view.edges.find(e=>component.get(e.target)===i&&component.get(e.source)!==i)?.target;
      const root=component.get(view.root)===i?view.root:externalEntry||members[0];const queue=[root];internal.set(root,0);
      for(let j=0;j<queue.length;j++)for(const child of connected.get(queue[j]))if(component.get(child)===i&&!internal.has(child)){internal.set(child,internal.get(queue[j])+1);queue.push(child);}
      heights.set(i,Math.max(...members.map(id=>internal.get(id)||0))+1);
    });
    const rank=new Map(groups.map((_,i)=>[i,0])),pending=new Map(groups.map((_,i)=>[i,prev.get(i).size])),queue=groups.map((_,i)=>i).filter(i=>!pending.get(i));
    for(let i=0;i<queue.length;i++)for(const target of next.get(queue[i])){rank.set(target,Math.max(rank.get(target),rank.get(queue[i])+heights.get(queue[i])));pending.set(target,pending.get(target)-1);if(!pending.get(target))queue.push(target);}
    const nodeRank=id=>rank.get(component.get(id))+(internal.get(id)||0);
    const layers=new Map();view.nodes.forEach(n=>{const r=nodeRank(n.id);if(!layers.has(r))layers.set(r,[]);layers.get(r).push(n.id);});
    const order=new Map();const update=()=>layers.forEach(ids=>ids.forEach((id,i)=>order.set(id,i)));update();
    const incoming=new Map(view.nodes.map(n=>[n.id,[]])),outgoing=new Map(view.nodes.map(n=>[n.id,[]]));view.edges.forEach(e=>{incoming.get(e.target).push(e.source);outgoing.get(e.source).push(e.target);});
    for(let sweep=0;sweep<6;sweep++){const rows=[...layers.keys()].sort((a,b)=>sweep%2?b-a:a-b);for(const r of rows){const score=id=>{const peers=(sweep%2?outgoing:incoming).get(id).filter(p=>nodeRank(p)!==r);return peers.length?peers.reduce((s,p)=>s+(order.get(p)||0),0)/peers.length:order.get(id);};layers.get(r).sort((a,b)=>score(a)-score(b));update();}}
    const nodeW=216,nodeH=82,gapX=44,gapY=96,padding=90,byId=new Map(view.nodes.map(n=>[n.id,n]));
    const widest=Math.max(...[...layers.values()].map(l=>l.length)),w=Math.max(560,widest*(nodeW+gapX)+padding*2);
    const rowY=new Map();let y=padding;
    for(const r of [...layers.keys()].sort((a,b)=>a-b)){rowY.set(r,y);y+=Math.max(...layers.get(r).map(id=>cardHeight(byId.get(id))))+gapY;}
    const h=y-gapY+padding,positions=new Map();layers.forEach((ids,r)=>ids.forEach((id,i)=>positions.set(id,{x:(w-ids.length*(nodeW+gapX)+gapX)/2+i*(nodeW+gapX),y:rowY.get(r),w:nodeW,h:cardHeight(byId.get(id)),rank:r})));
    return {positions,w,h,nodeW,nodeH,layers};
  }
  return {create,build,layout,edgesOf,scc,displayChoices,endingForks};
});
