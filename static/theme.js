/* Apply before styles load so saved/system appearance is used on the first paint. */
(()=>{
  'use strict';
  const key='story-explorer-theme',system=window.matchMedia('(prefers-color-scheme: dark)');
  const valid=value=>['system','light','dark'].includes(value)?value:'system';
  let preference='system';
  try{preference=valid(localStorage.getItem(key));}catch{}
  function apply(){
    const theme=preference==='system'?(system.matches?'dark':'light'):preference;
    document.documentElement.dataset.theme=theme;
    document.documentElement.style.colorScheme=theme;
    document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#101624':'#edf1f7';
    const select=document.querySelector('#theme-select');if(select)select.value=preference;
  }
  apply();
  document.addEventListener('DOMContentLoaded',()=>{
    const select=document.querySelector('#theme-select');select.value=preference;
    select.addEventListener('change',()=>{
      preference=valid(select.value);
      try{localStorage.setItem(key,preference);}catch{}
      apply();
    });
  });
  system.addEventListener('change',()=>{if(preference==='system')apply();});
  window.addEventListener('storage',event=>{
    if(event.key===key||event.key===null){preference=valid(event.newValue);apply();}
  });
})();
