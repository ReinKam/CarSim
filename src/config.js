// Central configuration. To add a new training area, add an entry to AREAS.

export const VERSION = '0.1.0';

export const AREAS = {
  furuset: {
    id: 'furuset',
    name: 'Furuset Senter, Oslo',
    // Furuset T-banestasjon / Furuset Senter
    lat: 59.941,
    lon: 10.8972,
    // Half the side of the square that is fetched from OpenStreetMap, in metres.
    halfSizeM: 600,
  },
};

export const DEFAULT_AREA = 'furuset';
export const DEFAULT_CAR = 'tesla-model-y-rwd';

/** Tolerances used by the driving instructor (rule engine). Tune here, not in the rules. */
export const RULES = {
  speedToleranceKmh: 3, // how far above the limit before it counts
  speedMinDurationS: 1.5, // must last this long before it counts
  offRoadMarginM: 1.0, // car centre this far outside the road edge
  offRoadMinDurationS: 1.0,
  oncomingMarginM: 0.5, // car centre this far into the opposite lane
  oncomingMinDurationS: 2.0,
  oncomingJunctionClearM: 20, // not checked this close to a junction
  wrongWayMinDurationS: 1.5,
  junctionRadiusM: 15, // a "junction passage" is the time spent this close to a junction
  turnMinAngleDeg: 35,
  harshBrakeMs2: 6.0,
  harshAccelMs2: 4.2,
  corneringMs2: 4.5,
  minSessionS: 120, // shorter sessions get no verdict
  minSessionM: 400,
};
