export const EXPRESSIONS = ['happy', 'sad', 'angry', 'fear', 'disgust', 'surprise', 'neutral'] as const;
export type Expression = typeof EXPRESSIONS[number];
export type Scores = Partial<Record<Expression, number>>;
export interface Observation { faces: number; confidence: number; size: number; scores: Scores }
export type Reading = { expression: Expression; confidence: number };

/** Use several independently inferred frames, not one blink or cached result.
 * These thresholds are UX heuristics, not calibrated emotion probabilities. */
export class ExpressionWindow {
  private samples: { scores: Scores; time: number }[] = [];

  add(observation: Observation, time: number): Reading | null {
    if (observation.faces !== 1 || observation.confidence < .7 || observation.size < 64
      || !Number.isFinite(observation.confidence) || !Number.isFinite(observation.size)) {
      this.samples = [];
      return null;
    }
    const scores: Scores = {};
    for (const expression of EXPRESSIONS) {
      const value = observation.scores[expression] ?? 0;
      if (!Number.isFinite(value) || value < 0 || value > 1) { this.samples = []; return null; }
      scores[expression] = value;
    }
    if (Object.values(scores).reduce((sum, value) => sum + value, 0) < .5) { this.samples = []; return null; }
    this.samples.push({ scores, time });
    this.samples = this.samples.filter(sample => time - sample.time <= 4500).slice(-10);
    if (this.samples.length < 5 || time - this.samples[0].time < 1800) return null;
    const ranked = EXPRESSIONS.map(expression => ({
      expression,
      confidence: this.samples.reduce((sum, sample) => sum + (sample.scores[expression] ?? 0), 0) / this.samples.length,
    })).sort((a, b) => b.confidence - a.confidence);
    const top = ranked[0];
    const votes = this.samples.filter(sample => EXPRESSIONS.every(expression =>
      (sample.scores[top.expression] ?? 0) >= (sample.scores[expression] ?? 0))).length;
    if (top.confidence < .5 || top.confidence - ranked[1].confidence < .18 || votes / this.samples.length < .7) return null;
    return top;
  }
}
