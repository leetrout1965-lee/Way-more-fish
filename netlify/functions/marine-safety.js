/* Way More Fish — combined marine safety check
   One call answers "is anything official telling boaters to stay off the water here?"
   - National Hurricane Center: any active tropical cyclone in the Gulf.
   - NWS alerts for the spot itself (land/county zones: wind advisories, storms, etc).
   - NWS alerts for the marine zone(s) covering the spot. Many inshore spots (Prien
     Lake, interior Vermilion Bay, Dularge marsh lakes) sit outside every marine zone,
     so a point lookup alone misses Small Craft Advisories. For those spots we use
     the nearest marine zone.
   - The marine zone forecast text (winds, waves/chop) for the closest zone.
   Any required source failing returns 502, which the page shows as
   "safety status unavailable" (fail closed). Only the wave forecast is optional.
*/
const ZONE_DATA = require("../marine-zones.json");

const HEADERS = {"User-Agent": "WayMoreFish/1.0 (Louisiana coastal fishing conditions)", "Accept": "application/geo+json, application/json"};
const DANGEROUS = /hurricane|tropical storm|storm surge|gale|storm warning|small craft|hazardous seas|high surf|rip current|marine weather|special marine|waterspout|wind advisory|high wind|lake wind|tornado|severe thunderstorm/i;
const EDGE_BUFFER_KM = 2; // also count a zone whose edge is this close (boundary/GPS slop)

function rings(zone) { return zone.type === "Polygon" ? [zone.coordinates] : zone.coordinates; }
function inside(lon, lat, polygon) {
  let hit = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}
function segmentKm(lon, lat, a, b) {
  const k = Math.cos(lat * Math.PI / 180);
  const ax = (a[0] - lon) * k, ay = a[1] - lat, dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx, ay + t * dy) * 111.195;
}
function distanceKm(lon, lat, zone) {
  let best = Infinity;
  for (const polygon of rings(zone)) {
    if (inside(lon, lat, polygon)) return 0;
    for (const ring of polygon) for (let i = 1; i < ring.length; i++) best = Math.min(best, segmentKm(lon, lat, ring[i - 1], ring[i]));
  }
  return best;
}
function zonesFor(lat, lon) {
  const ranked = Object.entries(ZONE_DATA.zones)
    .map(([id, zone]) => ({id, name: zone.name, km: distanceKm(lon, lat, zone)}))
    .sort((a, b) => a.km - b.km);
  const close = ranked.filter(z => z.km <= EDGE_BUFFER_KM);
  return (close.length ? close : ranked.slice(0, 1)).map(z => ({id: z.id, name: z.name, distanceKm: Number(z.km.toFixed(1))}));
}

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, {signal: controller.signal, headers: HEADERS});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
// NHC gives "27.0N"/"87.6W" text plus latitudeNumeric/longitudeNumeric; Number("87.6W") is NaN.
function coord(num, txt) {
  const n = Number(num);
  if (num != null && Number.isFinite(n)) return n;
  const m = String(txt ?? "").trim().match(/^(-?\d+(?:\.\d+)?)\s*([NSEW])?$/i);
  if (!m) return NaN;
  const v = Number(m[1]);
  return /[SW]/i.test(m[2] || "") ? -Math.abs(v) : v;
}
const STORM_TYPES = {HU: "Hurricane", TS: "Tropical Storm", TD: "Tropical Depression", STS: "Subtropical Storm", SD: "Subtropical Depression", PTC: "Potential Tropical Cyclone", PC: "Post-tropical Cyclone"};
function gulfStorms(nhc) {
  const list = Array.isArray(nhc?.activeStorms) ? nhc.activeStorms : null;
  if (!list) throw new Error("NHC storm feed format could not be verified");
  return list.filter(s => {
    const lat = coord(s.latitudeNumeric, s.latitude), lon = coord(s.longitudeNumeric, s.longitude);
    return (lat >= 16 && lat <= 32 && lon >= -98 && lon <= -80) || /gulf/i.test(String(s.basin || ""));
  }).map(s => [STORM_TYPES[s.classification] || s.classification, s.name].filter(Boolean).join(" ") || "Unnamed system");
}
function hazardsFrom(features, label) {
  return (features || [])
    .filter(f => DANGEROUS.test(`${f.properties?.event || ""} ${f.properties?.headline || ""}`))
    .map(f => ({event: f.properties.event, headline: f.properties.headline || "", ends: f.properties.ends || f.properties.expires || null, checked: label}));
}

const reply = (statusCode, body, cache) => ({
  statusCode,
  headers: {"content-type": "application/json", "cache-control": cache},
  body: JSON.stringify(body)
});

exports.handler = async function(event) {
  const lat = Number(event.queryStringParameters?.lat), lon = Number(event.queryStringParameters?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 27 || lat > 32 || lon < -95 || lon > -87) {
    return reply(400, {error: "Valid Louisiana lat and lon are required"}, "no-store");
  }
  const zones = zonesFor(lat, lon);
  const point = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const [nhc, pointAlerts, zoneAlerts, forecast] = await Promise.allSettled([
    getJson("https://www.nhc.noaa.gov/CurrentStorms.json"),
    getJson(`https://api.weather.gov/alerts/active?point=${point}`),
    getJson(`https://api.weather.gov/alerts/active?zone=${zones.map(z => z.id).join(",")}`),
    getJson(`https://api.weather.gov/zones/coastal/${zones[0].id}/forecast`)
  ]);
  const failed = [["National Hurricane Center", nhc], ["NWS alerts for this spot", pointAlerts], ["NWS marine zone alerts", zoneAlerts]]
    .filter(([, r]) => r.status === "rejected").map(([name, r]) => `${name} (${r.reason?.name === "AbortError" ? "timed out" : r.reason?.message || "failed"})`);
  let storms = [];
  if (nhc.status === "fulfilled") {
    try { storms = gulfStorms(nhc.value); } catch (e) { failed.push(`National Hurricane Center (${e.message})`); }
  }
  if (failed.length) return reply(502, {error: `Could not check: ${failed.join("; ")}`, zones}, "no-store");

  // Same alert can come back from both lookups; keep one copy per event.
  const seen = new Set();
  const hazards = [...hazardsFrom(zoneAlerts.value.features, "marine zone"), ...hazardsFrom(pointAlerts.value.features, "spot")]
    .filter(h => !seen.has(h.event) && seen.add(h.event));

  let marineForecast = null;
  if (forecast.status === "fulfilled") {
    const p = forecast.value.properties || {};
    const period = (p.periods || [])[0];
    if (period?.detailedForecast) marineForecast = {zone: zones[0].id, zoneName: zones[0].name, period: period.name, text: period.detailedForecast, updated: p.updated || null};
  }

  return reply(200, {
    checkedAt: new Date().toISOString(),
    zones,
    gulfStorms: storms,
    hazards,
    marineForecast,
    sources: ["National Hurricane Center CurrentStorms.json", "api.weather.gov active alerts (spot + marine zone)", "api.weather.gov marine zone forecast"]
  }, "private, max-age=120");
};
