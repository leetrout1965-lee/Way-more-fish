/* Way More Fish — Satellite Water v3
   Fresh <= 12 hr
   Recent usable >12 and <=24 hr
   Stale >24 and <=48 hr: clearly labeled and NOT used as current water
   Older than 48 hr: hidden as a water-condition reading
*/
(function () {
  if (typeof L === 'undefined' || typeof map === 'undefined' || typeof spots === 'undefined') return;
  if (window.__wmfSatelliteWaterV3Loaded) return;
  window.__wmfSatelliteWaterV3Loaded = true;

  const FRESH_HOURS=12, USABLE_HOURS=24, STALE_MAX_HOURS=48;
  const satelliteWaterLayer=L.layerGroup();
  let loading=false,legend=null,button=null;

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
  function prototypeSpots(){
    return spots.filter(x=>x.area==='Big Lake / Calcasieu'||x.area==='West Cove');
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
        '<div style="margin-top:5px;color:#9fb0bf">Fresh ≤12 hr • recent usable ≤24 hr • stale 24–48 hr is not used in current scoring • older than 48 hr is unavailable.</div>';
      return d;
    };
    legend.addTo(map);
  }
  function hideLegend(){if(legend){map.removeControl(legend);legend=null;}}

  async function refresh(){
    if(loading)return;
    loading=true;
    satelliteWaterLayer.clearLayers();

    const pts=prototypeSpots();
    const samples=[];
    let freshCount=0,usableCount=0,staleCount=0,unavailableCount=0;

    await Promise.allSettled(pts.map(async function(p){
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

        samples.push({p,state,ageHours,sampleTime,sat});

        if(state==='fresh'||state==='usable'){
          const score=Math.round(Number(sat.score));
          if(!Number.isFinite(score))throw new Error('No satellite score');
          const b=bucket(score);
          if(state==='fresh')freshCount++;else usableCount++;

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
          return;
        }

        if(state==='stale'){
          staleCount++;
          const m=L.circleMarker([p.lat,p.lon],{
            radius:8,weight:2,color:'#d6dde3',fillColor:'#7f8c98',fillOpacity:.58
          });
          m.bindTooltip(p.name+': STALE • '+age,{direction:'top'});
          m.bindPopup(
            '<strong>'+p.name+'</strong><br>'+
            '<strong>STALE — not current water conditions</strong><br>'+
            'Newest usable pixel: '+sampleTime+' • '+age
          );
          satelliteWaterLayer.addLayer(m);
          return;
        }

        unavailableCount++;
      }catch(_){unavailableCount++;}
    }));

    samples.sort((a,b)=>a.ageHours-b.ageHours);
    const best=samples[0];

    if(!best){
      setTopBanner('Satellite Water unavailable — no recent usable image.',true);
    }else if(best.state==='fresh'){
      setTopBanner('Satellite Water • '+best.sampleTime+' • '+ageText(best.ageHours)+' • FRESH',false);
    }else if(best.state==='usable'){
      setTopBanner('Satellite Water • '+best.sampleTime+' • '+ageText(best.ageHours)+' • RECENT USABLE',false);
    }else if(best.state==='stale'){
      setTopBanner('Satellite Water • STALE • newest usable sample '+ageText(best.ageHours)+' • not used in current-water scoring',true);
    }else{
      setTopBanner('Satellite Water unavailable — newest image is too old for current fishing use.',true);
    }

    const status=document.getElementById('areaStatus');
    if(status){
      status.textContent='Satellite Water: '+freshCount+' fresh • '+usableCount+' recent usable • '+staleCount+' stale • '+unavailableCount+' unavailable.';
    }
    loading=false;
  }

  async function toggle(){
    if(map.hasLayer(satelliteWaterLayer)){
      map.removeLayer(satelliteWaterLayer);hideLegend();
      if(button){button.classList.remove('active');button.textContent='💧 Satellite Water';}
      return;
    }
    satelliteWaterLayer.addTo(map);showLegend();
    if(button){button.classList.add('active');button.textContent='✓ Satellite Water';}
    await refresh();
  }

  const SatelliteWaterControl=L.Control.extend({
    options:{position:'topleft'},
    onAdd:function(){
      const box=L.DomUtil.create('div','leaflet-bar');
      const btn=L.DomUtil.create('a','satwater-control',box);
      btn.href='#';btn.textContent='💧 Satellite Water';button=btn;
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.on(btn,'click',L.DomEvent.stop).on(btn,'click',toggle);
      return box;
    }
  });

  // Remove any old 2021-style banner text immediately. It will be replaced on first refresh.
  const old=document.getElementById('satelliteLatestTime');
  if(old && /2021|latest usable satellite water sample/i.test(old.textContent||'')){
    old.textContent='Satellite Water • checking newest usable image…';
  }

  map.addControl(new SatelliteWaterControl());
})();
