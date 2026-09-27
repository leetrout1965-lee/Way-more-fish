/* Way More Fish — Pressure reliability + simplified map choices
   Keeps only Satellite and NOAA Nautical Chart in the Leaflet layer chooser.
   Adds an independent sea-level barometric pressure loader so pressure does not
   depend on the main NWS weather/grid request succeeding.
*/
(function () {
  if (window.__wmfPressureMapFixLoaded) return;
  window.__wmfPressureMapFixLoaded = true;

  function simplifyMapChoices() {
    try {
      if (typeof map === 'undefined' || typeof L === 'undefined') return;

      // Remove the existing layer-control UI.
      document.querySelectorAll('.leaflet-control-layers').forEach(function (el) {
        el.remove();
      });

      // Turn off layers the user does not want in the main chooser.
      if (typeof standardLayer !== 'undefined' && map.hasLayer(standardLayer)) map.removeLayer(standardLayer);
      if (typeof ccaReefLayer !== 'undefined' && map.hasLayer(ccaReefLayer)) map.removeLayer(ccaReefLayer);
      if (typeof bottomContoursLayer !== 'undefined' && map.hasLayer(bottomContoursLayer)) map.removeLayer(bottomContoursLayer);

      // Make Satellite the default view.
      if (typeof satelliteLayer !== 'undefined' && !map.hasLayer(satelliteLayer)) satelliteLayer.addTo(map);
      try { activeBaseLayer = satelliteLayer; } catch (_) {}

      // Rebuild a clean chooser with only the two requested base maps.
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

      // Update the helper text so it matches the simpler UI.
      var info = document.querySelector('div[style*="background:#0f1f2d"] .small.muted');
      if (info) {
        info.innerHTML =
          '<strong>Map:</strong> Choose <strong>Satellite</strong> for shoreline/water-color context or ' +
          '<strong>NOAA Nautical Chart</strong> for chart reference. Fishing overlays stay out of this menu to keep the map clean. ' +
          'Not a substitute for an approved navigation system.';
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

    // Add a small source line once, directly under the Weather card's Trend row.
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

    // Primary independent source: Open-Meteo sea-level pressure.
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
      var idx = 0;
      var best = Infinity;
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

    // Secondary source: existing METAR Netlify helper if the app has a station ID.
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

    // Do not overwrite a good value that the main weather loader may already have.
    var current = document.getElementById('pressure');
    if (!current || /Unavailable|No pressure feed|^—$/.test(current.textContent || '')) {
      setPressureUI('Unavailable', 'Unavailable', 'No pressure source available');
    }
  }

  // Run the map cleanup after the original map/control setup has finished.
  setTimeout(simplifyMapChoices, 0);

  // Hook spot selection so pressure gets its own independent request every time.
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

  // Extra safety for iPad/browser event ordering: when the spot dropdown changes,
  // run the independent pressure loader after the app has updated `selected`.
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

  // If a spot was already selected before this file executed, fill pressure now.
  setTimeout(function () {
    try {
      if (typeof selected !== 'undefined' && selected) loadDedicatedPressure(selected);
    } catch (_) {}
  }, 1200);
})();
