'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cut = (text, length) => [...String(text)].length > length ? [...String(text)].slice(0,length).join('')+'…' : text;
let current=null, library=[], route=null, selected=null, job=null, toastTimer=null;
let transform={x:0,y:0,k:1}, graphSize={w:1,h:1}, drag=null;
let mapModel=null,mapView=null,mapLayout=null,mapFocus=[],mapCenter=null,routeIndex=0;
let authors=[],activeAuthor=null,authorCatalog=null,authorBusy=false,authorRequest=0;
let navigationReady=false,restoringNavigation=false,navigationVersion=0,comparison=null;

async function api(path, method='GET', data) {
  const response=await fetch(path,{method,headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
function toast(message) {$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}
function error(message) {$('#parse-error').textContent=message;$('#parse-error').hidden=!message;}
function showPage(page) {
  if(page!=='explore')setMapFullscreen(false);
  $('#explore-page').hidden=page!=='explore';$('#library-page').hidden=page!=='library';$('#authors-page').hidden=page!=='authors';
  $$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page===page));
  $('#breadcrumb').innerHTML=`工作空间 <span>/</span> ${page==='explore'?'流程探索':page==='authors'?'UP 主作品':'我的攻略库'}`;
  if(page==='library') refreshLibrary().catch(e=>toast(e.message));
  if(page==='explore' && current) requestAnimationFrame(readableGraph);
  if(page==='authors')refreshAuthors().catch(e=>toast(e.message));
  queueNavigation();
}
async function refreshLibrary() {
  library=await api('/api/guides');$('#library-count').textContent=library.length;
  authors=await api('/api/authors');renderAuthorChips();
  const author=$('#author-filter').value,tag=$('#tag-filter').value;
  $('#author-filter').innerHTML='<option value="">全部 UP 主</option>'+[...new Set(library.map(g=>g.author))].sort().map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');
  $('#tag-filter').innerHTML='<option value="">全部标签</option>'+[...new Set(library.flatMap(g=>g.tags))].sort().map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('#author-filter').value=author;$('#tag-filter').value=tag;renderLibrary();
}
function renderLibrary() {
  const search=$('#library-search').value.trim().toLowerCase(),author=$('#author-filter').value,tag=$('#tag-filter').value;
  let rows=library.filter(g=>(!author||g.author===author)&&(!tag||g.tags.includes(tag))&&(!$('#favorites-only').checked||g.favorite)&&[g.title,g.author,g.bvid,...g.tags].join(' ').toLowerCase().includes(search));
  const sort=$('#sort-select').value;
  rows.sort((a,b)=>sort==='oldest'?a.updated_at.localeCompare(b.updated_at):sort==='title'?a.title.localeCompare(b.title,'zh-CN'):sort==='endings'?b.endings-a.endings:sort==='published'?(b.published_at||0)-(a.published_at||0):b.updated_at.localeCompare(a.updated_at));
  $('#library-empty').hidden=!!rows.length;
  $('#library-cards').innerHTML=rows.map(g=>`<article class="library-card" data-id="${esc(g.id)}"><div class="card-meta"><span class="badge">${g.source==='demo'?'离线示例':g.complete?'已完整分析':'部分结果'}</span><button class="card-favorite ${g.favorite?'saved':''}" data-action="favorite" aria-label="${g.favorite?'取消收藏':'收藏'}">${g.favorite?'★':'☆'}</button></div><h3>${esc(g.title)}</h3><p>${g.author_id?`<button class="author-link" data-action="author">${esc(g.author)} ↗</button>`:esc(g.author)} · ${esc(g.bvid)}</p><div class="card-stats">${g.nodes} 个片段 &nbsp; / &nbsp; ${g.endings} 个已发现结局<br><br>${new Date(g.updated_at).toLocaleString('zh-CN',{hour12:false})}</div><div>${g.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div><div class="card-actions"><button class="primary" data-action="open">继续探索 →</button><button class="text-button" data-action="tags">分类</button><button class="text-button" data-action="export">导出</button><button class="text-button" data-action="delete">删除</button></div></article>`).join('');
}
async function openGuide(id,record=null) {
  current=record||await api('/api/guides/'+id);comparison=null;route=null;selected=null;mapModel=StoryMap.create(current.graph);mapFocus=[];mapCenter=null;$('#node-search').value='';$('#search-results').hidden=true;$('#map-mode').value='compact';$('#ending-sort').value='category';$('#merge-duplicates').checked=true;$('#route-only').checked=false;showPage('explore');
  $('#empty-workspace').hidden=true;$('#result').hidden=false;renderResult();
  localStorage.setItem('lastGuide',id);queueNavigation();refreshLibrary().catch(e=>toast(e.message));
}
function renderResult() {
  const g=current.graph,a=g.analysis,m=g.metadata;
  $('#story-title').textContent=m.title;$('#guide-author').textContent='UP 主 / '+m.author+(m.author_id?' ↗':'');$('#guide-author').disabled=!m.author_id;
  $('#video-id').textContent=m.bvid||'';$('#source-badge').textContent=m.source==='demo'?'离线示例 · 虚构故事':a.complete?'完整状态分析':'部分分析 · 待验证';
  $('#favorite-button').textContent=current.favorite?'★ 已收藏':'☆ 收藏';
  $('#original-button').hidden=!/^BV[A-Za-z0-9]{10}$/.test(m.bvid||'');
  $('#stat-nodes').textContent=g.nodes.length;
  renderEndingStats();
  $('#stat-cycles').textContent=a.cycles.length;$('#stat-states').textContent=a.states.toLocaleString();$('#stat-states').title='按片段、当前问题和未来仍会读取的变量去重；同一片段可能有多个评分状态，不是视频片段数量。';
  const warnings=[...a.warnings,...(g.ending_recognition?.warnings||[])];
  $('#warnings-panel').hidden=!warnings.length;
  $('#warnings-title').textContent=(a.complete?'解析说明':'待验证事项')+` · ${warnings.length} 条`+(a.traps.length?` · 已确认 ${a.traps.length} 个状态闭环`:'');
  $('#warning-list').innerHTML=warnings.map(w=>`<li>${esc(w)}</li>`).join('');
  $('#warnings-panel').open=!a.complete;
  $('#ending-count').textContent=endingGroups().length;
  $('#route-description').textContent=a.complete?'已按累计变量验证可达性。选择结局，高亮最少步骤路线。':'以下仅列出已发现结局。可达路线已验证，完整性与最短性仍待验证。';
  renderEndingCards();
  $('#route-panel').hidden=true;showEndingNavigation();
  renderComparison();drawGraph(true);renderNodeList();
}
function edgesOf(g) {return StoryMap.edgesOf(g);}
function mapOptions(){return {duplicates:$('#merge-duplicates').checked,mode:$('#map-mode').value,focus:mapFocus.at(-1),center:mapCenter,cycles:mapFocus.at(-1)?.kind==='cycle'?false:$('#collapse-cycles').checked&&$('#map-mode').value!=='full',chains:mapFocus.at(-1)?.kind==='cycle'?false:$('#collapse-chains').checked&&$('#map-mode').value!=='full',route:route&&$('#route-only').checked?route:null};}
function endingDestinationName(id){return endingGroup(id)?.groupName||endingName(mapModel.nodes.get(id)||{id,title:id});}
function forkChoiceText(option){return option.automatic?'自动分流':option.text||'继续';}
function renderEndingFork(fork){
  if(!fork)return '';
  return `<section class="ending-fork-summary"><h4><span aria-hidden="true">◆</span> 结局分岔 · ${fork.endingCount} 个不同结局</h4>`+
    fork.options.map(option=>`<div class="fork-option" data-fork-option="${esc(option.key)}"><strong>${esc(forkChoiceText(option))}</strong><button class="fork-destination" data-locate="${esc(option.endingId)}">→ ${esc(endingDestinationName(option.endingId))}</button>${option.condition?`<code>条件：${esc(human(option.condition))}</code>`:''}${option.action?`<code>更新：${esc(human(option.action))}</code>`:''}<small>${option.condition?'满足上述条件后 · ':''}${option.hops?`经过 ${option.hops} 次无条件自动跳转到达`:'直接进入结局'}</small></div>`).join('')+'</section>';
}
function drawGraph(reset=false) {
  if(!current)return;
  mapModel??=StoryMap.create(current.graph);
  mapView=StoryMap.build(mapModel,mapOptions());mapLayout=StoryMap.layout(mapView);graphSize={w:mapLayout.w,h:mapLayout.h};
  const positions=mapLayout.positions,routeKeys=new Set(route?.steps.map(s=>s.key)||[]),routeIds=new Set(route?[current.graph.root,route.id,...route.steps.flatMap(s=>[s.source,s.target])]:[]);
  const compareA=new Set(comparison?.a.steps.map(s=>s.key)||[]),compareB=new Set(comparison?.b.steps.map(s=>s.key)||[]),keyNodes=new Set(comparison?.keyNodes||[]);
  if(comparison){routeIds.clear();[comparison.a,comparison.b].forEach(r=>[current.graph.root,r.id,...r.steps.flatMap(s=>[s.source,s.target])].forEach(id=>routeIds.add(id)));}
  const showLabels=$('#edge-labels').checked||mapView.route;
  const displayNodes=new Map(mapView.nodes.map(n=>[n.id,n]));
  const sourceEdges=new Map(mapView.nodes.map(n=>[n.id,[]])),targetEdges=new Map(mapView.nodes.map(n=>[n.id,[]]));
  mapView.edges.forEach(e=>{sourceEdges.get(e.source).push(e);targetEdges.get(e.target).push(e);});
  const paths=mapView.edges.map((e,index)=>{
    const p=positions.get(e.source),t=positions.get(e.target);if(!p||!t)return '';
    const onA=e.choices.some(c=>compareA.has(c.key)),onB=e.choices.some(c=>compareB.has(c.key));
    const active=comparison?(onA||onB):(mapView.route||e.choices.some(c=>routeKeys.has(c.key)));
    const relevant=selected&&(mapView.membership?.get(selected)===e.source||mapView.membership?.get(selected)===e.target);
    const from=sourceEdges.get(e.source),into=targetEdges.get(e.target),sx=p.x+p.w*(from.indexOf(e)+1)/(from.length+1),sy=p.y+p.h,tx=t.x+t.w*(into.indexOf(e)+1)/(into.length+1),ty=t.y;
    let d,lx,ly;
    if(mapView.overview&&p.y===t.y){const offset=22+(index%4)*6;d=`M ${sx} ${sy} C ${sx} ${sy+offset},${tx} ${sy+offset},${tx} ${t.y+t.h}`;lx=(sx+tx)/2;ly=sy+offset;}
    else if(mapView.overview&&Math.abs(t.rank-p.rank)>1){const side=graphSize.w-20-(index%5)*6;d=`M ${p.x+p.w} ${p.y+p.h/2} C ${side} ${p.y+p.h/2},${side} ${t.y+t.h/2},${t.x+t.w} ${t.y+t.h/2}`;lx=side;ly=(p.y+t.y)/2;}
    else if(ty>sy){const mid=(sy+ty)/2;d=`M ${sx} ${sy} C ${sx} ${mid},${tx} ${mid},${tx} ${ty}`;lx=(sx+tx)/2;ly=mid-8;}
    else{const side=Math.max(p.x+p.w,t.x+t.w)+28+(index%4)*14;d=`M ${p.x+p.w} ${p.y+p.h/2} C ${side+38} ${p.y+p.h/2},${side+38} ${t.y+t.h/2},${t.x+t.w} ${t.y+t.h/2}`;lx=side;ly=(p.y+t.y)/2+p.h/2;}
    const color=comparison&&onB&&!onA?'#278c88':comparison&&onA&&onB?'#a8864a':active?'#7960d4':relevant?'#5d718c':'#bcc4d2',opacity=(route||comparison)&&!active ? .12 : selected&&!relevant&&!active ? .25 : 1;
    const choices=displayNodes.get(e.source).kind==='duplicates'?StoryMap.displayChoices(e.choices):e.choices;
    const manualChoices=choices.filter(c=>!c.automatic);
    const label=manualChoices.length>1?`${manualChoices.length} 条选项`:manualChoices[0]?.text||manualChoices[0]?.choice||'';
    const direct=displayNodes.get(e.source).endingFork?StoryMap.displayChoices(e.choices.filter(c=>mapModel.endingChoices.has(c.key))).map(c=>mapModel.endingChoices.get(c.key)):[];
    const forkLabel=direct.map(c=>`${forkChoiceText(c)}${c.condition?' [条件]':''} → ${endingDestinationName(c.endingId)}`).join(' / ');
    const title=choices.map(c=>`${c.automatic?'自动跳转':c.text||c.choice}${c.condition?'\n条件：'+human(c.condition):''}${c.action?'\n变化：'+human(c.action):''}`).join('\n\n')+(forkLabel?'\n'+forkLabel:'');
    return `<g class="edge-group" data-edge="${esc(e.id)}" opacity="${opacity}"><path data-comparison="${comparison?(onA&&onB?'both':onB?'b':onA?'a':''):''}" class="graph-edge ${active?'highlight':''} ${relevant?'relevant':''} ${forkLabel?'ending-fork-edge':''}" d="${d}" stroke="${color}" stroke-width="${active?2.6:1.35}" fill="none" marker-end="url(#${comparison&&onB&&!onA?'arrow-teal':comparison&&onA&&onB?'arrow-gold':active?'arrow-violet':forkLabel?'arrow-amber':'arrow'})"><title>${esc(title)}</title></path>${forkLabel?`<text class="${direct.every(c=>c.automatic)?'':'edge-label '}fork-edge-label" x="${lx}" y="${ly}" text-anchor="middle" font-size="10" font-weight="600" fill="#934609">${esc(cut(forkLabel,29))}</text>`:''}${!forkLabel&&label&&(showLabels||active||relevant)?`<text class="edge-label" x="${lx}" y="${ly}" text-anchor="middle" fill="${active?'#7960d4':'#748096'}">${esc(cut(label,19))}</text>`:''}</g>`;
  }).join('');
  const groups=mapView.nodes.map((n,i)=>{
    const p=positions.get(n.id),group=n.kind!=='scene',active=n.members.some(id=>routeIds.has(id)),isSelected=n.members.includes(selected),isRoot=n.members.includes(current.graph.root);
    const endingType=n.kind==='ending-group'?n.category:n.leaf&&!group?endingAnnotation(n.members[0]).category:null;
    const color=n.leaf?(endingType==='BE'?'#a43e43':['HE','GE'].includes(endingType)?'#24734e':'#52648b'):isRoot?'#6950ce':n.kind==='cycle'?'#916017':n.kind==='chapter'||n.kind==='section'?'#32659c':['chain','duplicates'].includes(n.kind)?'#287973':'#586b85';
    const fill=n.leaf?(endingType==='BE'?'#ffe8e6':['HE','GE'].includes(endingType)?'#ddf3e5':'#e6ebf8'):isRoot?'#eee6ff':n.kind==='cycle'?'#fff1d5':n.kind==='chapter'||n.kind==='section'?'#e4efff':['chain','duplicates'].includes(n.kind)?'#e0f3ef':n.kind==='portal'?'#edf1f7':'#fff';
    const label=mapView.route?`STEP ${String(i).padStart(2,'0')}`:n.kind==='section'?'情节区域 · 点击进入':n.kind==='endings'?'⚑ 结局导航 · 点击展开':n.kind==='chapter'?'章节 · 点击进入':n.kind==='cycle'?'↻ 循环区域 · 点击进入':n.kind==='duplicates'?'相同片段 · 已归并':n.kind==='chain'?'连续片段 · 点击展开':n.kind==='portal'?'↗ 继续探索':n.leaf?('故事结局'+(endingType?' · '+endingType:'')):isRoot?'故事起点':n.missing?'尚未读取':'剧情片段';
    const subtitle=n.kind==='duplicates'?`${n.members.length} 个相同片段 · 点击查看详情`:group?`${n.members.length} 个片段${n.cycles?' · '+n.cycles+' 个含环区域':''}${n.trapped?' · 含已确认闭环':''}`:n.cycle?'↻ 环内片段 · 条件见详情':n.members[0];
    const keyNode=n.members.some(id=>keyNodes.has(id)),fork=n.endingFork;
    const forkRows=fork?fork.options.map((option,index)=>{const y=84+index*38;return `<g data-fork-choice="${esc(option.key)}"><path class="fork-row-bg" d="M10 ${y} H206 V${y+34} H10 Z" fill="#fffdf5"/><text class="fork-choice-text" x="16" y="${y+12}" font-size="10" fill="#77420b">${esc(cut(forkChoiceText(option)+(option.condition?' [条件]':'')+(option.hops?' [自动×'+option.hops+']':''),18))}</text><text class="fork-ending-text" x="16" y="${y+27}" font-size="10" font-weight="600" fill="#7d3c09">→ ${esc(cut(endingDestinationName(option.endingId),18))}</text></g>`;}).join(''):'';
    const displayTitle=n.leaf&&!group?endingName({id:n.members[0],title:n.title}):n.title;
    const titleLines=wrapTitle(displayTitle,17,2);
    return `<g tabindex="0" role="button" aria-label="${esc(displayTitle+(fork?' · 结局分岔':''))}" class="graph-node ${group?'group-node':''} ${active?'highlight':''} ${isSelected?'selected':''} ${keyNode?'key-node':''} ${fork?'ending-fork':n.forkCount?'contains-ending-fork':''}" data-kind="${esc(n.kind)}" data-ending-type="${esc(endingType||'')}" data-root="${isRoot}" data-display="${esc(n.id)}" ${n.kind==='scene'?`data-node="${esc(n.members[0])}"`:''} transform="translate(${p.x},${p.y})" opacity="${(route||comparison)&&!active&&!mapView.route ? .5 : 1}"><title>${esc(displayTitle)}\n${esc(n.title)}\n${esc(subtitle)}</title><rect width="${p.w}" height="${p.h}" rx="9" fill="${fork?'#fff0cf':fill}" stroke="${fork?'#b75b08':keyNode?'#c8953f':active||isSelected?'#9279d9':color}" stroke-width="${fork?3:keyNode?2.5:isSelected?2:1.2}" ${n.kind==='portal'?'stroke-dasharray="5 3"':''}/>${fork?'<path class="fork-diamond" d="M14 9 L21 16 L14 23 L7 16 Z" fill="#b75b08"/>':`<circle class="node-dot" cx="14" cy="16" r="3" fill="${color}"/>`}<text class="node-caption" x="23" y="19" font-size="9" fill="${fork?'#894707':color}">${esc(fork?'结局分岔 · '+fork.endingCount+' 个结局':keyNode?'◆ 结局关键节点':label)}</text>${titleLines.map((line,j)=>`<text class="node-title" x="14" y="${39+j*15}" font-size="12" font-weight="600" fill="#26374f">${esc(line)}</text>`).join('')}<text class="node-subtitle" x="14" y="72" font-size="9" fill="#596a82">${esc(cut(n.forkCount&&!fork?`${n.members.length} 个片段 · ◆ ${n.forkCount} 处结局分岔`:subtitle,35))}</text>${forkRows}${group?`<text class="node-expand" x="201" y="19" text-anchor="end" font-size="13" fill="${color}">${n.kind==='duplicates'?'≡':'＋'}</text>`:''}</g>`;
  }).join('');
  $('#graph-svg').innerHTML=`<defs>${[['arrow','#bcc4d2'],['arrow-violet','#7960d4'],['arrow-teal','#278c88'],['arrow-gold','#a8864a'],['arrow-amber','#bd762d']].map(([id,color])=>`<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`).join('')}</defs><g id="graph-content">${paths}${groups}</g>`;
  $('#map-count').textContent=`当前 ${mapView.nodes.length} 张卡片 / 原始 ${current.graph.nodes.length} 个片段`;
  $('#map-breadcrumb').innerHTML=`<button data-level="-1">${mapView.route?'故事地图 / 当前攻略':'故事地图'}</button>`+mapFocus.map((f,i)=>`<span>›</span><button data-level="${i}">${esc(cut(f.title,18))}</button>`).join('')+(mapCenter?'<span>›</span><span>片段邻域</span>':'');
  $('#route-only-label').hidden=!route;$('#route-navigator').hidden=!mapView.route;
  $('#collapse-cycles').disabled=$('#map-mode').value==='full'||!!mapCenter||mapView.route||mapView.overview||mapFocus.at(-1)?.kind==='cycle';
  $('#merge-duplicates').disabled=$('#map-mode').value==='full'||!!mapView.route||!!mapView.overview;
  $('#collapse-chains').disabled=$('#map-mode').value==='full'||!!mapCenter||mapView.route||mapView.overview||mapFocus.at(-1)?.kind==='cycle';
  renderMinimap();applyTransform();if(reset)requestAnimationFrame(readableGraph);
}
function wrapTitle(text,width=17,lines=2){const letters=[...text],out=[];for(let i=0;i<lines&&i*width<letters.length;i++){let part=letters.slice(i*width,(i+1)*width).join('');if(i===lines-1&&letters.length>(i+1)*width)part=part.slice(0,-1)+'…';out.push(part);}return out;}
function renderMinimap(){
  const positions=mapLayout.positions;
  $('#minimap').setAttribute('viewBox',`0 0 ${graphSize.w} ${graphSize.h}`);$('#minimap').setAttribute('preserveAspectRatio','none');
  $('#minimap').innerHTML=`<rect width="${graphSize.w}" height="${graphSize.h}" fill="#f8f9fd"/>`+mapView.edges.map(e=>{const a=positions.get(e.source),b=positions.get(e.target);return `<path d="M${a.x+a.w/2} ${a.y+a.h} L${b.x+b.w/2} ${b.y}" stroke="#ced4e0" stroke-width="4"/>`;}).join('')+mapView.nodes.map(n=>{const p=positions.get(n.id);return `<rect data-kind="${esc(n.kind)}" data-leaf="${!!n.leaf}" data-fork="${!!n.endingFork}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" fill="${n.endingFork?'#db851e':n.leaf?'#a8d1bd':n.kind==='cycle'?'#d9c5a3':'#c4c8e0'}"/>`;}).join('')+'<rect id="minimap-window" fill="#7360df0d" stroke="#8d79ce" stroke-width="5"/>';
}
function applyTransform(){
  const content=$('#graph-content');if(content)content.setAttribute('transform',`translate(${transform.x},${transform.y}) scale(${transform.k})`);
  const frame=$('#minimap-window'),box=$('#graph-viewport').getBoundingClientRect();if(frame){frame.setAttribute('x',-transform.x/transform.k);frame.setAttribute('y',-transform.y/transform.k);frame.setAttribute('width',box.width/transform.k);frame.setAttribute('height',box.height/transform.k);}
  $('#graph-svg').classList.toggle('zoomed-out',transform.k<.45);
}
function fitGraph(){const box=$('#graph-viewport').getBoundingClientRect();if(!box.width||!box.height)return;transform.k=Math.min((box.width-40)/graphSize.w,(box.height-50)/graphSize.h,1);transform.x=(box.width-graphSize.w*transform.k)/2;transform.y=(box.height-graphSize.h*transform.k)/2;applyTransform();}
function readableGraph(){
  const box=$('#graph-viewport').getBoundingClientRect();if(!box.width||!box.height)return;
  const fit=Math.min((box.width-40)/graphSize.w,(box.height-50)/graphSize.h,1);
  if(fit>=.65){fitGraph();return;}
  transform.k=box.width<500?.8:1;
  const first=mapLayout.positions.get(mapView.root)||mapLayout.positions.values().next().value;
  transform.x=box.width/2-(first.x+first.w/2)*transform.k;transform.y=28-first.y*transform.k;applyTransform();
}
function focusDisplay(id){const p=mapLayout.positions.get(id);if(!p)return;const box=$('#graph-viewport').getBoundingClientRect();transform.k=Math.max(transform.k,box.width<500?.8:1);transform.x=box.width/2-(p.x+p.w/2)*transform.k;transform.y=Math.max(28,box.height*.25)-(p.y+p.h/2)*transform.k;applyTransform();}
function zoom(factor,x,y){const box=$('#graph-viewport').getBoundingClientRect();x??=box.width/2;y??=box.height/2;const k=Math.min(3,Math.max(.02,transform.k*factor));transform.x=x-(x-transform.x)*k/transform.k;transform.y=y-(y-transform.y)*k/transform.k;transform.k=k;applyTransform();}
function enterGroup(group){
  if(group.kind==='portal'){
    const chapter=mapModel.chapters.get(group.destination);
    if(chapter){mapFocus=[chapter];mapCenter=null;}else{mapCenter=group.members[0];}
  }else{if(group.kind==='cycle'&&group.fullMembers)group={...group,members:group.fullMembers};mapFocus.push(group);mapCenter=(group.kind==='cycle'&&group.members.length>24)||(group.kind==='section'&&group.members.length>45)?(group.entry||group.members.reduce((best,id)=>(mapModel.depth.get(id)??1e6)<(mapModel.depth.get(best)??1e6)?id:best,group.members[0])):null;}
  selected=null;$('#route-only').checked=false;drawGraph(true);renderNodeList();showGroupDetail(group);queueNavigation();
}
function renderGroupForks(group){
  const found=new Map();
  for(const id of group.members){
    const fork=mapModel.endingForks.get(id);if(!fork)continue;
    const key=mapModel.duplicates.find(g=>g.members.includes(id))?.id||id;
    if(!found.has(key))found.set(key,fork);
  }
  if(!found.size)return '';
  return '<section class="group-ending-forks"><h4>◆ 结局分岔点</h4>'+[...found.values()].map(f=>`<button data-locate="${esc(f.node)}"><strong>${esc(mapModel.nodes.get(f.node).title)}</strong><small>${f.endingCount} 个不同结局 · 定位并查看选项 →</small></button>`).join('')+'</section>';
}
function showGroupDetail(group){
  showDetail('区域导航');
  $('#node-detail').innerHTML=`<button class="text-button" data-return-endings>↑ 返回结局导航</button><br><span class="tiny-label">${group.kind==='cycle'?'LOOP AREA':'STORY AREA'}</span><h4>${esc(group.title)}</h4><p>${group.members.length} 个片段${group.trapped?' · 含已确认状态闭环':''}。${group.kind==='cycle'?'含环表示片段可以回访，是否能退出仍取决于评分和条件。':''}</p>${mapCenter?'<p>当前只展示入口附近，点击其他片段可切换阅读位置。</p>':''}${renderGroupForks(group)}<div class="group-cycles">${(group.kind==='cycle'?[]:[...new Set(group.members.map(id=>mapModel.cycleOf.get(id)).filter(i=>i!==undefined))]).map(i=>`<button data-cycle="${i}"><b>↻ 循环区域 ${i+1}</b><small>${current.graph.analysis.cycles[i].length} 个片段 · 点击进入</small></button>`).join('')}</div><div class="group-members">${group.members.map(id=>`<button data-locate="${esc(id)}"><span>${esc(mapModel.nodes.get(id).title)}</span><small>${esc(id)}</small></button>`).join('')}</div>`;
  scrollToDetail();
}
function navigateDisplay(id){const group=mapView.nodes.find(n=>n.id===id);if(!group)return;if(group.kind==='ending-group'){selectEnding(group.endingId);return;}if(group.kind==='duplicates'){selectNode(group.members.includes(selected)?selected:group.members.find(id=>route?.steps.some(s=>s.source===id||s.target===id))||group.members[0]);return;}if(group.kind==='scene'){selectNode(group.members[0]);if(mapView.route){routeIndex=group.occurrence;updateRoutePosition();}}else enterGroup(group);}
function locateNode(id){
  if(!mapModel.nodes.has(id))return;
  $('#route-only').checked=false;
  const chapter=mapModel.chapters.get(mapModel.chapterOf.get(id));
  mapFocus=chapter?[chapter]:[];mapCenter=id;
  drawGraph(true);selectNode(id);renderNodeList();requestAnimationFrame(()=>focusDisplay(mapView.membership.get(id)));
  $('#search-results').hidden=true;
}
function renderNodeList(){
  if(!current)return;const search=$('#node-search').value.trim().toLowerCase();
  const nodes=current.graph.nodes.filter(n=>(n.title+' '+(n.leaf?endingName(n):'')+' '+n.id).toLowerCase().includes(search));
  $('#node-list').innerHTML=`<div class="list-summary">${nodes.length} 个片段 · 点选后定位到该片段附近</div>`+nodes.map(n=>`<button class="node-row" data-node="${esc(n.id)}"><span>${esc(n.leaf?endingName(n):n.title)}</span><small>${mapModel.endingForks.has(n.id)?'◆ 结局分岔 · ':''}${n.leaf?'结局':n.missing?'未读取':n.questions.reduce((a,q)=>a+q.choices.length,0)+' 个选项'} · ${esc(n.id)}</small></button>`).join('');
}
function updateRoutePosition(){if(!route)return;routeIndex=Math.min(route.steps.length,Math.max(0,routeIndex));$('#route-position').textContent=`${routeIndex} / ${route.steps.length} 步`;$('#route-prev').disabled=routeIndex===0;$('#route-next').disabled=routeIndex===route.steps.length;}
function human(expression){let s=expression;[...current.graph.variables].sort((a,b)=>b.id.length-a.id.length).forEach(v=>s=s.split(v.id).join(v.name));return s;}
function valuesText(values){return Object.entries(values).map(([key,value])=>(current.graph.variables.find(v=>v.id===key)?.name||key)+' '+value).join(' · ');}
function showEndingNavigation(){$('#ending-sort-label').hidden=false;$('#node-detail').hidden=true;$('#endings').hidden=false;$('#route-description').hidden=false;$('#guide-panel-title').textContent='结局导航';$('#ending-count').hidden=false;$('.guide-panel').scrollTop=0;}
function showDetail(title){$('#ending-sort-label').hidden=true;$('#node-detail').hidden=false;$('#endings').hidden=true;$('#route-description').hidden=true;$('#guide-panel-title').textContent=title;$('#ending-count').hidden=true;$('.guide-panel').scrollTop=0;}
function scrollToDetail(){requestAnimationFrame(()=>{$('.guide-panel').scrollTop=0;});}
function selectNode(id){selected=id;const n=current.graph.nodes.find(n=>n.id===id);if(!n)return;drawGraph();const merged=mapView.nodes.find(g=>g.kind==='duplicates'&&g.members.includes(id));showDetail(merged?'相同片段详情':'片段详情');$('#node-detail').innerHTML=`<button class="text-button" data-return-endings>↑ 返回结局导航</button><br><span class="tiny-label">SELECTED SCENE / ${esc(id)}</span><h4>${esc(n.leaf?endingName(n):n.title)}</h4>${merged?`<p>已归并 ${merged.members.length} 个相同片段。名称、问题、选项、条件、变量更新与跳转目标完全一致；下方展示共同选项。</p><details class="equivalent-members"><summary>查看 ${merged.members.length} 个原始片段</summary><div class="group-members">${merged.members.map(member=>`<button data-equivalent="${esc(member)}" aria-pressed="${member===id}"><span>${esc(mapModel.nodes.get(member).title)}</span><small>${esc(member)}${member===id?' · 当前查看':''}</small></button>`).join('')}</div></details>`:''}${renderEndingFork(mapModel.endingForks.get(id))}${n.leaf?endingBadge(n.id)+`<p>原始片段标题：${esc(n.title)}</p><button class="secondary" data-ending-review="${esc(n.id)}">核对结局标注</button>`:''}${current.graph.analysis.traps.some(t=>t.includes(id))?'<span class="trap-label">↻ 某个可达变量状态下，进入此闭环后无法退出</span>':''}<button class="secondary detail-locate" data-locate="${esc(id)}">聚焦这个片段</button><p>${n.cid?'CID '+esc(n.cid)+' · ':''}${n.leaf?'已标记为结局片段':'以下为原始选项；是否可用取决于当时变量'}</p>`+(mapModel.endingForks.has(id)?'<details class="raw-choice-details"><summary>查看原始选项与中间跳转</summary>':'')+n.questions.map((q,qi)=>`<p>问题 ${qi+1}${q.type===0?' · 自动跳转':''}</p>`+q.choices.map(c=>`<div class="choice-detail">${q.type===0||c.hidden?'':`<b>${esc(c.text||'继续')}</b>`}${c.target?`<button class="choice-target" data-locate="${esc(c.target)}">→ ${esc(current.graph.nodes.find(t=>t.id===c.target)?.title||c.target)} ↗</button>`:'<small>继续当前片段下一问题</small>'}${c.condition?`<code>条件：${esc(human(c.condition))}</code>`:''}${c.action?`<code>更新：${esc(human(c.action))}</code>`:''}<small>${c.hidden?'隐藏选项 · ':''}${c.default?'默认选项':''}</small></div>`).join('')).join('')+(mapModel.endingForks.has(id)?'</details>':'');scrollToDetail();queueNavigation();}
function selectEnding(id){route=current.graph.analysis.endings.find(e=>e.id===id);if(!route?.reachable){route=null;$('#route-panel').hidden=true;$('#route-only-label').hidden=true;toast(current.graph.analysis.complete?'该结局在入口初始变量下不可达':'尚未找到可验证的到达路线，请查看待验证事项');drawGraph();return;}selected=null;mapFocus=[];mapCenter=null;routeIndex=0;$('#route-only').checked=false;showEndingNavigation();$$('.ending').forEach(e=>e.classList.toggle('selected',endingGroup(id)?.member_ids.includes(e.dataset.ending)));drawGraph(true);updateRoutePosition();$('#route-panel').hidden=false;$('#route-title').textContent=endingName(route);renderEndingRoutes();$('#route-summary').textContent=`${current.graph.analysis.complete?'最短攻略':'当前已验证路线'} · ${route.length} 次转换（含自动跳转）${(endingGroup(id)?.member_ids.length||0)>1?' · 同名结局已归并 '+endingGroup(id).member_ids.length+' 个节点':''} · 最终状态：${valuesText(route.final_values)||'无评分变量'}`;$('#route-steps').innerHTML=route.steps.map((s,i)=>`<li data-route-step="${i+1}" tabindex="0"><span>STEP ${String(i+1).padStart(2,'0')}${s.automatic?' · 自动':''}</span><b>${esc(current.graph.nodes.find(n=>n.id===s.source)?.title)}</b>${s.automatic?'':`<p>选择「${esc(s.choice)}」</p>`}${s.condition?`<small>需要：${esc(human(s.condition))}</small>`:''}${s.action?`<small>变化：${esc(human(s.action))}</small>`:''}<small>${s.automatic?'跳转后':'选择后'}：${esc(valuesText(s.after)||'无变量')}</small></li>`).join('')||'<li>起点就是该结局，无需选择。</li>';queueNavigation();}
function download(name,content,type='application/json'){const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([content],{type}));link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
function exportGuide(guide){download(`分岔-${guide.graph.metadata.bvid||guide.id}.json`,JSON.stringify(guide.graph,null,2));}
function routeText(){return `${current.graph.metadata.title}\n${endingName(route)}\n${current.graph.analysis.complete?'最短攻略':'当前已验证路线'}：${route.length} 步\n`+route.steps.map((s,i)=>`${i+1}. ${current.graph.nodes.find(n=>n.id===s.source)?.title} → ${s.automatic?'自动跳转':`选择「${s.choice}」`}${s.condition?'（需要 '+human(s.condition)+'）':''}${s.action?'；'+human(s.action):''}\n   ${s.automatic?'跳转后':'选择后'}：${valuesText(s.after)}`).join('\n');}

$$('.nav').forEach(n=>n.addEventListener('click',()=>showPage(n.dataset.page)));
$('#help-button').onclick=()=>$('#help-dialog').showModal();$('#help-close').onclick=()=>$('#help-dialog').close();
$('#cookie-toggle').onclick=()=>$('#cookie-panel').hidden=!$('#cookie-panel').hidden;
$('#parse-form').addEventListener('submit',async event=>{event.preventDefault();if(job)return;error('');$('#parse-button').disabled=true;$('#demo-button').disabled=true;try{const cookie=$('#cookie').value;$('#cookie').value='';const response=await api('/api/parse','POST',{url:$('#video-url').value,cookie});job=response.job_id;$('#job-panel').hidden=false;$('#cancel-button').disabled=false;pollJob();}catch(e){error(e.message);$('#parse-button').disabled=false;$('#demo-button').disabled=false;}});
async function pollJob(){if(!job)return;try{const status=await api('/api/jobs/'+job);$('#job-text').textContent=`${status.phase} · ${status.phase_kind==='endings'?'已处理结局':'已读取片段'} ${status.done} / ${status.discovered}`;$('#job-progress').style.width=Math.min(95,status.done/Math.max(status.discovered,1)*90)+'%';if(status.status==='running'){setTimeout(pollJob,900);return;}job=null;$('#job-panel').hidden=true;$('#parse-button').disabled=false;$('#demo-button').disabled=false;if(status.status==='error'){error(status.error);return;}await openGuide(status.guide_id);toast(status.ending_recognition?.status==='complete'?'流程与结局名称已自动保存':'流程已保存，部分结局名称仍待识别');}catch(e){job=null;$('#job-panel').hidden=true;$('#parse-button').disabled=false;$('#demo-button').disabled=false;error(e.message);}}
$('#cancel-button').onclick=async()=>{if(!job)return;try{await api('/api/jobs/'+job+'/cancel','POST',{});$('#cancel-button').disabled=true;$('#job-text').textContent='正在结束当前请求，已读取的流程会保留';}catch(e){toast(e.message);}};
$('#demo-button').onclick=async()=>{error('');$('#demo-button').disabled=true;try{const r=await api('/api/demo','POST',{});await openGuide(r.guide_id);toast('已打开虚构离线示例');}catch(e){error(e.message);}finally{$('#demo-button').disabled=false;}};
$('#favorite-button').onclick=async()=>{if(!current)return;try{current=await api('/api/guides/'+current.id,'PATCH',{favorite:!current.favorite});$('#favorite-button').textContent=current.favorite?'★ 已收藏':'☆ 收藏';await refreshLibrary();}catch(e){toast(e.message);}};
$('#original-button').onclick=()=>{const bvid=current?.graph.metadata.bvid;if(/^BV[A-Za-z0-9]{10}$/.test(bvid||''))window.open('https://www.bilibili.com/video/'+bvid+'/','_blank','noopener,noreferrer');};
$('#export-button').onclick=()=>current&&exportGuide(current);
$('#endings').onclick=event=>{const button=event.target.closest('[data-ending]');if(button)selectEnding(button.dataset.ending);};
$$('.tab').forEach(button=>button.onclick=()=>{$$('.tab').forEach(b=>b.classList.toggle('active',b===button));$('#graph-viewport').hidden=button.dataset.view!=='graph';$('#node-list').hidden=button.dataset.view!=='list';if(button.dataset.view==='graph')readableGraph();});
$('#zoom-in').onclick=()=>zoom(1.2);$('#zoom-out').onclick=()=>zoom(1/1.2);$('#fit-button').onclick=fitGraph;
$('#graph-viewport').addEventListener('wheel',event=>{
  if(!event.ctrlKey&&!event.metaKey&&!$('.graph-card').classList.contains('map-fullscreen'))return;
  event.preventDefault();const box=event.currentTarget.getBoundingClientRect();zoom(Math.exp(-event.deltaY*.0015),event.clientX-box.left,event.clientY-box.top);
},{passive:false});
$('#graph-viewport').addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('#minimap,#route-navigator'))return;drag={x:event.clientX,y:event.clientY,startX:transform.x,startY:transform.y,moved:false};});
window.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4){drag.moved=true;$('#graph-viewport').classList.add('dragging');transform.x=drag.startX+dx;transform.y=drag.startY+dy;applyTransform();}});
window.addEventListener('pointerup',()=>{$('#graph-viewport').classList.remove('dragging');setTimeout(()=>drag=null,0);});
// Keep the same scene and zoom when the viewport expands or resizes.
let viewportSize=null;
new ResizeObserver(()=>{
  const box=$('#graph-viewport').getBoundingClientRect();
  if(!box.width||!box.height)return;
  if(current&&viewportSize){
    transform.x+=(box.width-viewportSize.width)/2;
    transform.y+=(box.height-viewportSize.height)/2;
    applyTransform();
  }
  viewportSize={width:box.width,height:box.height};
}).observe($('#graph-viewport'));
$('#copy-route').onclick=async()=>{if(!route)return;try{await navigator.clipboard.writeText(routeText());toast('攻略已复制');}catch{download('攻略.txt',routeText(),'text/plain');toast('剪贴板不可用，已下载攻略');}};
$('#svg-export').onclick=()=>{
  if(!current)return;
  const original=$('#graph-svg'),clone=original.cloneNode(true);
  clone.setAttribute('width',graphSize.w);clone.setAttribute('height',graphSize.h);
  clone.setAttribute('viewBox',`0 0 ${graphSize.w} ${graphSize.h}`);
  // Make theme and selection colors independent of the website's stylesheet.
  const sources=[original,...original.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
  sources.forEach((element,index)=>{
    const style=getComputedStyle(element);
    for(const property of ['fill','stroke','stroke-width','font-family','font-size','font-weight','paint-order','stroke-linejoin','opacity'])copies[index].style.setProperty(property,style.getPropertyValue(property));
  });
  clone.querySelector('#graph-content').removeAttribute('transform');
  const background=document.createElementNS('http://www.w3.org/2000/svg','rect');
  background.setAttribute('width',graphSize.w);background.setAttribute('height',graphSize.h);
  background.setAttribute('fill',getComputedStyle($('#graph-viewport')).backgroundColor);
  clone.prepend(background);download('剧情地图.svg',new XMLSerializer().serializeToString(clone),'image/svg+xml');
};
['#library-search','#author-filter','#tag-filter','#sort-select','#favorites-only'].forEach(s=>$(s).addEventListener(s==='#library-search'?'input':'change',renderLibrary));
$('#library-cards').onclick=async event=>{const button=event.target.closest('[data-action]'),card=event.target.closest('[data-id]');if(!button||!card)return;const id=card.dataset.id,g=library.find(g=>g.id===id);try{if(button.dataset.action==='open')await openGuide(id);if(button.dataset.action==='author')await openAuthor(String(g.author_id));if(button.dataset.action==='favorite')await api('/api/guides/'+id,'PATCH',{favorite:!g.favorite});if(button.dataset.action==='export')exportGuide(await api('/api/guides/'+id));if(button.dataset.action==='tags'){const tags=prompt('用逗号分隔分类标签，例如：悬疑, 待探索',g.tags.join(', '));if(tags!==null)await api('/api/guides/'+id,'PATCH',{tags:[...new Set(tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean))]});}if(button.dataset.action==='delete'&&confirm(`删除「${g.title}」的本机攻略？`)){await api('/api/guides/'+id,'DELETE');if(current?.id===id){current=null;route=null;$('#result').hidden=true;$('#empty-workspace').hidden=false;localStorage.removeItem('lastGuide');}}await refreshLibrary();}catch(e){toast(e.message);}};
$('#import-button').onclick=()=>$('#import-file').click();
$('#import-file').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>16*1024*1024)throw new Error('流程文件不能超过 16 MB');const graph=JSON.parse(await file.text());const r=await api('/api/import','POST',{graph});await openGuide(r.guide_id);toast('流程已导入并重新验证');}catch(e){toast('导入失败：'+e.message);}finally{event.target.value='';}};


