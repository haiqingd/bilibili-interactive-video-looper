/* Compare verified stateful paths, preserving repeated questions and variable values. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.StoryCompare=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 const question=s=>s.source+':'+(String(s.key).match(/:(\d+):\d+$/)?.[1]||'0');
 const values=v=>JSON.stringify(Object.entries(v||{}).sort(([a],[b])=>a.localeCompare(b)));
 const same=(a,b)=>a.key===b.key&&values(a.before)===values(b.before)&&values(a.after)===values(b.after);
 const references=text=>new Set(String(text||'').match(/\$[\w]+/g)||[]);
 function compare(a,b){
  if(!a?.reachable||!b?.reachable||a.id===b.id)return null;
  const x=a.steps,y=b.steps;let prefix=0;
  while(prefix<Math.min(x.length,y.length)&&same(x[prefix],y[prefix]))prefix++;
  // LCS aligns the same question even when a score loop repeats a scene.
  const dp=Array.from({length:x.length+1},()=>new Uint16Array(y.length+1));
  for(let i=x.length-1;i>=prefix;i--)for(let j=y.length-1;j>=prefix;j--)dp[i][j]=question(x[i])===question(y[j])?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
  const decisions=[];let i=prefix,j=prefix;
  while(i<x.length&&j<y.length){
   if(question(x[i])===question(y[j])){
    if(x[i].key!==y[j].key){const vars=new Set([...references(x[i].condition),...references(y[j].condition)]);decisions.push({node:x[i].source,a:i,b:j,automatic:x[i].automatic&&y[j].automatic,variables:[...vars].map(id=>({id,a:x[i].before?.[id],b:y[j].before?.[id]}))});}
    i++;j++;
   }else if(dp[i+1][j]>=dp[i][j+1])i++;else j++;
  }
  // Trace expression references backwards from differing conditional choices.
  // These are dependencies, not a proof of unique/minimal causal intervention.
  const related=[];
  for(const side of ['a','b']){
   const steps=side==='a'?x:y;const needed=new Set();
   const last=decisions.length?Math.max(...decisions.map(d=>d[side])):steps.length-1;
   for(let k=last;k>=0;k--){
    const step=steps[k];if(decisions.some(d=>d[side]===k))references(step.condition).forEach(v=>needed.add(v));
    let touched=false;
    for(const statement of String(step.action||'').split(';').reverse()){
     const match=statement.match(/^\s*(\$\w+)\s*(\+=|-=|\*=|\/=|%=|=(?!=))(.*)$/);if(!match||!needed.has(match[1]))continue;
     if(step.before?.[match[1]]!==step.after?.[match[1]])touched=true;
     if(match[2]==='=')needed.delete(match[1]);references(match[3]).forEach(v=>needed.add(v));
    }
    if(touched)related.push({side,index:k,node:step.source,step});
   }
  }
  related.sort((a,b)=>a.index-b.index||a.side.localeCompare(b.side));
  const ids=new Set(decisions.map(d=>d.node));related.forEach(d=>ids.add(d.node));
  if(prefix<x.length)ids.add(x[prefix].source);if(prefix<y.length)ids.add(y[prefix].source);
  return {a,b,prefix,decisions,related,keyNodes:[...ids],first:{a:x[prefix]||null,b:y[prefix]||null}};
 }
 return {compare};
});
