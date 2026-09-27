/* Way More Fish — Satellite Water credibility rules
   Fresh <= 36 hr
   Usable <= 72 hr
   Stale > 72 hr and <= 7 days: clearly labeled, NOT current water conditions
   Older than 7 days: no current water reading
*/
(function () {
  if (typeof L === 'undefined' || typeof map === 'undefined' || typeof spots === 'undefined') return;
  if (window.__wmfSatelliteWaterV2Loaded) return;
  window.__wmfSatelliteWaterV2Loaded = true;

  const FRESH_HOURS = 36;
  const USABLE_HOURS = 72;
  const STALE_MAX_HOURS = 168;

  const satelliteWaterLayer = L.layerGroup();
  let loading = false, legend = null, button = null;

  function bucket(score) {
    if (score >= 75) return { label: 'Relatively clearer', fill: '#36c275' };
    if (score >= 55) return { label: 'Mixed / moderate', fill: '#e5b84b' };
    return { label: 'Relatively murkier', fill: '#a66a3f' };
  }

  function ageText(hours) {
    if (!Number.isFinite(hours)) return 'age unavailable';
    if (hours < 36) return Math.max(1, Math.round(hours)) + ' hr old';
    return Math.max(1, Math.round(hours / 24)) + ' days old';
  }

  function freshness(ageHours) {
    if (!Number.isFinite(ageHours)) return 'unknown';
    if (ageHours <= FRESH_HOURS) return 'fresh';
    if (ageHours <= USABLE_HOURS) return 'usable';
    if (ageHours <= STALE_MAX_HOURS) return 'stale';
    return 'expired';
  }

  function label(state) {
    if (state === 'fresh') return 'Fresh satellite sample';
    if (state === 'usable') return 'Recent usable satellite sample';
    if (state === 'stale') return 'STALE satellite sample — not current water conditions';
    return 'No current satellite water reading';
  }

  function prototypeSpots() {
    return spots.filter(x => x.area === 'Big Lake / Calcasieu' || x.area === 'West Cove');
  }

  function showLegend() {
    if (legend) return;
    legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const d = L.DomUtil.create('div', 'satwater-legend');
      d.innerHTML =
        '<strong>Satellite Water</strong>' +
        '<div><span class="satwater-dot" style="background:#36c275"></span>Relatively clearer</div>' +
        '<div><span class="satwater-dot" style="background:#e5b84b"></span>Mixed / moderate</div>' +
        '<div><span class="satwater-dot" style="background:#a66a3f"></span>Relatively murkier</div>' +
        '<div><span class="satwater-dot" style="background:#7f8c98"></span>Stale / unavailable</div>' +
        '<div style="margin-top:5px;color:#9fb0bf">Colored readings are shown only when the VIIRS sample is ≤72 hr old. Older samples are labeled stale and are not presented as current conditions.</div>';
      return d;
    };
    legend.addTo(map);
  }

  function hideLegend() {
    if (legend) { map.removeControl(legend); legend = null; }
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    satelliteWaterLayer.clearLayers();

    const pts = prototypeSpots();
    let freshCount = 0, usableCount = 0, staleCount = 0, unavailableCount = 0;

    await Promise.allSettled(pts.map(async function (p) {
      try {
        const r = await fetch('/.netlify/functions/water-clarity?lat=' + p.lat + '&lon=' + p.lon, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const sat = j && j.satellite;
        if (!sat || !Number.isFinite(Number(sat.ageHours))) throw new Error('No usable satellite sample');

        const ageHours = Number(sat.ageHours);
        const state = sat.freshness || freshness(ageHours);
        const age = ageText(ageHours);
        const sampleTime = sat.time ? new Date(sat.time).toLocaleString([], {
          month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit'
        }) : 'time unavailable';

        if (state === 'fresh' || state === 'usable') {
          const score = Math.round(Number(sat.score));
          if (!Number.isFinite(score)) throw new Error('No usable satellite score');
          const b = bucket(score);
          if (state === 'fresh') freshCount++; else usableCount++;

          const m = L.circleMarker([p.lat, p.lon], {
            radius: 10, weight: 2, color: '#eef6fb',
            fillColor: b.fill, fillOpacity: 0.78
          });
          m.bindTooltip(p.name + ': ' + b.label + ' • ' + age, { direction: 'top' });
          m.bindPopup(
            '<strong>' + p.name + '</strong><br>' +
            '<strong>' + b.label + '</strong> • ' + score + '/100<br>' +
            '<strong>' + label(state) + '</strong><br>' +
            'Sample: ' + sampleTime + ' • ' + age + '<br>' +
            '<span style="font-size:11px">Satellite-derived water color/attenuation, not a live camera.</span>'
          );
          satelliteWaterLayer.addLayer(m);
          return;
        }

        if (state === 'stale') {
          staleCount++;
          const m = L.circleMarker([p.lat, p.lon], {
            radius: 8, weight: 2, color: '#d6dde3',
            fillColor: '#7f8c98', fillOpacity: 0.58
          });
          m.bindTooltip(p.name + ': STALE • ' + age, { direction: 'top' });
          m.bindPopup(
            '<strong>' + p.name + '</strong><br>' +
            '<strong>STALE — not current water conditions</strong><br>' +
            'Newest usable pixel: ' + sampleTime + ' • ' + age
          );
          satelliteWaterLayer.addLayer(m);
          return;
        }

        unavailableCount++;
      } catch (_) {
        unavailableCount++;
      }
    }));

    loading = false;
    const status = document.getElementById('areaStatus');
    if (status) {
      status.textContent =
        'Satellite Water: ' + freshCount + ' fresh • ' +
        usableCount + ' recent usable • ' +
        staleCount + ' stale • ' +
        unavailableCount + ' unavailable. Stale samples are not treated as current water conditions.';
    }
  }

  async function toggle() {
    if (map.hasLayer(satelliteWaterLayer)) {
      map.removeLayer(satelliteWaterLayer);
      hideLegend();
      if (button) {
        button.classList.remove('active');
        button.textContent = '💧 Satellite Water';
      }
      return;
    }

    satelliteWaterLayer.addTo(map);
    showLegend();
    if (button) {
      button.classList.add('active');
      button.textContent = '✓ Satellite Water';
    }
    await refresh();
  }

  const SatelliteWaterControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function () {
      const box = L.DomUtil.create('div', 'leaflet-bar');
      const btn = L.DomUtil.create('a', 'satwater-control', box);
      btn.href = '#';
      btn.textContent = '💧 Satellite Water';
      button = btn;
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.on(btn, 'click', L.DomEvent.stop).on(btn, 'click', toggle);
      return box;
    }
  });

  map.addControl(new SatelliteWaterControl());
})();
