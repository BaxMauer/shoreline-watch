import { buildWindRequestUrl, parseWindSample } from "../../../lib/wind.ts";
import { routeCoordinateIsValid } from "../../../lib/route-ui.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const latitude = url.searchParams.get("latitude");
  const longitude = url.searchParams.get("longitude");
  const point = {
    latitude: latitude === null ? Number.NaN : Number(latitude),
    longitude: longitude === null ? Number.NaN : Number(longitude),
  };
  if (!routeCoordinateIsValid(point)) return Response.json({ sample: null }, { status: 400, headers: { "Cache-Control": "no-store" } });

  try {
    const response = await fetch(buildWindRequestUrl(point), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6_500),
    });
    if (!response.ok) throw new Error(`Wind request returned ${response.status}`);
    const sample = parseWindSample(await response.json());
    if (!sample) throw new Error("Invalid wind response");
    return Response.json({ sample }, { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=1800" } });
  } catch {
    return Response.json({ sample: null }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
