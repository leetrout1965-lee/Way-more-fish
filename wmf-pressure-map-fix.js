/* Way More Fish — Pressure reliability + simplified map choices + CCA reefs
   Map chooser shows only Satellite and NOAA Nautical Chart.
   CCA reefs remain visible as an always-on overlay.
   Bottom contours and Standard are removed from the chooser/view.
   Adds an independent sea-level pressure loader.
   Adds the exact timestamp of the newest usable Satellite Water sample.
*/
(function () {
  if (window.__wmfPressureMapFixV2Loaded) return;
  window.__wmfPressureMapFixV2Loaded = true;

  function simplifyMapChoices() {
    try {
      if (typeof map === 'undefined' || typeof L === 'undefined') return;

      document.querySelectorAll('.leaflet-control-layers').forEach(function (el) {
        el.remove();
      });

      if (typeof standardLayer !== 'undefined' && map.hasLayer(standardLayer)) {
        map.removeLayer(standardLayer);
      }
      if (typeof bottomContoursLayer !== 'undefined' && map.hasLayer(bottomContoursLayer)) {
        map.removeLayer(bottomContoursLayer);
      }

      // Keep CCA reefs visible, but do not put them in the menu.
      if (typeof ccaReefLayer !== 'undefined' && !map.hasLayer(ccaReefLayer)) {
        ccaReefLayer.addTo(map);
      }

      // Default to Satellite.
      if (typeof satelliteLayer !== 'undefined' && !map.hasLayer(satelliteLayer)) {
        satelliteLayer.addTo(map);
      }
      try { activeBaseLayer = satelliteLayer; } catch (_) {}

      // Only the two requested map choices.
      if (typeof satelliteLayer !== 'undefined' && typeof noaaChartLayer !== 'undefined') {
        L.control.layers(
          {
            'Satellite': satelliteLayer,
            'NOAA Nautical Chart': noaaChartLayer
          },
          {},
          { position: 'topright', collapsed: false }
        ).addTo(map);
      }

      var info = document.querySelector('div[style*="background:#0f1f2d"] .small.muted');
      if (info) {
        info.innerHTML =
          '<strong>Map:</strong> Choose <strong>Satellite</strong> or <strong>NOAA Nautical Chart</strong>. ' +
          '<strong>CCA Artificial Reefs stay visible automatically.</strong> Not a substitute for an approved navigation system.';
      }
    } catch (e) {
      console.warn('Map simplification failed:', e);
    }
  }

  function setPressureUI(value, trend, source) {
    var p = document.getElementById('pressure');
    var t = document.getElementById('pressureTrend');
    if (p) p.textContent = value;
    if (t) t.textContent = trend;

    var src = document.getElementById('pressureSource');
    if (!src && t) {
      var row = t.closest('.row');
      if (row && row.parentElement) {
        src = document.createElement('div');
        src.id = 'pressureSource';
        src.className = 'small muted';
        src.style.marginTop = '5px';
        row.parentElement.appendChild(src);
      }
    }
    if (src) src.textContent = source ? ('Pressure source: ' + source) : '';

    try { if (typeof updateSpotQuickSheet === 'function') updateSpotQuickSheet(); } catch (_) {}
    try { if (typeof updateBestWindow === 'function') updateBestWindow(); } catch (_) {}
  }

  function trendFromSeries(values, currentIndex) {
    if (!values.length) return 'Unavailable';
    var a = Number(values[currentIndex]);
    var b = Number(values[Math.min(values.length - 1, currentIndex + 3)]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 'Unavailable';
    var diff = b - a;
    return diff > 1.0 ? 'Rising' : diff < -1.0 ? 'Falling' : 'Stable';
  }

  async function loadDedicatedPressure(spot) {
    if (!spot || !Number.isFinite(Number(spot.lat)) || !Number.isFinite(Number(spot.lon))) return;

    try {
      var url =
        'https://api.open-meteo.com/v1/forecast?latitude=' + Number(spot.lat).toFixed(4) +
        '&longitude=' + Number(spot.lon).toFixed(4) +
        '&hourly=pressure_msl&timezone=America%2FChicago&forecast_days=2';

      var r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status);
      var j = await r.json();
      var times = (j.hourly && j.hourly.time) || [];
      var vals = (j.hourly && j.hourly.pressure_msl) || [];
      if (!times.length || !vals.length) throw new Error('No pressure values');

      var now = Date.now();
      var idx = 0, best = Infinity;
      for (var i = 0; i < times.length; i++) {
        var d = Math.abs(new Date(times[i]).getTime() - now);
        if (d < best) { best = d; idx = i; }
      }

      var hPa = Number(vals[idx]);
      if (!Number.isFinite(hPa)) throw new Error('Current pressure unavailable');

      var inHg = hPa * 0.0295299831;
      var trend = trendFromSeries(vals.map(Number), idx);
      try { pressureSeries = vals.slice(idx, idx + 6).map(Number).filter(Number.isFinite); } catch (_) {}

      setPressureUI(inHg.toFixed(2) + ' inHg', trend, 'Open-Meteo sea-level pressure');
      return;
    } catch (primaryErr) {
      console.warn('Dedicated pressure primary failed:', primaryErr);
    }

    try {
      if (typeof fetchMetarPressureFallback === 'function' &&
          typeof recentConditions !== 'undefined' &&
          recentConditions && recentConditions.stationId) {
        var mp = await fetchMetarPressureFallback(recentConditions.stationId);
        if (mp && Number.isFinite(Number(mp.pressureInHg))) {
          try { pressureSeries = (mp.series || []).map(Number).filter(Number.isFinite); } catch (_) {}
          setPressureUI(
            Number(mp.pressureInHg).toFixed(2) + ' inHg',
            mp.trend || 'Stable',
            'Nearby METAR station'
          );
          return;
        }
      }
    } catch (secondaryErr) {
      console.warn('Dedicated pressure METAR fallback failed:', secondaryErr);
    }

    var current = document.getElementById('pressure');
    if (!current || /Unavailable|No pressure feed|^—$/.test(current.textContent || '')) {
      setPressureUI('Unavailable', 'Unavailable', 'No pressure source available');
    }
  }

  function formatSatelliteTime(iso) {
    var d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  async function updateLatestSatelliteTimestamp() {
    try {
      if (typeof spots === 'undefined') return;
      var candidates = spots.filter(function (s) {
        return s.area === 'Big Lake / Calcasieu' || s.area === 'West Cove';
      });
      if (!candidates.length) return;

      var results = await Promise.allSettled(candidates.map(async function (p) {
        var r = await fetch('/.netlify/functions/water-clarity?lat=' + p.lat + '&lon=' + p.lon, { cache: 'no-store' });
        if (!r.ok) return null;
        var j = await r.json();
        var sat = j && j.satellite;
        if (!sat || !sat.time) return null;
        var ms = Date.parse(sat.time);
        if (!Number.isFinite(ms)) return null;
        return { ms: ms, time: sat.time, spot: p.name };
      }));

      var usable = results
        .filter(function (x) { return x.status === 'fulfilled' && x.value; })
        .map(function (x) { return x.value; })
        .sort(function (a, b) { return b.ms - a.ms; });

      var box = document.getElementById('satelliteLatestTime');
      if (!box) {
        box = document.createElement('div');
        box.id = 'satelliteLatestTime';
        box.className = 'small muted';
        box.style.padding = '6px 12px';
        box.style.background = '#0f1f2d';
        box.style.borderBottom = '1px solid #284153';
        var mapEl = document.getElementById('map');
        if (mapEl && mapEl.parentNode) mapEl.parentNode.insertBefore(box, mapEl);
      }

      if (!usable.length) {
        box.textContent = 'Satellite Water: no usable recent VIIRS sample found right now (clouds/missing pixels may be the reason).';
        return;
      }

      var latest = usable[0];
      box.textContent =
        'Latest usable Satellite Water sample: ' + formatSatelliteTime(latest.time) +
        ' • near ' + latest.spot +
        ' • NOAA VIIRS Kd490';
    } catch (e) {
      console.warn('Satellite timestamp lookup failed:', e);
    }
  }

  setTimeout(function () {
    simplifyMapChoices();
    updateLatestSatelliteTimestamp();
  }, 0);

  try {
    if (typeof selectSpot === 'function') {
      var originalSelectSpot = selectSpot;
      selectSpot = async function (s) {
        var result = await originalSelectSpot(s);
        loadDedicatedPressure(s);
        return result;
      };
    }
  } catch (e) {
    console.warn('Could not wrap selectSpot:', e);
  }

  var picker = document.getElementById('locationPicker');
  if (picker) {
    picker.addEventListener('change', function () {
      setTimeout(function () {
        try {
          if (typeof selected !== 'undefined' && selected) loadDedicatedPressure(selected);
        } catch (_) {}
      }, 700);
    });
  }

  setTimeout(function () {
    try {
      if (typeof selected !== 'undefined' && selected) loadDedicatedPressure(selected);
    } catch (_) {}
  }, 1200);
})();
