/* Way More Fish — Satellite Water prototype
   Big Lake / Calcasieu + West Cove
   Uses NOAA VIIRS Kd490 returned by the existing Netlify water-clarity function.
   This is a satellite-derived water-color/attenuation signal, not a live camera or navigation layer.
*/
(function () {
  if (typeof L === 'undefined' || typeof map === 'undefined' || typeof spots === 'undefined') {
    console.warn('Satellite Water: map/spots not ready.');
    return;
  }
  if (window.__wmfSatelliteWaterLoaded) return;
  window.__wmfSatelliteWaterLoaded = true;

  const style = document.createElement('style');
  style.textContent = `
    .satwater-control{background:#0b668d!important;color:#fff!important;width:auto!important;min-width:44px!important;padding:0 10px!important;font-size:13px!important;font-weight:800!important;line-height:32px!important;text-decoration:none!important;white-space:nowrap}
    .satwater-control.active{background:#19a974!important}
    .satwater-legend{background:rgba(15,31,45,.96);color:#eef6fb;padding:9px 10px;border:1px solid #38566d;border-radius:10px;box-shadow:0 2px 12px #0007;font:12px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:230px}
    .satwater-legend strong{display:block;margin-bottom:4px}.satwater-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}
  `;
  document.head.appendChild(style);

  const satelliteWaterLayer = L.layerGroup();
  let loading = false;
  let legend = null;
  let button = null;

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

  function prototypeSpots() {
    return spots.filter(function (x) {
      return x.area === 'Big Lake / Calcasieu' || x.area === 'West Cove';
    });
  }

  function showLegend() {
    if (legend) return;
    legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const d = L.DomUtil.create('div', 'satwater-legend');
      d.innerHTML =
        '<strong>Satellite Water • prototype</strong>' +
        '<div><span class="satwater-dot" style="background:#36c275"></span>Relatively clearer</div>' +
        '<div><span class="satwater-dot" style="background:#e5b84b"></span>Mixed / moderate</div>' +
        '<div><span class="satwater-dot" style="background:#a66a3f"></span>Relatively murkier</div>' +
        '<div style="margin-top:5px;color:#9fb0bf">NOAA VIIRS Kd490 point samples. Cloud/missing pixels can limit coverage. Not a live camera.</div>';
      return d;
    };
    legend.addTo(map);
  }

  function hideLegend() {
    if (legend) {
      map.removeControl(legend);
      legend = null;
    }
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    satelliteWaterLayer.clearLayers();
    const pts = prototypeSpots();

    const jobs = pts.map(async function (p) {
      try {
        const r = await fetch('/.netlify/functions/water-clarity?lat=' + p.lat + '&lon=' + p.lon, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const sat = j && j.satellite;
        if (!sat || !Number.isFinite(Number(sat.score))) throw new Error('No usable satellite pixel');

        const score = Math.round(Number(sat.score));
        const b = bucket(score);
        const age = ageText(Number(sat.ageHours));
        const kd = Number.isFinite(Number(sat.kd)) ? Number(sat.kd).toFixed(2) : '—';

        const m = L.circleMarker([p.lat, p.lon], {
          radius: 10,
          weight: 2,
          color: '#eef6fb',
          fillColor: b.fill,
          fillOpacity: 0.78
        });
        m.bindTooltip(p.name + ': ' + b.label, { direction: 'top' });
        m.bindPopup(
          '<strong>' + p.name + '</strong><br>' +
          '<strong>' + b.label + '</strong> • ' + score + '/100<br>' +
          'VIIRS Kd490: ' + kd + ' m⁻¹<br>' +
          'Satellite sample: ' + age + '<br>' +
          '<span style="font-size:11px">Lower Kd490 generally means clearer water. Cloud cover, shallow bottom and missing pixels can affect interpretation. This is a satellite-derived point sample, not a live camera.</span><br>' +
          '<button onclick="openSatelliteView()" style="margin-top:7px">Open NASA imagery</button>'
        );
        satelliteWaterLayer.addLayer(m);
        return true;
      } catch (e) {
        const m = L.circleMarker([p.lat, p.lon], {
          radius: 7,
          weight: 1,
          color: '#9fb0bf',
          fillColor: '#607b8e',
          fillOpacity: 0.45
        });
        m.bindTooltip(p.name + ': satellite unavailable', { direction: 'top' });
        m.bindPopup(
          '<strong>' + p.name + '</strong><br>' +
          'Satellite water sample unavailable right now.<br>' +
          '<span style="font-size:11px">Clouds or a missing VIIRS pixel are common causes.</span>'
        );
        satelliteWaterLayer.addLayer(m);
        return false;
      }
    });

    const results = await Promise.allSettled(jobs);
    loading = false;
    const ok = results.filter(function (x) { return x.status === 'fulfilled' && x.value === true; }).length;
    const status = document.getElementById('areaStatus');
    if (status) {
      status.textContent = 'Satellite Water prototype: ' + ok + '/' + pts.length + ' Big Lake / West Cove spots have a usable recent VIIRS sample. Tap a colored circle for details.';
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

    const pts = prototypeSpots();
    if (pts.length) {
      const bounds = L.latLngBounds(pts.map(function (p) { return [p.lat, p.lon]; }));
      if (!bounds.contains(map.getCenter())) map.fitBounds(bounds.pad(0.12), { maxZoom: 11 });
    }
    await refresh();
  }

  const SatelliteWaterControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function () {
      const box = L.DomUtil.create('div', 'leaflet-bar');
      const btn = L.DomUtil.create('a', 'satwater-control', box);
      btn.href = '#';
      btn.title = 'Show recent satellite-derived water clarity for Big Lake / West Cove';
      btn.setAttribute('aria-label', 'Toggle Satellite Water prototype');
      btn.textContent = '💧 Satellite Water';
      button = btn;
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.on(btn, 'click', L.DomEvent.stop).on(btn, 'click', toggle);
      return box;
    }
  });

  map.addControl(new SatelliteWaterControl());
})();
