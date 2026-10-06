'use strict';
const endingTypes={HE:'HE · 好结局',BE:'BE · 坏结局',NE:'NE · 普通结局',TE:'TE · 真结局',GE:'GE · Good Ending',OE:'OE · 开放结局',SE:'SE · 隐藏结局'};
let endingJob=null,endingJobGuide=null;
function endingAnnotation(id){return current?.graph.ending_annotations?.[id]||{};}
function endingName(e){return e.groupName||endingAnnotation(e.id).name||e.title;}
function endingGroups(){
 const raw=current?.graph.analysis.endings||[],byId=new Map(raw.map(e=>[e.id,e]));
 return (current?.graph.ending_groups||raw.map(e=>({...e,member_ids:[e.id]}))).map(g=>({...byId.get(g.id),...g,groupName:g.name}));
}
function endingGroup(id){return endingGroups().find(g=>g.member_ids.includes(id));}
function renderEndingStats(){const groups=endingGroups();$('#ending-count').textContent=groups.length;$('#stat-endings').textContent=groups.filter(g=>g.reachable).length+' / '+groups.length;$('#stat-endings').title=`归并后 ${groups.length} 个结局，原始 ${current.graph.analysis.endings.length} 个结局节点`;}
function renderEndingRoutes(){
 const group=route&&endingGroup(route.id),ids=group?.member_ids||[];
 $('#ending-route-variants').hidden=ids.length<2;
 $('#ending-route-node').innerHTML=ids.map(id=>{const e=current.graph.analysis.endings.find(e=>e.id===id);return `<option value="${esc(id)}">节点 ${esc(id)} · ${e.reachable?e.length+' 步':'未验证可达'}${id===group.id?' · 最少步骤':''}</option>`;}).join('');
 if(route)$('#ending-route-node').value=route.id;
}

