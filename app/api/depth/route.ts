import {
  fetchEmodnetWaterDepth,
  type CurrentDepthState,
} from "../../../lib/bathymetry.ts";
import { routeCoordinateIsValid } from "../../../lib/route-ui.ts";

export const dynamic = "force-dynamic";

function response(depthMetres: number | null, state: CurrentDepthState, status = 200) {
  return Response.json({ depthMetres, state }, {
    status,
    headers: {
      "Cache-Control": status === 200 && state === "ready"
        ? "public, max-age=3600, stale-while-revalidate=86400"
        : "no-store",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const latitude = url.searchParams.get("latitude");
  const longitude = url.searchParams.get("longitude");
  const point = {
    latitude: latitude === null ? Number.NaN : Number(latitude),
    longitude: longitude === null ? Number.NaN : Number(longitude),
  };
  if (!routeCoordinateIsValid(point)) return response(null, "error", 400);

  try {
    const depthMetres = await fetchEmodnetWaterDepth(point, (input, init) => fetch(input, {
      ...init,
      signal: AbortSignal.timeout(6_500),
    }));
    return response(depthMetres, depthMetres === null ? "unavailable" : "ready");
  } catch {
    return response(null, "error", 502);
  }
}
