import type { Expression } from './expressions';

/** Art-directed associations, not universal emotional color meanings.
 * Extra absorption in inverse metres: a 6 mm glass round trip loses at most
 * 11.3% in any channel. Front-surface glints remain neutral and unattenuated. */
export const EXPRESSION_ABSORPTION: Record<Expression, readonly [number, number, number]> = {
  happy: [.8, 5, 18],       // pale honey
  sad: [18, 7, 1],         // blue silver
  angry: [1, 18, 15],      // muted rose
  fear: [10, 18, 1],       // lavender
  disgust: [16, 1, 14],    // sage
  surprise: [1, 11, 20],   // peach
  neutral: [0, 0, 0],      // original silver
};
