import { describe, expect, it } from 'vitest';
import { drawingScanPercent, estimateResumeRow } from './drawing-state';

describe('drawing state helpers', () => {
  it('moves the scan line vertically within the selected row range', () => {
    expect(drawingScanPercent(1, 120, .5, 120)).toBe(50);
    expect(drawingScanPercent(61, 120, 0, 120)).toBe(50);
    expect(drawingScanPercent(61, 120, .5, 120)).toBe(75);
  });

  it('suggests a bounded resume row after interruption', () => {
    expect(estimateResumeRow(1, 120, .5)).toBe(61);
    expect(estimateResumeRow(20, 40, 0)).toBe(20);
    expect(estimateResumeRow(20, 40, 1)).toBe(40);
  });
});