function renderAuthorChips(){
  const markup=authors.map(a=>`<button data-author="${esc(a.id)}" class="author-chip ${activeAuthor?.id===a.id?'selected':''}"><span class="author-avatar">${esc([...a.name][0]||'UP')}</span><span>${esc(a.name)}<small>${a.videos} 部已解析作品</small></span><span>↗</span></button>`).join('');
  $('#author-chips').innerHTML=markup;$('#library-authors').innerHTML=markup;
  $('#author-empty').hidden=!!authors.length;
}
async function refreshAuthors(){authors=await api('/api/authors');renderAuthorChips();if(!activeAuthor&&authors.length)await openAuthor(authors[0].id);else if(activeAuthor&&authorCatalog&&!authorBusy){const id=activeAuthor.id,token=authorRequest;const catalog=await api('/api/authors/'+id+'/videos');if(token===authorRequest&&!authorBusy){authorCatalog=catalog;renderAuthorCatalog();}}}
async function openAuthor(id){
  if(authorBusy){toast('正在读取投稿，请稍候');return;}
  if(!authors.length)authors=await api('/api/authors');
  activeAuthor=authors.find(a=>a.id===String(id));if(!activeAuthor){toast('该攻略没有可用的 UP 主 UID');return;}
  const token=++authorRequest;authorCatalog=null;showPage('authors');renderAuthorChips();
  $('#author-catalog').hidden=false;$('#author-name').textContent=activeAuthor.name;$('#author-status').textContent='正在读取已保存的作品…';$('#author-video-cards').innerHTML='';$('#author-error').hidden=true;
  try{const catalog=await api('/api/authors/'+id+'/videos');if(token!==authorRequest)return;authorCatalog=catalog;renderAuthorCatalog();if(!catalog.cached_pages)await loadAuthorPage(false);}catch(e){if(token===authorRequest){$('#author-error').textContent=e.message;$('#author-error').hidden=false;}}
}
function renderAuthorCatalog(){
  if(!authorCatalog||!activeAuthor)return;const c=authorCatalog;
  $('#author-name').textContent=activeAuthor.name;
  $('#author-status').textContent=`${c.videos.length} 部已发现互动视频 · 已检查 ${c.scanned} ${c.total_submissions?' / '+c.total_submissions:''} 个投稿${c.fetched_at?' · 更新于 '+new Date(c.fetched_at).toLocaleString('zh-CN',{hour12:false}):' · 包含本机已解析作品'}`;
  $('#author-video-cards').innerHTML=c.videos.map((v,i)=>`<article class="author-video-card" data-bvid="${esc(v.bvid)}"><div class="video-art">${v.cover?`<img src="${esc(v.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span>⑂</span><small>INTERACTIVE STORY ${String(i+1).padStart(2,'0')}</small>`}<span class="video-state">${v.saved?'已在攻略库':'互动视频'}</span></div><div class="video-content"><h3>${esc(v.title)}</h3><p>${esc(v.bvid)}${v.published_at?' · '+new Date(v.published_at*1000).toLocaleDateString('zh-CN'):''}${v.duration?' · '+esc(v.duration):''}</p><div class="video-actions"><button class="primary" data-video-action="${v.saved?'open':'parse'}">${v.saved?'打开攻略':'解析这个视频'} →</button>${v.saved?'<button class="text-button" data-video-action="parse">重新解析</button>':''}<a class="text-button" href="https://www.bilibili.com/video/${esc(v.bvid)}/" target="_blank" rel="noreferrer">原视频 ↗</a></div></div></article>`).join('')||'<div class="catalog-empty"><h3>已检查的投稿中尚未发现互动视频</h3><p>较早的作品可能在后续页，继续读取投稿即可查找。</p></div>';
  $('#author-warnings').hidden=!c.warnings.length;$('#author-warnings').textContent=c.warnings.join(' ');
  $('#author-load-more').hidden=!c.has_more;$('#author-load-more').disabled=authorBusy;
  $('#author-load-more').textContent=authorBusy?'正在读取…':c.cached_pages?'继续读取较早投稿':'读取投稿列表';
  $('#author-refresh').disabled=authorBusy;
  $('#author-page-note').textContent=c.has_more?'按发布时间逐页读取，每次最多 30 个投稿；仅展示接口明确标记的互动视频。':'已检查完当前列表的全部投稿。';
  $('#author-video-cards').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;},{once:true}));
}
async function loadAuthorPage(refresh=false){
  if(!activeAuthor||authorBusy)return;authorBusy=true;$('#author-error').hidden=true;
  const token=authorRequest,id=activeAuthor.id;renderAuthorCatalog();
  try{const result=await api('/api/authors/'+id+'/videos','POST',{page:refresh?1:authorCatalog?.next_page||1,refresh,cookie:$('#author-cookie').value||$('#cookie').value});if(token===authorRequest){authorCatalog=result;renderAuthorCatalog();}}
  catch(e){if(token===authorRequest){$('#author-error').textContent=e.message+' 已保存的攻略和缓存作品仍可打开。';$('#author-error').hidden=false;}}
  finally{authorBusy=false;if(token===authorRequest)renderAuthorCatalog();}
}
[$('#author-chips'),$('#library-authors')].forEach(container=>container.onclick=event=>{const chip=event.target.closest('[data-author]');if(chip)openAuthor(chip.dataset.author).catch(e=>toast(e.message));});
$('#guide-author').onclick=()=>{if(current?.graph.metadata.author_id)openAuthor(String(current.graph.metadata.author_id)).catch(e=>toast(e.message));};
$('#author-load-more').onclick=()=>loadAuthorPage(false);$('#author-refresh').onclick=()=>loadAuthorPage(true);
$('#author-video-cards').onclick=async event=>{
  const button=event.target.closest('[data-video-action]'),card=event.target.closest('[data-bvid]');if(!button||!card)return;
  const video=authorCatalog?.videos.find(v=>v.bvid===card.dataset.bvid);if(!video)return;
  if(button.dataset.videoAction==='open'){try{await openGuide(video.guide_id);}catch(e){toast(e.message);}return;}
  if(job||authorBusy){toast('请等待当前读取完成');return;}
  showPage('explore');$('#video-url').value='https://www.bilibili.com/video/'+video.bvid+'/';
  if($('#author-cookie').value){$('#cookie').value=$('#author-cookie').value;$('#author-cookie').value='';}
  $('#parse-form').scrollIntoView({behavior:'smooth',block:'center'});$('#parse-form').requestSubmit();
};

