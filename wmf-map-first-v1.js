/* Way More Fish — map-first app layout v1
   Design goal: map first, answers next, explanation second.
*/
(function () {
  if (window.__wmfMapFirstV1Loaded) return;
  window.__wmfMapFirstV1Loaded = true;

  const css = document.createElement('style');
  css.textContent = `
    :root{--wmf-nav-h:68px}
    body{padding-bottom:calc(var(--wmf-nav-h) + env(safe-area-inset-bottom,0px));}
    header{padding:12px 14px 10px!important;}
    header h1{font-size:24px!important;margin:0 0 2px!important;}
    header .sub{font-size:12px!important;opacity:.8}
    #map{height:62vh!important;min-height:430px!important;max-height:760px!important;border-radius:0!important;}
    #spotQuickSheet{z-index:1200!important;}
    .wmf-map-shell{position:relative;}
    .wmf-bottom-nav{
      position:fixed;left:0;right:0;bottom:0;z-index:3000;
      min-height:var(--wmf-nav-h);padding:7px 8px calc(7px + env(safe-area-inset-bottom,0px));
      background:rgba(10,24,35,.97);backdrop-filter:blur(14px);
      border-top:1px solid #38566d;display:grid;grid-template-columns:repeat(5,1fr);gap:4px;
    }
    .wmf-bottom-nav button{
      appearance:none;border:0;background:transparent;color:#a9bac8;
      padding:5px 2px;font:600 11px/1.05 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      border-radius:10px;min-width:0;
    }
    .wmf-bottom-nav button strong{display:block;color:#eef6fb;font-size:18px;line-height:20px;margin-bottom:2px}
    .wmf-bottom-nav button:active,.wmf-bottom-nav button.active{background:#15374a;color:#fff}
    .wmf-map-callout{
      position:absolute;left:12px;right:12px;bottom:12px;z-index:700;
      pointer-events:none;display:flex;justify-content:center;
    }
    .wmf-map-callout span{
      background:rgba(9,24,35,.92);border:1px solid #38566d;color:#dfeaf1;
      border-radius:999px;padding:7px 12px;font-size:12px;box-shadow:0 4px 18px #0007;
    }
    .wmf-answer-band{margin-top:12px!important;}
    .wmf-answer-band .card{border-color:#37627a;}
    .wmf-answer-band h3{font-size:22px!important;margin-bottom:8px!important;}
    .wmf-section-label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#78bad8;font-weight:800;margin:18px 0 8px;}
    @media (max-width:700px){
      #map{height:58vh!important;min-height:390px!important;}
      header h1{font-size:22px!important;}
    }
  `;
  document.head.appendChild(css);

  function sectionByHeading(text){
    return Array.from(document.querySelectorAll('section.card')).find(function(s){
      const h=s.querySelector('h3');
      return h && h.textContent.trim()===text;
    })||null;
  }

  function moveAfter(node, ref){
    if(node&&ref&&ref.parentNode) ref.parentNode.insertBefore(node,ref.nextSibling);
  }

  function compactCopy(){
    const live=sectionByHeading('Live conditions');
    if(live) live.remove();

    const now=sectionByHeading('Where Should I Fish Right Now?');
    if(now){
      const expl=now.querySelector('.small.muted');
      if(expl) expl.textContent='Finds the strongest fishing conditions across Louisiana right now.';
    }

    const cca=sectionByHeading('CCA Artificial Reefs');
    if(cca){
      const muted=cca.querySelectorAll('.small.muted');
      if(muted[0]) muted[0].textContent='Gold dots mark verified published CCA reef locations. Tap a reef for coordinates and details.';
      for(let i=1;i<muted.length;i++) muted[i].style.display='none';
    }
  }

  function mapFirstStructure(){
    const mapEl=document.getElementById('map');
    if(!mapEl||document.querySelector('.wmf-map-shell')) return;

    const shell=document.createElement('div');
    shell.className='wmf-map-shell';
    mapEl.parentNode.insertBefore(shell,mapEl);
    shell.appendChild(mapEl);

    const callout=document.createElement('div');
    callout.className='wmf-map-callout';
    callout.innerHTML='<span>Tap a spot for score, bite window and game plan</span>';
    shell.appendChild(callout);

    const wrap=document.querySelector('.wrap');
    const grid=wrap&&wrap.querySelector('.grid');
    if(!grid) return;

    const now=sectionByHeading('Where Should I Fish Right Now?');
    const near=sectionByHeading('Best Fishing Spot Near Me');
    const bite=sectionByHeading('Best Upcoming Window');
    const conditions=[
      sectionByHeading('Weather'),
      sectionByHeading('Tide'),
      sectionByHeading('Water conditions'),
      sectionByHeading('What you see on the water')
    ].filter(Boolean);
    const plan=[sectionByHeading('What to throw now'),sectionByHeading('Depth & structure')].filter(Boolean);
    const decisions=[
      sectionByHeading('Compare spots'),
      sectionByHeading("Tomorrow's Top 3 Fishing Spots"),
      sectionByHeading('Cleanest Fishable Water'),
      sectionByHeading('Fishing Opportunity Calendar')
    ].filter(Boolean);
    const advanced=[
      sectionByHeading('Recent Conditions Memory'),
      sectionByHeading('Recovery Outlook'),
      sectionByHeading('Observed vs predicted water'),
      sectionByHeading('Data quality'),
      sectionByHeading('Source freshness'),
      sectionByHeading('One-tap fishing report'),
      sectionByHeading('Trip journal')
    ].filter(Boolean);

    const regs=sectionByHeading('Louisiana regulations');
    const cca=sectionByHeading('CCA Artificial Reefs');

    [now,near,bite].filter(Boolean).forEach(x=>grid.appendChild(x));
    if(now) now.classList.add('wmf-answer-band');
    conditions.forEach(x=>grid.appendChild(x));
    plan.forEach(x=>grid.appendChild(x));
    decisions.forEach(x=>grid.appendChild(x));
    if(regs) grid.appendChild(regs);
    if(cca) grid.appendChild(cca);
    advanced.forEach(x=>grid.appendChild(x));
  }

  function scrollToHeading(text){
    const s=sectionByHeading(text);
    if(s&&s.scrollIntoView) s.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function installBottomNav(){
    if(document.querySelector('.wmf-bottom-nav')) return;
    const nav=document.createElement('nav');
    nav.className='wmf-bottom-nav';
    nav.setAttribute('aria-label','Way More Fish navigation');
    nav.innerHTML=`
      <button type="button" data-go="now"><strong>◎</strong>Now</button>
      <button type="button" data-go="areas"><strong>⌖</strong>Areas</button>
      <button type="button" data-go="compare"><strong>⇄</strong>Compare</button>
      <button type="button" data-go="tomorrow"><strong>→</strong>Tomorrow</button>
      <button type="button" data-go="journal"><strong>＋</strong>Journal</button>
    `;
    document.body.appendChild(nav);

    nav.addEventListener('click',function(e){
      const b=e.target.closest('button');
      if(!b) return;
      nav.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      const go=b.dataset.go;
      if(go==='now') scrollToHeading('Where Should I Fish Right Now?');
      else if(go==='areas'){
        const a=document.getElementById('areaPicker');
        if(a&&a.scrollIntoView){a.scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>a.focus(),350);}
      }
      else if(go==='compare') scrollToHeading('Compare spots');
      else if(go==='tomorrow') scrollToHeading("Tomorrow's Top 3 Fishing Spots");
      else if(go==='journal') scrollToHeading('Trip journal');
    });
  }

  function simplifyMapIntro(){
    const mapEl=document.getElementById('map');
    if(!mapEl) return;
    const prev=mapEl.previousElementSibling;
    if(prev && prev.querySelector && prev.querySelector('.small.muted')){
      const t=prev.querySelector('.small.muted');
      t.innerHTML='<strong>Map:</strong> Satellite or NOAA Nautical Chart • Gold dots = CCA reefs • Satellite Water = recent satellite-derived water signal.';
    }
  }

  setTimeout(function(){
    compactCopy();
    simplifyMapIntro();
    mapFirstStructure();
    installBottomNav();
    try{ if(typeof map!=='undefined') setTimeout(()=>map.invalidateSize(),120); }catch(_){}
  },0);
})();
