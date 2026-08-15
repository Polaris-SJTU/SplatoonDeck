const CONTROLLER_UI_SELECTOR = [
  'button', 'input', 'select', 'textarea', 'label', 'a',
  '[contenteditable="true"]', '.analog-base', '.mapping-dialog'
].join(', ');

type ClosestTarget = {
  closest(selectors: string): unknown;
};

export function isControllerUiTarget(target: EventTarget | null): boolean {
  const candidate = target as Partial<ClosestTarget> | null;
  return typeof candidate?.closest === 'function' && Boolean(candidate.closest(CONTROLLER_UI_SELECTOR));
}
