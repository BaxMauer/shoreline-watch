import {
  buildPhotonPlaceSearchUrl,
  normalizePlaceSearchText,
  parsePhotonPlaceSearchPayload,
} from "../../../lib/place-search.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const language = url.searchParams.get("lang") === "en" ? "en" : "de";
  if (normalizePlaceSearchText(query).length < 2 || query.length > 80) {
    return Response.json({ results: [] }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const response = await fetch(buildPhotonPlaceSearchUrl(query, language), {
      headers: {
        Accept: "application/geo+json, application/json",
        "User-Agent": "Shoreline-Watch place-search (+https://boot.maxi-bauer.de)",
      },
      signal: AbortSignal.timeout(5_500),
    });
    if (!response.ok) throw new Error(`Place search returned ${response.status}`);
    return Response.json({ results: parsePhotonPlaceSearchPayload(await response.json()) }, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return Response.json({ results: [] }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
