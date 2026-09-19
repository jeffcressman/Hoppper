import { describe, it, expect } from 'vitest';
import { laneGeometry, LANE_TOP, MIN_LANE_H } from '../../src/hop-editor/layout';

describe('laneGeometry — lanes fill the timeline’s height', () => {
  it('shares the space between both lanes when a hop point is selected', () => {
    const g = laneGeometry(700, true);
    expect(g.lane2Y).toBeGreaterThan(g.lane1Y + g.laneH);
    // Everything, labels included, fits the space it was given.
    expect(g.height).toBeLessThanOrEqual(700);
    expect(g.height).toBeGreaterThan(700 - 4);
  });

  it('gives a single lane the whole height', () => {
    const one = laneGeometry(700, false);
    const two = laneGeometry(700, true);
    expect(one.lane1Y).toBe(LANE_TOP);
    expect(one.laneH).toBeGreaterThan(two.laneH * 1.8);
    expect(one.height).toBeLessThanOrEqual(700);
  });

  it('never shrinks a lane below a readable size, scrolling instead', () => {
    const g = laneGeometry(200, true);
    expect(g.laneH).toBe(MIN_LANE_H);
    expect(g.height).toBeGreaterThan(200);
  });

  it('copes with not being measured yet', () => {
    expect(laneGeometry(0, true).laneH).toBe(MIN_LANE_H);
  });

  it('zooms tracks taller than the view, which then scrolls', () => {
    const fitted = laneGeometry(700, true);
    const tall = laneGeometry(700, true, 2);
    expect(tall.laneH).toBe(fitted.laneH * 2);
    expect(tall.height).toBeGreaterThan(700);
  });

  it('never zooms below the fitted size', () => {
    expect(laneGeometry(700, false, 0.5).laneH).toBe(laneGeometry(700, false).laneH);
  });
});