// Progressive map navigation; every reduction is reversible.
$('#graph-svg').onclick=event=>{if(drag?.moved)return;const group=event.target.closest('[data-display]');if(group)navigateDisplay(group.dataset.display);};
$('#graph-svg').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){const group=event.target.closest('[data-display]');if(group){event.preventDefault();navigateDisplay(group.dataset.display);}}};
$('#node-list').onclick=event=>{const node=event.target.closest('[data-node]');if(node)locateNode(node.dataset.node);};
$('#node-detail').onclick=event=>{if(event.target.closest('[data-return-endings]')){showEndingNavigation();}const equivalent=event.target.closest('[data-equivalent]');if(equivalent){selectNode(equivalent.dataset.equivalent);$('#node-detail .equivalent-members').open=true;}const node=event.target.closest('[data-locate]');if(node)locateNode(node.dataset.locate);const cycle=event.target.closest('[data-cycle]');if(cycle){const members=current.graph.analysis.cycles[Number(cycle.dataset.cycle)];enterGroup({id:'cycle:'+cycle.dataset.cycle,kind:'cycle',title:'循环区域 '+(Number(cycle.dataset.cycle)+1),members});}};
$('#map-breadcrumb').onclick=event=>{const button=event.target.closest('[data-level]');if(!button)return;const level=Number(button.dataset.level);mapFocus=level<0?[]:mapFocus.slice(0,level+1);mapCenter=null;selected=null;$('#route-only').checked=false;showEndingNavigation();drawGraph(true);};
['#map-mode','#collapse-cycles','#collapse-chains','#merge-duplicates','#edge-labels','#route-only'].forEach(selector=>$(selector).onchange=()=>{if(selector==='#map-mode'){mapFocus=[];mapCenter=null;selected=null;showEndingNavigation();$('#route-only').checked=false;}drawGraph(selector!=='#edge-labels');if(selector==='#merge-duplicates'&&selected)selectNode(selected);});
$('#node-search').oninput=()=>{
  renderNodeList();const search=$('#node-search').value.trim().toLowerCase();$('#search-results').hidden=!search;
  const matches=current?.graph.nodes.filter(n=>(n.title+' '+(n.leaf?endingName(n):'')+' '+n.id).toLowerCase().includes(search))||[];
  $('#search-results').innerHTML=`<small>${matches.length} 个匹配片段 · 点击直接定位</small>`+matches.slice(0,12).map(n=>`<button data-locate="${esc(n.id)}"><span>${esc(n.title)}</span><small>${esc(n.id)}</small></button>`).join('')+(matches.length>12?'<small>更多结果见片段列表</small>':'');
};
$('#search-results').onclick=event=>{const node=event.target.closest('[data-locate]');if(node)locateNode(node.dataset.locate);};
$('#readable-button').onclick=readableGraph;
$('#minimap').onclick=event=>{event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect(),box=$('#graph-viewport').getBoundingClientRect();transform.x=box.width/2-(event.clientX-rect.left)/rect.width*graphSize.w*transform.k;transform.y=box.height/2-(event.clientY-rect.top)/rect.height*graphSize.h*transform.k;applyTransform();};
$('#minimap').onpointerdown=event=>event.stopPropagation();
function setMapFullscreen(expanded){
  const button=$('#fullscreen-button');
  $('.graph-card').classList.toggle('map-fullscreen',expanded);
  document.body.classList.toggle('map-expanded',expanded);
  button.textContent=expanded?'退出全屏 ×':'⛶';
  button.setAttribute('aria-label',expanded?'退出全屏地图':'全屏地图');
  button.setAttribute('aria-pressed',String(expanded));
  button.title=expanded?'退出全屏（Esc）':'全屏地图';
  $('.map-hint').textContent=expanded?'拖拽平移 · 滚轮 / 双指缩放 · Esc 退出':'拖拽平移 · Ctrl / ⌘ + 滚轮缩放';
}
$('#fullscreen-button').onclick=()=>setMapFullscreen(!$('.graph-card').classList.contains('map-fullscreen'));
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&$('.graph-card').classList.contains('map-fullscreen')&&!$('dialog[open]')){
    setMapFullscreen(false);$('#fullscreen-button').focus({preventScroll:true});queueNavigation();
  }
});
$('#clear-route').onclick=()=>{route=null;selected=null;mapFocus=[];mapCenter=null;$('#route-only').checked=false;$$('.ending').forEach(e=>e.classList.remove('selected'));$('#route-panel').hidden=true;showEndingNavigation();drawGraph(true);};
$('#route-prev').onclick=()=>{routeIndex--;updateRoutePosition();focusDisplay('route:'+routeIndex);};
$('#route-next').onclick=()=>{routeIndex++;updateRoutePosition();focusDisplay('route:'+routeIndex);};
$('#route-steps').onclick=event=>{const step=event.target.closest('[data-route-step]');if(!step||!route)return;routeIndex=Number(step.dataset.routeStep);$('#route-only').checked=true;drawGraph();updateRoutePosition();focusDisplay('route:'+routeIndex);$('#graph-viewport').scrollIntoView({behavior:'smooth',block:'center'});};
$('#route-steps').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.target.click();}};
// Two-finger pinch and one-finger pan without affecting ordinary page scrolling outside the map.
const pointers=new Map();let pinch=null;
$('#graph-viewport').addEventListener('pointerdown',event=>{if(event.target.closest('#minimap,#route-navigator'))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.size===2){drag=null;const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y)};}});
window.addEventListener('pointermove',event=>{if(!pointers.has(event.pointerId))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.size===2&&pinch){const [a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y),box=$('#graph-viewport').getBoundingClientRect();if(pinch.distance>0)zoom(distance/pinch.distance,(a.x+b.x)/2-box.left,(a.y+b.y)/2-box.top);pinch.distance=distance;}});
const releasePointer=event=>{pointers.delete(event.pointerId);pinch=null;if(!pointers.size)setTimeout(()=>drag=null,0);};
window.addEventListener('pointerup',releasePointer);window.addEventListener('pointercancel',releasePointer);

