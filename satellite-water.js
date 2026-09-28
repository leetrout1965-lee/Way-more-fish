/* Way More Fish — Satellite Water v4
   Supports every listed fishing area and every spot.
   To stay fast and avoid hammering NOAA, it loads satellite samples only for
   the currently selected area. Change area and the overlay refreshes there.
   Fresh <=12 hr • recent usable <=24 hr • stale 24–48 hr • >48 hr unavailable.
*/
(function () {
  if (typeof L === 'undefined' || typeof map === 'undefined' || typeof spots === 'undefined') return;
  if (window.__wmfSatelliteWaterV4Loaded) return;
  window.__wmfSatelliteWaterV4Loaded = true;

  const FRESH_HOURS=12, USABLE_HOURS=24, STALE_MAX_HOURS=48;
  const satelliteWaterLayer=L.layerGroup();
  let loading=false,legend=null,button=null,lastArea='';

  function bucket(score){
    if(score>=75)return{label:'Relatively clearer',fill:'#36c275'};
    if(score>=55)return{label:'Mixed / moderate',fill:'#e5b84b'};
    return{label:'Relatively murkier',fill:'#a66a3f'};
  }
  function ageText(hours){
    if(!Number.isFinite(hours))return'age unavailable';
    if(hours<24)return Math.max(1,Math.round(hours))+' hr old';
    return (hours/24).toFixed(1)+' days old';
  }
  function freshness(hours){
    if(!Number.isFinite(hours))return'unknown';
    if(hours<=FRESH_HOURS)return'fresh';
    if(hours<=USABLE_HOURS)return'usable';
    if(hours<=STALE_MAX_HOURS)return'stale';
    return'expired';
  }
  function freshnessLabel(state){
    if(state==='fresh')return'FRESH';
    if(state==='usable')return'RECENT USABLE';
    if(state==='stale')return'STALE — not current water conditions';
    return'UNAVAILABLE';
  }

  function selectedAreaName(){
    try {
      const el=document.getElementById('areaPicker');
      return el ? el.value : '';
    } catch(_) { return ''; }
  }

  function areaSpots(area){
    return spots.filter(x=>x.area===area);
  }

  function setTopBanner(text,bad){
    let box=document.getElementById('satelliteLatestTime');
    if(!box){
      box=document.createElement('div');
      box.id='satelliteLatestTime';
      box.className='small muted';
      box.style.padding='6px 12px';
      box.style.background='#0f1f2d';
      box.style.borderBottom='1px solid #284153';
      const mapEl=document.getElementById('map');
      if(mapEl&&mapEl.parentNode)mapEl.parentNode.insertBefore(box,mapEl);
    }
    box.textContent=text;
    box.style.color=bad?'#ffcc80':'';
    box.style.fontWeight=bad?'700':'';
  }

  function showLegend(){
    if(legend)return;
    legend=L.control({position:'bottomleft'});
    legend.onAdd=function(){
      const d=L.DomUtil.create('div','satwater-legend');
      d.innerHTML=
        '<strong>Satellite Water</strong>'+
        '<div><span class="satwater-dot" style="background:#36c275"></span>Relatively clearer</div>'+
        '<div><span class="satwater-dot" style="background:#e5b84b"></span>Mixed / moderate</div>'+
        '<div><span class="satwater-dot" style="background:#a66a3f"></span>Relatively murkier</div>'+
        '<div><span class="satwater-dot" style="background:#7f8c98"></span>Stale</div>'+
        '<div style="margin-top:5px;color:#9fb0bf">Fresh ≤12 hr • usable ≤24 hr • stale 24–48 hr is not used in current scoring • older than 48 hr unavailable.</div>';
      return d;
    };
    legend.addTo(map);
  }

  function hideLegend(){
    if(legend){map.removeControl(legend);legend=null;}
  }

  function addUnavailableMarker(p,reason){
    const m=L.circleMarker([p.lat,p.lon],{
      radius:6,weight:1,color:'#aeb8c1',fillColor:'#667784',fillOpacity:.35
    });
    m.bindTooltip(p.name+': satellite unavailable',{direction:'top'});
    m.bindPopup(
      '<strong>'+p.name+'</strong><br>'+
      'No recent usable Satellite Water sample.<br>'+
      '<span style="font-size:11px">'+(reason||'Clouds, missing pixels, or an image older than 48 hours may be the cause.')+'</span>'
    );
    satelliteWaterLayer.addLayer(m);
  }

  async function loadSpot(p){
    try{
      const r=await fetch('/.netlify/functions/water-clarity?lat='+p.lat+'&lon='+p.lon,{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const j=await r.json();
      const sat=j&&j.satellite;
      if(!sat||!Number.isFinite(Number(sat.ageHours)))throw new Error('No satellite sample');

      const ageHours=Number(sat.ageHours);
      const state=sat.freshness||freshness(ageHours);
      const age=ageText(ageHours);
      const sampleTime=sat.time?new Date(sat.time).toLocaleString([],{
        month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'
      }):'time unavailable';

      if(state==='fresh'||state==='usable'){
        const score=Math.round(Number(sat.score));
        if(!Number.isFinite(score))throw new Error('No satellite score');
        const b=bucket(score);
        const m=L.circleMarker([p.lat,p.lon],{
          radius:10,weight:2,color:'#eef6fb',fillColor:b.fill,fillOpacity:.78
        });
        m.bindTooltip(p.name+': '+b.label+' • '+age,{direction:'top'});
        m.bindPopup(
          '<strong>'+p.name+'</strong><br>'+
          '<strong>'+b.label+'</strong> • '+score+'/100<br>'+
          '<strong>'+freshnessLabel(state)+'</strong><br>'+
          'Sample: '+sampleTime+' • '+age+'<br>'+
          '<span style="font-size:11px">NOAA CoastWatch VIIRS near-real-time Kd490. Satellite-derived water signal, not a live camera.</span>'
        );
        satelliteWaterLayer.addLayer(m);
        return {spot:p,state,ageHours,sampleTime};
      }

      if(state==='stale'){
        const m=L.circleMarker([p.lat,p.lon],{
          radius:8,weight:2,color:'#d6dde3',fillColor:'#7f8c98',fillOpacity:.58
        });
        m.bindTooltip(p.name+': STALE • '+age,{direction:'top'});
        m.bindPopup(
          '<strong>'+p.name+'</strong><br>'+
          '<strong>STALE — not current water conditions</strong><br>'+
          'Newest usable pixel: '+sampleTime+' • '+age+'<br>'+
          '<span style="font-size:11px">Shown only for context and not used in current-water scoring.</span>'
        );
        satelliteWaterLayer.addLayer(m);
        return {spot:p,state,ageHours,sampleTime};
      }

      addUnavailableMarker(p,'Newest satellite pixel is too old for current fishing use.');
      return {spot:p,state:'expired',ageHours,sampleTime};
    }catch(e){
      addUnavailableMarker(p,'No recent usable VIIRS pixel was returned for this spot.');
      return {spot:p,state:'unavailable',ageHours:Infinity,sampleTime:null};
    }
  }

  async function refreshArea(forceArea){
    if(loading)return;
    const area=forceArea||selectedAreaName();

    satelliteWaterLayer.clearLayers();
    lastArea=area||'';

    if(!area){
      setTopBanner('Satellite Water — choose a fishing area to load every spot in that area.',false);
      const status=document.getElementById('areaStatus');
      if(status)status.textContent='Choose an area, then Satellite Water will check every listed spot in that area.';
      return;
    }

    const pts=areaSpots(area);
    if(!pts.length){
      setTopBanner('Satellite Water unavailable — no listed spots in '+area+'.',true);
      return;
    }

    loading=true;
    setTopBanner('Satellite Water • checking '+pts.length+' spots in '+area+'…',false);

    // Keep concurrency modest so the app stays responsive and NOAA is not flooded.
    const queue=pts.slice();
    const results=[];
    let completed=0;

    async function worker(){
      while(queue.length){
        const p=queue.shift();
        results.push(await loadSpot(p));
        completed++;
        const status=document.getElementById('areaStatus');
        if(status)status.textContent='Satellite Water: '+completed+'/'+pts.length+' spots checked in '+area+'…';
      }
    }

    await Promise.all([worker(),worker(),worker(),worker()]);

    const fresh=results.filter(x=>x.state==='fresh').length;
    const usable=results.filter(x=>x.state==='usable').length;
    const stale=results.filter(x=>x.state==='stale').length;
    const unavailable=results.length-fresh-usable-stale;

    const valid=results.filter(x=>Number.isFinite(x.ageHours)).sort((a,b)=>a.ageHours-b.ageHours);
    const best=valid[0];

    if(!best){
      setTopBanner('Satellite Water • '+area+' • unavailable — no recent usable image.',true);
    }else if(best.state==='fresh'){
      setTopBanner('Satellite Water • '+area+' • '+best.sampleTime+' • '+ageText(best.ageHours)+' • FRESH',false);
    }else if(best.state==='usable'){
      setTopBanner('Satellite Water • '+area+' • '+best.sampleTime+' • '+ageText(best.ageHours)+' • RECENT USABLE',false);
    }else if(best.state==='stale'){
      setTopBanner('Satellite Water • '+area+' • STALE • newest sample '+ageText(best.ageHours)+' • not used in current-water scoring',true);
    }else{
      setTopBanner('Satellite Water • '+area+' • unavailable — newest image is too old for current fishing use.',true);
    }

    const status=document.getElementById('areaStatus');
    if(status){
      status.textContent='Satellite Water • '+area+': '+fresh+' fresh • '+usable+' recent usable • '+stale+' stale • '+unavailable+' unavailable.';
    }

    loading=false;
  }

  async function toggle(){
    if(map.hasLayer(satelliteWaterLayer)){
      map.removeLayer(satelliteWaterLayer);
      hideLegend();
      if(button){button.classList.remove('active');button.textContent='💧 Satellite Water';}
      return;
    }

    satelliteWaterLayer.addTo(map);
    showLegend();
    if(button){button.classList.add('active');button.textContent='✓ Satellite Water';}
    await refreshArea();
  }

  const SatelliteWaterControl=L.Control.extend({
    options:{position:'topleft'},
    onAdd:function(){
      const box=L.DomUtil.create('div','leaflet-bar');
      const btn=L.DomUtil.create('a','satwater-control',box);
      btn.href='#';
      btn.textContent='💧 Satellite Water';
      btn.title='Show satellite-derived water conditions for every spot in the selected area';
      button=btn;
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.on(btn,'click',L.DomEvent.stop).on(btn,'click',toggle);
      return box;
    }
  });

  map.addControl(new SatelliteWaterControl());

  // When the fisherman changes areas, automatically refresh the Satellite Water overlay there.
  const areaEl=document.getElementById('areaPicker');
  if(areaEl){
    areaEl.addEventListener('change',function(){
      if(map.hasLayer(satelliteWaterLayer)){
        setTimeout(function(){refreshArea(areaEl.value);},150);
      }
    });
  }

  // Expose a small helper for future ranking/game-plan features.
  window.refreshSatelliteWaterArea=refreshArea;
})();
