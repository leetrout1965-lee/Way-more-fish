/* Way More Fish — rebuild netlify/marine-zones.json
   Downloads the official NWS marine forecast zone boundaries for Louisiana
   waters so marine-safety.js can work out which zone(s) cover a fishing spot.
   Zone boundaries rarely change; rerun only if NWS announces zone changes.
   Usage: node scripts/build-marine-zones.js
*/
const fs = require("fs");
const path = require("path");
const ZONE_PATTERN = /^GMZ(43|45|47|53|54|55|57)\d$/; // Sabine Lake east to the Mississippi Sound
const HEADERS = {"User-Agent": "WayMoreFish/1.0 (Louisiana coastal fishing conditions)", "Accept": "application/geo+json"};
const round = c => Array.isArray(c[0]) ? c.map(round) : [Number(c[0].toFixed(5)), Number(c[1].toFixed(5))];

(async () => {
  const list = await (await fetch("https://api.weather.gov/zones?type=coastal&area=GM", {headers: HEADERS})).json();
  const ids = list.features.map(f => f.properties.id).filter(id => ZONE_PATTERN.test(id)).sort();
  const zones = {};
  for (const id of ids) {
    const zone = await (await fetch(`https://api.weather.gov/zones/coastal/${id}`, {headers: HEADERS})).json();
    if (!zone.geometry) throw new Error(`${id} has no boundary`);
    zones[id] = {name: zone.properties.name, type: zone.geometry.type, coordinates: round(zone.geometry.coordinates)};
  }
  const out = path.join(__dirname, "..", "netlify", "marine-zones.json");
  fs.writeFileSync(out, JSON.stringify({source: "https://api.weather.gov/zones/coastal", built: new Date().toISOString().slice(0, 10), zones}));
  console.log(`Wrote ${ids.length} zones to ${out}`);
})().catch(e => { console.error(e); process.exit(1); });
