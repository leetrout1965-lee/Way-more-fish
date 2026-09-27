function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613;
  const toRad = d => d * Math.PI / 180;
  const p1 = toRad(lat1), p2 = toRad(lat2);
  const dlat = toRad(lat2-lat1), dlon = toRad(lon2-lon1);
  const a = Math.sin(dlat/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dlon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
function label(score){return score>=78?"Clear / green":score>=60?"Fairly clear":score>=42?"Stained":score>=25?"Murky":"Very muddy";}
function turbidityScore(v){if(v<=5)return 90;if(v<=10)return 80;if(v<=20)return 65;if(v<=35)return 50;if(v<=60)return 35;return 20;}
function kdScore(v){if(v<=0.15)return 90;if(v<=0.30)return 75;if(v<=0.60)return 55;if(v<=1.0)return 35;return 20;}
function parseCSV(text){
  const lines=String(text||"").trim().split(/\r?\n/).filter(Boolean);
  if(lines.length<3)return [];
  const head=lines[0].split(",").map(x=>x.trim());
  return lines.slice(2).map(line=>{
    const cols=line.split(",").map(x=>x.trim());
    const o={};head.forEach((h,i)=>o[h]=cols[i]);return o;
  });
}
function satelliteFreshness(ageHours){
  if(!Number.isFinite(ageHours))return "unknown";
  if(ageHours<=36)return "fresh";
  if(ageHours<=72)return "usable";
  if(ageHours<=168)return "stale";
  return "expired";
}
async function fetchSatellite(lat,lon){
  const q=`kd_490[last-10:1:last][0][(${lat})][(${lon})]`;
  const url=`https://coastwatch.noaa.gov/erddap/griddap/noaacwNPPN20VIIRSkd490Daily.csv?${encodeURI(q)}`;
  const r=await fetch(url,{headers:{"User-Agent":"WayMoreFish/1.0","Accept":"text/csv"}});
  if(!r.ok)throw new Error(`CoastWatch HTTP ${r.status}`);
  const rows=parseCSV(await r.text());

  const times=rows.map(x=>Date.parse(x.time)).filter(Number.isFinite);
  const latestProductTime=times.length?new Date(Math.max(...times)).toISOString():null;

  const valid=rows.map(x=>({time:x.time,kd:Number(x.kd_490)}))
    .filter(x=>Number.isFinite(x.kd)&&x.kd>0)
    .sort((a,b)=>Date.parse(b.time)-Date.parse(a.time));

  if(!valid.length)throw new Error("No usable Kd490 value");

  const x=valid[0];
  const ageHours=(Date.now()-Date.parse(x.time))/3600000;

  return {
    kd:x.kd,
    time:x.time,
    ageHours,
    score:kdScore(x.kd),
    freshness:satelliteFreshness(ageHours),
    latestProductTime
  };
}
async function fetchUSGSTurbidity(lat,lon){
  const pad=0.55;
  const bbox=[lon-pad,lat-pad,lon+pad,lat+pad].join(",");
  const url=`https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bbox}&parameterCd=63680,00076&siteStatus=all&period=P2D`;
  const r=await fetch(url,{headers:{"User-Agent":"WayMoreFish/1.0","Accept":"application/json"}});
  if(!r.ok)throw new Error(`USGS HTTP ${r.status}`);
  const j=await r.json(),series=((j.value||{}).timeSeries)||[],cand=[];
  for(const ts of series){
    const info=ts.sourceInfo||{},geo=info.geoLocation&&info.geoLocation.geogLocation||{};
    const slat=Number(geo.latitude),slon=Number(geo.longitude);
    if(!Number.isFinite(slat)||!Number.isFinite(slon))continue;
    const vals=ts.values&&ts.values[0]&&ts.values[0].value||[];
    if(!vals.length)continue;
    const latest=vals[vals.length-1],v=Number(latest.value),t=latest.dateTime;
    if(!Number.isFinite(v)||v<0)continue;
    const ageHours=(Date.now()-Date.parse(t))/3600000,dist=haversineMiles(lat,lon,slat,slon);
    if(ageHours<=48&&dist<=45)cand.push({v,t,ageHours,dist,site:info.siteName||"USGS station",score:turbidityScore(v)});
  }
  cand.sort((a,b)=>a.dist-b.dist||a.ageHours-b.ageHours);
  if(!cand.length)throw new Error("No recent nearby USGS turbidity station");
  return cand[0];
}
exports.handler=async function(event){
  const lat=Number((event.queryStringParameters||{}).lat),lon=Number((event.queryStringParameters||{}).lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<20||lat>35||lon<-100||lon>-80){
    return {statusCode:400,headers:{"content-type":"application/json"},body:JSON.stringify({error:"Valid Gulf-region lat/lon required"})};
  }

  let usgs=null,sat=null,errors=[];
  try{usgs=await fetchUSGSTurbidity(lat,lon);}catch(e){errors.push(`USGS: ${e.message}`);}
  try{sat=await fetchSatellite(lat,lon);}catch(e){errors.push(`NOAA satellite: ${e.message}`);}

  const satCurrent=sat&&(sat.freshness==="fresh"||sat.freshness==="usable");

  if(!usgs&&!sat){
    return {statusCode:404,headers:{"content-type":"application/json","cache-control":"public, max-age=900"},body:JSON.stringify({error:"No direct clarity measurement available",details:errors.join("; ")})};
  }

  let score=null,source="unavailable",details="",ageHours=null;

  if(usgs&&satCurrent){
    const uw=usgs.dist<=20?0.65:0.55,sw=1-uw;
    score=(usgs.score*uw+sat.score*sw)/(uw+sw);
    source="USGS turbidity + recent NOAA VIIRS Kd490";
    details=`USGS ${usgs.v.toFixed(1)} FNU, ${usgs.dist.toFixed(0)} mi away • VIIRS ${sat.freshness}`;
    ageHours=Math.min(usgs.ageHours,sat.ageHours);
  }else if(usgs){
    score=usgs.score;
    source="USGS turbidity";
    details=`${usgs.v.toFixed(1)} FNU at ${usgs.site} • ${usgs.dist.toFixed(0)} mi away`;
    if(sat&&sat.freshness==="stale")details+=` • satellite ${Math.round(sat.ageHours/24)} days old and NOT used`;
    ageHours=usgs.ageHours;
  }else if(satCurrent){
    score=sat.score;
    source="recent NOAA VIIRS Kd490 satellite";
    details=`Kd490 ${sat.kd.toFixed(2)} m⁻¹ • ${Math.round(sat.ageHours)} hr old • ${sat.freshness}`;
    ageHours=sat.ageHours;
  }else{
    return {
      statusCode:200,
      headers:{"content-type":"application/json","cache-control":"public, max-age=1800, s-maxage=1800"},
      body:JSON.stringify({
        score:null,
        label:"Current satellite water unavailable",
        source:"stale NOAA VIIRS Kd490 satellite",
        details:`Newest usable satellite pixel is ${Math.round(sat.ageHours/24)} days old and is not used as a current-water signal`,
        ageHours:sat.ageHours,
        usgs:null,
        satellite:sat,
        heuristic:true,
        currentWaterUsable:false
      })
    };
  }

  score=clamp(Math.round(score),0,100);
  return {
    statusCode:200,
    headers:{"content-type":"application/json","cache-control":"public, max-age=1800, s-maxage=1800"},
    body:JSON.stringify({
      score,label:label(score),source,details,ageHours,usgs,satellite:sat,heuristic:true,currentWaterUsable:true
    })
  };
};