const endingNameOrder=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
function sortedEndings(endings=endingGroups()){
 const mode=$('#ending-sort').value;
 const rank=e=>{const kind=e.member_ids?e.category:endingAnnotation(e.id).category;return ['HE','GE'].includes(kind)?0:kind==='BE'?1:2;};
 const byName=(a,b)=>endingNameOrder.compare(endingName(a),endingName(b))||endingNameOrder.compare(a.id,b.id);
 return [...endings].sort((a,b)=>mode==='name'?byName(a,b):mode==='name-desc'?-byName(a,b):mode==='steps'?
   (Number(a.reachable===false)-Number(b.reachable===false)||(a.length??Infinity)-(b.length??Infinity)||byName(a,b)):
   rank(a)-rank(b)||byName(a,b));
}
function renderEndingLabelOptions(id=$('#ending-label-select').value){
 const endings=sortedEndings(current.graph.analysis.endings);
 $('#ending-label-select').innerHTML=endings.map(e=>`<option value="${esc(e.id)}">${esc(endingName(e))} · 节点 ${esc(e.id)}</option>`).join('');
 if(endings.some(e=>e.id===id))$('#ending-label-select').value=id;
}
function endingBadge(id,group=null){const a=group||endingAnnotation(id),label=endingTypes[a.category]||'分类未知';return `<span class="ending-badge ${a.category==='HE'?'he':a.category==='BE'?'be':''}">${esc(label)}</span><small class="ending-source">${a.category_conflict?'分类冲突 · 待核对':a.source==='title'?'标题标注':a.source==='manual'?'已人工核对':a.source==='import'?'导入标注 · 待核对':a.source==='ocr'?'片尾识别 · 待核对':'暂无明确标注'}</small>`;}
function renderEndingCards(){
 const a=current.graph.analysis;renderEndingStats();
 $('#endings').innerHTML=sortedEndings().map((e,i)=>`<button class="ending ${e.reachable?'':'unreachable'} ${e.member_ids.includes(route?.id)?'selected':''}" data-ending="${esc(e.id)}"><div class="ending-top"><span class="ending-index">${e.reachable?'⚑':'◇'} ENDING ${String(i+1).padStart(2,'0')}</span><span class="ending-length">${e.reachable?`${e.length} 步`:'未验证可达'}</span></div><strong>${esc(endingName(e))}</strong>${endingBadge(e.id,e)}${e.member_ids.length>1?`<small>已归并 ${e.member_ids.length} 个节点 · ${e.reachable_count} 条已验证路线</small>`:''}<small>${e.reachable?(a.complete?'查看最短攻略 →':'查看已验证路线 →'):(a.complete?'初始变量下不可达':'尚未找到已验证路线')}</small></button>`).join('')||'<p class="panel-description">未发现结局节点，请查看待验证事项。</p>';
}
function renderEndingEvidence(){
 const id=$('#ending-label-select').value,a=endingAnnotation(id),n=current.graph.nodes.find(n=>n.id===id);
 $('#ending-label-name').value=a.name||n?.title||'';$('#ending-label-category').value=a.category||'';
 $('#ending-label-reason').textContent=(a.reason||'')+(a.needs_review?'。识别结果待核对；没有明确 HE／BE 字样时只提取名称。':'');
 $('#ending-label-original').textContent='原始片段标题：'+(n?.title||'');
 $('#ending-label-text').textContent=a.text||'暂无片尾识别文字';
 $('#ending-label-frames').innerHTML=(a.frames||[]).map((f,i)=>`<a href="/api/guides/${encodeURIComponent(current.id)}/ending-evidence?node=${encodeURIComponent(id)}&frame=${i}" target="_blank" rel="noopener"><img alt="片尾证据画面" src="/api/guides/${encodeURIComponent(current.id)}/ending-evidence?node=${encodeURIComponent(id)}&frame=${i}"><span>约 ${f.time.toFixed(1)} 秒 · 点击查看原图</span></a>`).join('');
 $('#ending-recognize-one').disabled=!!endingJob||!n?.cid||current.graph.metadata.source==='demo';
 $('#ending-recognize-all').disabled=!!endingJob||current.graph.metadata.source==='demo';
 $('#ending-label-save').disabled=!!endingJob;
 $('#ending-label-progress').hidden=!endingJob;
}
async function refreshEndingLabels(guideId){
 if(current?.id!==guideId)return;
 const fresh=await api('/api/guides/'+guideId);
 if(current?.id!==guideId)return;
 current.graph.ending_annotations=fresh.graph.ending_annotations;current.graph.ending_groups=fresh.graph.ending_groups;current.graph.ending_recognition=fresh.graph.ending_recognition;renderEndingCards();renderEndingRoutes();
 if(route)$('#route-title').textContent=endingName(route);
 if($('#ending-label-dialog').open){renderEndingLabelOptions();renderEndingEvidence();}
 mapModel=StoryMap.create(current.graph);renderComparison();drawGraph();renderNodeList();if(selected&&!$('#node-detail').hidden)selectNode(selected);
}
async function recognizeEndings(single){
 if(endingJob)return;
 const guideId=current.id,cookie=$('#ending-ocr-cookie').value;$('#ending-ocr-cookie').value='';
 try{const response=await api('/api/guides/'+guideId+'/recognize-endings','POST',{cookie,...(single?{node_id:$('#ending-label-select').value}:{})});
 endingJob=response.job_id;endingJobGuide=guideId;$('#ending-label-error').textContent='';$('#ending-ocr-cancel').disabled=false;renderEndingEvidence();pollEndingJob();
 }catch(e){$('#ending-label-error').textContent=e.message;}
}
async function pollEndingJob(){
 if(!endingJob)return;
 try{const status=await api('/api/jobs/'+endingJob);
 $('#ending-ocr-status').textContent=`${status.phase} · ${status.done} / ${status.discovered} 个结局 · 识别到 ${status.recognized||0} 个名称`;
 if(status.status==='running'){setTimeout(pollEndingJob,1200);return;}
 const guideId=endingJobGuide;endingJob=null;endingJobGuide=null;
 await refreshEndingLabels(guideId);
 $('#ending-label-error').textContent=status.status==='error'?status.error:`已保存 ${status.recognized||0} 个识别名称。其余结局仍保留为未知，可核对截图后填写。`;
 $('#ending-label-progress').hidden=true;renderEndingEvidence();
 }catch(e){$('#ending-label-error').textContent='状态读取失败，任务可能仍在运行，将继续查询：'+e.message;setTimeout(pollEndingJob,4000);}
}
function openEndingLabels(id=route?.id||selected){
 if(!current)return;
 renderEndingLabelOptions(id);
 $('#ending-label-error').textContent='';renderEndingEvidence();$('#ending-label-dialog').showModal();
}
document.addEventListener('DOMContentLoaded',()=>{
 $('#ending-route-node').onchange=()=>selectEnding($('#ending-route-node').value);
 $('#ending-sort').onchange=()=>{if(!current)return;renderEndingCards();renderComparison();if($('#ending-label-dialog').open){renderEndingLabelOptions();renderEndingEvidence();}queueNavigation();};
 $('#ending-label-open').onclick=()=>openEndingLabels();
 document.addEventListener('click',e=>{const button=e.target.closest('[data-ending-review]');if(button)openEndingLabels(button.dataset.endingReview);});
 $('#ending-label-close').onclick=()=>{$('#ending-ocr-cookie').value='';$('#ending-label-dialog').close();};
 $('#ending-label-dialog').addEventListener('close',()=>{$('#ending-ocr-cookie').value='';});
 $('#ending-label-select').onchange=renderEndingEvidence;
 $('#ending-recognize-one').onclick=()=>recognizeEndings(true);
 $('#ending-recognize-all').onclick=()=>recognizeEndings(false);
 $('#ending-ocr-cancel').onclick=async()=>{try{await api('/api/jobs/'+endingJob+'/cancel','POST',{});$('#ending-ocr-cancel').disabled=true;$('#ending-ocr-status').textContent='将在当前片段识别结束后停止，已完成结果会保留';}catch(e){$('#ending-label-error').textContent=e.message;}};
 $('#ending-label-save').onclick=async()=>{try{const key=current.id;await api('/api/guides/'+key+'/ending-annotation','POST',{node_id:$('#ending-label-select').value,name:$('#ending-label-name').value,category:$('#ending-label-category').value});await refreshEndingLabels(key);$('#ending-label-error').textContent='已保存人工核对结果';}catch(e){$('#ending-label-error').textContent=e.message;}};
});
