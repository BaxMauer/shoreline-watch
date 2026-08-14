export type RoutePassageHint = {
  id: string;
  conditional: true;
  points: Array<{ longitude: number; latitude: number }>;
};

/**
 * Search hints for real navigable gaps that are narrower than the bounded
 * offline routing grid. Hints never waive shoreline checks: every point,
 * connection, and final route leg is still validated against the bundled HHI
 * coastline geometry.
 */
export const ROUTE_PASSAGE_HINTS: RoutePassageHint[] = [
  {
    id: "tisno-murter-bridge",
    conditional: true,
    points: [
      { longitude: 15.650548, latitude: 43.794038 },
      { longitude: 15.648308, latitude: 43.795576 },
      { longitude: 15.646068, latitude: 43.796661 },
      { longitude: 15.644574, latitude: 43.797747 },
      { longitude: 15.643081, latitude: 43.798833 },
      { longitude: 15.642334, latitude: 43.799013 },
      { longitude: 15.641587, latitude: 43.799104 },
      { longitude: 15.640841, latitude: 43.799375 },
      { longitude: 15.640094, latitude: 43.799647 },
      { longitude: 15.638600, latitude: 43.799737 },
      { longitude: 15.637107, latitude: 43.799737 },
      { longitude: 15.635614, latitude: 43.799828 },
      { longitude: 15.634991, latitude: 43.800009 },
    ],
  },
];
