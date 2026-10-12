// Supported skeleton types
export enum SkeletonType {
  Fox = 'fox',
  Human = 'human',
  Bird = 'bird',
  Dragon = 'dragon',
  Kaiju = 'kaiju',
  Spider = 'spider',
  Snake = 'snake',
  Fish = 'fish',
  Horse = 'horse',
  Error = 'error',
  None = 'none'
}

// Hand skeleton variation types for human skeleton
export enum HandSkeletonType {
  // Preferred digit counts for the 3D hand; the palm/wrist stay independent.
  OneFinger = 'one-finger',
  TwoFingers = 'two-fingers',
  ThreeFingers = 'three-fingers',
  FiveFingers = 'five-fingers',
  // Keep older saved choices compatible with existing projects.
  AllFingers = 'all-fingers',
  ThumbAndIndex = 'thumb-and-index',
  SimplifiedHand = 'simplified-hand',
  SingleBone = 'single-bone'
}
