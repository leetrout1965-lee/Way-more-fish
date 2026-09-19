exports.handler = async function(event) {
  const station = String((event.queryStringParameters || {}).station || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!/^[A-Z0-9]{3,4}$/.test(station)) {
    return {
      statusCode: 400,
      headers: {"content-type": "application/json", "cache-control": "no-store"},
      body: JSON.stringify({error: "Valid 3-4 character station id required"})
    };
  }

  const url = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(station)}&format=json&hours=6`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "WayMoreFish/1.0 (Louisiana coastal fishing conditions)",
        "Accept": "application/json"
      }
    });

    if (response.status === 204) {
      return {
        statusCode: 404,
        headers: {"content-type": "application/json", "cache-control": "public, max-age=300"},
        body: JSON.stringify({error: "No recent METAR observations"})
      };
    }

    if (!response.ok) {
      throw new Error(`Aviation Weather HTTP ${response.status}`);
    }

    const data = await response.json();
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);

    function parseTime(row) {
      const candidates = [
        row.obsTime, row.reportTime, row.reportTimeISO, row.issueTime,
        row.receiptTime, row.rawObTime, row.time
      ];
      for (const v of candidates) {
        if (v == null) continue;
        if (typeof v === "number" && Number.isFinite(v)) {
          return v > 1e12 ? v : v * 1000;
        }
        const t = Date.parse(v);
        if (Number.isFinite(t)) return t;
      }
      return 0;
    }

    function parseAltim(row) {
      const direct = [
        row.altim, row.altimeter, row.altimInHg, row.altimeterInHg,
        row.altimeterSetting, row.pressureInHg
      ];
      for (const v of direct) {
        const n = Number(v);
        if (Number.isFinite(n)) {
          if (n > 27 && n < 33) return n;            // already inHg
          if (n > 900 && n < 1100) return n * 0.0295299831; // hPa
          if (n > 90000 && n < 110000) return (n / 100) * 0.0295299831; // Pa
        }
      }

      const raw = String(row.rawOb || row.rawText || row.raw || "");
      const m = raw.match(/\bA(\d{4})\b/);
      if (m) return Number(m[1]) / 100;

      const q = raw.match(/\bQ(\d{4})\b/);
      if (q) return Number(q[1]) * 0.0295299831;

      return null;
    }

    const obs = rows
      .map(row => ({time: parseTime(row), pressureInHg: parseAltim(row)}))
      .filter(x => Number.isFinite(x.pressureInHg) && x.pressureInHg > 27 && x.pressureInHg < 33)
      .sort((a, b) => b.time - a.time);

    if (!obs.length) {
      return {
        statusCode: 404,
        headers: {"content-type": "application/json", "cache-control": "public, max-age=300"},
        body: JSON.stringify({error: "METAR returned no usable altimeter values"})
      };
    }

    const latest = obs[0].pressureInHg;
    const older = obs[Math.min(3, obs.length - 1)].pressureInHg;
    const diff = latest - older;
    const trend = diff > 0.03 ? "Rising" : diff < -0.03 ? "Falling" : "Stable";

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300, s-maxage=300"
      },
      body: JSON.stringify({
        station,
        pressureInHg: latest,
        trend,
        series: obs.slice(0, 6).map(x => x.pressureInHg),
        observedAt: obs[0].time ? new Date(obs[0].time).toISOString() : null,
        provider: "Aviation Weather Center METAR"
      })
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: {"content-type": "application/json", "cache-control": "no-store"},
      body: JSON.stringify({error: error.message || "METAR pressure lookup failed"})
    };
  }
};
