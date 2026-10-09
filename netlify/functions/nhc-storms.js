/* Way More Fish — National Hurricane Center storm list relay
   nhc.noaa.gov does not send CORS headers, so a browser on this site cannot
   read CurrentStorms.json directly (the fetch fails before any data arrives).
   This passes the official feed through unchanged. Any failure returns an
   error, which the page treats as "safety status unavailable" (fail closed).
*/
exports.handler = async function() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch("https://www.nhc.noaa.gov/CurrentStorms.json", {
      signal: controller.signal,
      headers: {
        "User-Agent": "WayMoreFish/1.0 (Louisiana coastal fishing conditions)",
        "Accept": "application/json"
      }
    });
    if (!response.ok) throw new Error(`NHC HTTP ${response.status}`);
    const body = await response.text();
    JSON.parse(body); // never pass along a broken or HTML error page as storm data
    return {
      statusCode: 200,
      headers: {"content-type": "application/json", "cache-control": "public, max-age=120, s-maxage=120"},
      body
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: {"content-type": "application/json", "cache-control": "no-store"},
      body: JSON.stringify({error: error.name === "AbortError" ? "NHC request timed out" : (error.message || "NHC lookup failed")})
    };
  } finally {
    clearTimeout(timer);
  }
};