function renderComparison(){
  const available=sortedEndings().filter(e=>e.reachable);
  $('#compare-toggle').hidden=available.length<2;
  if(comparison)for(const r of [comparison.a,comparison.b])if(!available.some(e=>e.id===r.id))available.push(r);
  const options=available.map(e=>`<option value="${esc(e.id)}">${esc(endingName(e))}</option>`).join('');
  $('#compare-a').innerHTML=options;$('#compare-b').innerHTML=options;
  $('#comparison-panel').hidden=!comparison;
  if(!comparison)return;
  $('#compare-a').value=comparison.a.id;$('#compare-b').value=comparison.b.id;
  $('#comparison-summary').textContent=`两条路线前 ${comparison.prefix} 步一致；发现 ${comparison.decisions.length} 处同一问题的不同选择。${current.graph.analysis.complete?'':'当前解析为部分结果，以下只比较已验证路线。'}`;
  const title=id=>current.graph.nodes.find(n=>n.id===id)?.title||id;
  const stepText=(step,index,side)=>step?`<p class="compare-${side}"><b>路线 ${side.toUpperCase()} · 第 ${index+1} 步</b><br>${esc(title(step.source))}${step.automatic?'':`<br>选择「${esc(step.choice)}」`}</p>${step.condition?`<code>需要：${esc(human(step.condition))}</code>`:''}${step.action?`<code>更新：${esc(human(step.action))}</code>`:''}<small>${step.automatic?'跳转前':'选择前'}：${esc(valuesText(step.before)||'无变量')}<br>${step.automatic?'跳转后':'选择后'}：${esc(valuesText(step.after)||'无变量')}</small>`:'<p>该路线已结束</p>';
  const forkMarkup=comparison.decisions.map((d,index)=>`<article class="comparison-item"><h4>${index===0?'关键分岔':'后续分岔'} · ${esc(title(d.node))} <button class="text-button" data-locate="${esc(d.node)}">定位 ↗</button></h4><small>${d.automatic?'由条件决定的自动跳转':'同一问题的不同选项'}${d.variables.length?' · 条件涉及：'+esc(d.variables.map(v=>current.graph.variables.find(n=>n.id===v.id)?.name||v.id).join('、')):''}</small><div class="comparison-pair"><div>${stepText(comparison.a.steps[d.a],d.a,'a')}</div><div>${stepText(comparison.b.steps[d.b],d.b,'b')}</div></div></article>`).join('');
  const first=comparison.first;
  const firstMarkup=!comparison.decisions.length||comparison.decisions[0].a!==comparison.prefix||comparison.decisions[0].b!==comparison.prefix?`<article class="comparison-item"><h4>首次路线差异</h4><div class="comparison-pair"><div>${stepText(first.a,comparison.prefix,'a')}</div><div>${stepText(first.b,comparison.prefix,'b')}</div></div><small>路线在这里开始不同；可能涉及环内重复次数或之前累计的变量。</small></article>`:'';
  $('#comparison-results').innerHTML=firstMarkup+forkMarkup+(comparison.related.length?'<h4 class="comparison-section-title">条件相关的前期选择 · 依据表达式引用追溯</h4>'+comparison.related.map(d=>`<article class="comparison-item"><h4>${esc(title(d.node))} <button class="text-button" data-locate="${esc(d.node)}">定位 ↗</button></h4>${stepText(d.step,d.index,d.side)}</article>`).join(''):'');
}
function setComparison(a,b){
  const endings=current?.graph.analysis.endings||[];
  comparison=StoryCompare.compare(endings.find(e=>e.id===a),endings.find(e=>e.id===b));
  renderComparison();drawGraph();queueNavigation();
}
$('#compare-toggle').onclick=()=>{
  const endings=sortedEndings().filter(e=>e.reachable);if(endings.length<2)return;
  const a=route?.id||endings[0].id,b=endings.find(e=>e.id!==a).id;
  $('#route-only').checked=false;mapFocus=[];mapCenter=null;selected=null;
  setComparison(a,b);$('#comparison-panel').scrollIntoView({behavior:'smooth',block:'start'});
};
$('#compare-close').onclick=()=>{comparison=null;renderComparison();drawGraph();queueNavigation();};
['#compare-a','#compare-b'].forEach(selector=>$(selector).onchange=()=>{
  const a=$('#compare-a').value,b=$('#compare-b').value;
  if(a===b){toast('请选择两个不同结局');renderComparison();return;}setComparison(a,b);
});
$('#comparison-results').onclick=event=>{const node=event.target.closest('[data-locate]');if(node)locateNode(node.dataset.locate);};

