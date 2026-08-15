import { describe, expect, it, vi } from 'vitest';
import { isControllerUiTarget } from './controller-input-target';

describe('controller keyboard and mouse event targeting', () => {
  it('keeps form controls out of global controller mappings', () => {
    for (const tag of ['input', 'select', 'textarea', 'label', 'button']) {
      const closest = vi.fn((selector: string) => selector.includes(tag) ? { tag } : null);
      expect(isControllerUiTarget({ closest } as unknown as EventTarget)).toBe(true);
    }
  });

  it('allows controller mappings on non-interactive page areas', () => {
    expect(isControllerUiTarget({ closest: () => null } as unknown as EventTarget)).toBe(false);
    expect(isControllerUiTarget(null)).toBe(false);
  });
});
