// Vehicle data. One entry per real car model. Adding a car = adding an entry here.
//
// Every figure that is NOT taken from a published specification is listed in
// `estimated`, so it is clear what still has to be verified against the
// manufacturer's data before the simulator is used for real training.

export const CARS = {
  'tesla-model-y-rwd': {
    id: 'tesla-model-y-rwd',
    name: 'Tesla Model Y (bakhjulsdrift)',
    modelYear: 2026,
    drivetrain: 'electric',
    transmission: 'automatic', // single-speed reduction gear
    sources: ['https://evkx.net/nb/models/tesla/model_y/model_y_rwd/specifications/'],

    // Published figures
    powerKw: 220,
    torqueNm: 420,
    topSpeedKmh: 201,
    zeroTo100S: 5.9, // used only by the automated test as a sanity check
    lengthM: 4.797,
    widthM: 1.92,
    heightM: 1.624,
    wheelbaseM: 2.89,
    trackM: 1.636,
    cd: 0.23,
    frontalAreaM2: 2.65,
    turningDiameterM: 12.1,

    // Estimates (see `estimated`)
    massKg: 1900,
    driverKg: 75,
    gearRatio: 9.0,
    wheelRadiusM: 0.356,
    drivenAxleLoad: 0.62, // share of weight on the driven (rear) axle under acceleration
    tireMu: 0.9, // dry asphalt, summer tyres
    crr: 0.011, // rolling resistance
    brakeDecelMax: 9.5, // m/s^2 at full brake pedal
    regenDecel: 1.6, // m/s^2 when the accelerator is released
    reverseTopKmh: 25,
    lockToLockDeg: 720, // steering wheel, full left to full right
    overhangFrontM: 0.93,
    eyeHeightM: 1.28,

    estimated: [
      'massKg',
      'gearRatio',
      'wheelRadiusM',
      'drivenAxleLoad',
      'tireMu',
      'crr',
      'brakeDecelMax',
      'regenDecel',
      'reverseTopKmh',
      'lockToLockDeg',
      'overhangFrontM',
      'eyeHeightM',
    ],
  },
};

/** Largest front-wheel angle, derived from the published turning circle. */
export function maxSteerRad(car) {
  const L = car.wheelbaseM;
  const rOuter = car.turningDiameterM / 2;
  // Outer front wheel runs on rOuter; solve for the turn radius at the rear axle centre.
  const rRear = Math.sqrt(Math.max(rOuter * rOuter - L * L, 1)) - car.trackM / 2;
  return Math.atan(L / rRear);
}