// Shareable hash routes: history entries contain view state, never credentials.
let navigationQueued=false;
function captureNavigation(){
  const page=!$('#library-page').hidden?'library':!$('#authors-page').hidden?'authors':'explore';
  return {page,endingSort:$('#ending-sort').value,guide:current?.id||'',author:page==='authors'?activeAuthor?.id||'':'',mode:$('#map-mode').value,
    ending:route?.id||'',only:$('#route-only').checked,focus:mapFocus.map(g=>g.id),center:mapCenter||'',node:selected||'',
    panel:$('#node-detail').hidden?'endings':selected?'node':'group',view:$('#node-list').hidden?'graph':'list',
    loops:$('#collapse-cycles').checked,chains:$('#collapse-chains').checked,duplicates:$('#merge-duplicates').checked,labels:$('#edge-labels').checked,
    step:routeIndex,fullscreen:$('.graph-card').classList.contains('map-fullscreen'),compare:comparison?[comparison.a.id,comparison.b.id]:[]};
}
function navigationURL(state){
  const p=new URLSearchParams();
  for(const key of ['guide','author','ending','center','node'])if(state[key])p.set(key,state[key]);
  if(state.endingSort&&state.endingSort!=='category')p.set('endingSort',state.endingSort);
  if(state.mode!=='compact')p.set('mode',state.mode);
  if(state.fullscreen)p.set('fullscreen','1');if(state.only)p.set('only','1');if(state.focus.length)p.set('focus',JSON.stringify(state.focus));
  if(state.panel!=='endings')p.set('panel',state.panel);if(state.view!=='graph')p.set('view',state.view);
  if(!state.loops)p.set('loops','0');if(!state.chains)p.set('chains','0');if(state.duplicates===false)p.set('duplicates','0');if(state.labels)p.set('labels','1');
  if(state.ending&&state.step)p.set('step',String(state.step));if(state.compare.length)p.set('compare',JSON.stringify(state.compare));
  return '#/'+state.page+(p.size?'?'+p.toString():'');
}
function readNavigation(){
  const [path,query='']=location.hash.slice(1).split('?');if(!['/explore','/library','/authors'].includes(path))return null;
  const p=new URLSearchParams(query),array=key=>{try{const v=JSON.parse(p.get(key)||'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string').slice(0,30):[];}catch{return [];}};
  return {page:path.slice(1),endingSort:['category','name','name-desc','steps'].includes(p.get('endingSort'))?p.get('endingSort'):'category',guide:p.get('guide')||'',author:p.get('author')||'',mode:['overview','compact','full'].includes(p.get('mode'))?p.get('mode'):'compact',ending:p.get('ending')||'',only:p.get('only')==='1',focus:array('focus'),center:p.get('center')||'',node:p.get('node')||'',panel:p.get('panel')||'endings',view:p.get('view')==='list'?'list':'graph',loops:p.get('loops')!=='0',chains:p.get('chains')!=='0',duplicates:p.get('duplicates')!=='0',labels:p.get('labels')==='1',step:Math.max(0,Number(p.get('step'))||0),fullscreen:p.get('fullscreen')==='1',compare:array('compare')};
}
function queueNavigation(){
  if(!navigationReady||restoringNavigation||navigationQueued)return;navigationQueued=true;
  queueMicrotask(()=>{navigationQueued=false;if(restoringNavigation)return;const state=captureNavigation(),url=navigationURL(state);if(location.hash!==url)history.pushState(null,'',url);});
}
async function restoreNavigation(state){
  const version=++navigationVersion;restoringNavigation=true;
  try{
    if(state.guide&&state.guide!==current?.id){const record=await api('/api/guides/'+state.guide);if(version!==navigationVersion)return;await openGuide(state.guide,record);if(version!==navigationVersion)return;}
    if(!state.guide){current=null;route=null;comparison=null;selected=null;$('#result').hidden=true;$('#empty-workspace').hidden=false;}
    if(current){
      route=null;selected=null;comparison=null;mapFocus=[];mapCenter=null;routeIndex=0;
      $('#ending-sort').value=state.endingSort||'category';$('#map-mode').value=state.mode;$('#collapse-cycles').checked=state.loops;$('#collapse-chains').checked=state.chains;$('#merge-duplicates').checked=state.duplicates!==false;$('#edge-labels').checked=state.labels;
      $('#route-only').checked=false;renderResult();
      if(state.ending)selectEnding(state.ending);
      $('#route-only').checked=state.only;
      for(const id of state.focus){
        const cycle=id.match(/^cycle:(\d+)$/);let group=mapModel.chapters.get(id);
        if(cycle&&current.graph.analysis.cycles[Number(cycle[1])])group={id,kind:'cycle',title:'循环区域 '+(Number(cycle[1])+1),members:current.graph.analysis.cycles[Number(cycle[1])]};
        group??=StoryMap.build(mapModel,mapOptions()).nodes.find(g=>g.id===id);
        if(group&&group.kind!=='scene')mapFocus.push({...group,members:group.fullMembers||group.members});
      }
      mapCenter=mapModel.nodes.has(state.center)?state.center:null;
      if(state.compare.length===2)setComparison(...state.compare);
      selected=mapModel.nodes.has(state.node)?state.node:null;
      drawGraph(true);renderNodeList();
      if(state.panel==='node'&&mapModel.nodes.has(state.node))selectNode(state.node);else if(state.panel==='group'&&mapFocus.length)showGroupDetail(mapFocus.at(-1));else showEndingNavigation();
      routeIndex=state.step;if(route)updateRoutePosition();
      $$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));$('#node-list').hidden=state.view!=='list';$('#graph-viewport').hidden=state.view!=='graph';
    }
    setMapFullscreen(!!state.fullscreen&&!!current&&state.page==='explore');
    if(state.page==='authors'&&state.author)await openAuthor(state.author);else showPage(state.page);
    if(state.page==='explore'&&current)requestAnimationFrame(()=>{if(state.only&&route)focusDisplay('route:'+routeIndex);else if(selected)focusDisplay(mapView.membership.get(selected));});
  }catch(e){if(version===navigationVersion){toast('无法恢复该页面：'+e.message);showPage('library');}}
  finally{if(version===navigationVersion){restoringNavigation=false;}}
}
window.addEventListener('popstate',()=>restoreNavigation(readNavigation()||{...captureNavigation(),page:'explore'}));
window.addEventListener('hashchange',()=>{if(!restoringNavigation&&location.hash!==navigationURL(captureNavigation()))restoreNavigation(readNavigation()||{...captureNavigation(),page:'explore'});});
document.addEventListener('click',queueNavigation);document.addEventListener('change',queueNavigation);
(async()=>{
 try{await refreshLibrary();const state=readNavigation();if(state)await restoreNavigation(state);else{const id=localStorage.getItem('lastGuide');if(id&&library.some(g=>g.id===id))await openGuide(id);}
 navigationReady=true;history.replaceState(null,'',navigationURL(captureNavigation()));
 }catch(e){toast('无法连接服务：'+e.message);navigationReady=true;}
})();
