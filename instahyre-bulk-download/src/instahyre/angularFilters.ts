import type { Page } from 'playwright';

export type HideViewedAngularResult =
  | 'enabled'
  | 'already'
  | 'missing'
  | 'no_angular';

export type ApplyFiltersAngularResult =
  | 'applied'
  | 'missing_scope'
  | 'no_angular';

/**
 * tsx/esbuild `keepNames` wraps nested named functions with `__name(...)`, but
 * that helper is not defined in the browser realm when Playwright serializes an
 * evaluate callback. Passing a string to evaluate bypasses esbuild, so we define
 * a global `__name` shim that the serialized callbacks resolve to at runtime.
 */
async function ensureNameShim(page: Page): Promise<void> {
  await page
    .evaluate('window.__name = window.__name || function (f) { return f; };')
    .catch(() => undefined);
}

/**
 * Enable "Hide viewed by me" through Angular ng-model.
 * All logic is inline — page.evaluate only serializes this callback.
 */
export async function enableHideViewedByMeViaAngular(page: Page): Promise<HideViewedAngularResult> {
  await ensureNameShim(page);
  return page.evaluate((): HideViewedAngularResult => {
    const findCheckbox = (): HTMLInputElement | null => {
      const labels = Array.from(document.querySelectorAll('label, div, span, li'));
      for (const el of labels) {
        const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (!/^Hide viewed by me(\s*\(\d+\))?$/i.test(text)) continue;
        const container = el.closest('label, li, div') ?? el.parentElement;
        const input = container?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (input) return input;
      }
      return null;
    };

    const setScopePath = (scope: Record<string, unknown>, path: string, value: unknown): void => {
      const parts = path.split('.');
      let obj: Record<string, unknown> = scope;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i]!;
        if (obj[key] == null || typeof obj[key] !== 'object') {
          obj[key] = {};
        }
        obj = obj[key] as Record<string, unknown>;
      }
      obj[parts[parts.length - 1]!] = value;
    };

    const input = findCheckbox();
    if (!input) return 'missing';

    const angular = (window as unknown as {
      angular?: {
        element: (el: Element) => {
          scope?: () => Record<string, unknown> & { $apply?: (fn?: () => void) => void };
          controller?: (name: string) => { $setViewValue?: (v: unknown) => void; $render?: () => void };
        };
      };
    }).angular;

    if (!angular) return 'no_angular';

    const ngModelAttr = input.getAttribute('ng-model') ?? input.getAttribute('data-ng-model');
    const scope = angular.element(input).scope?.();

    if (scope && ngModelAttr) {
      try {
        const parts = ngModelAttr.split('.');
        let val: unknown = scope;
        for (const key of parts) {
          val = (val as Record<string, unknown>)[key];
        }
        if (val === true) return 'already';

        setScopePath(scope, ngModelAttr, true);
        scope.$apply?.();
        return 'enabled';
      } catch {
        // fall through
      }
    }

    const ngModelCtrl = angular.element(input).controller?.('ngModel');
    if (ngModelCtrl && typeof ngModelCtrl.$setViewValue === 'function') {
      if (input.checked) return 'already';
      ngModelCtrl.$setViewValue(true);
      ngModelCtrl.$render?.();
      scope?.$apply?.();
      return 'enabled';
    }

    if (input.checked) return 'already';
    input.click();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    scope?.$apply?.();
    return 'enabled';
  });
}

/**
 * Call applyFilters() on an ancestor Angular scope — bypasses disabled Apply div.
 * All logic is inline for page.evaluate serialization.
 */
export async function invokeApplyFiltersViaAngular(page: Page): Promise<ApplyFiltersAngularResult> {
  await ensureNameShim(page);
  return page.evaluate((): ApplyFiltersAngularResult => {
    const angular = (window as unknown as {
      angular?: {
        element: (el: Element) => {
          scope?: () => Record<string, unknown> & {
            $apply?: (fn?: () => void) => void;
            $parent?: Record<string, unknown>;
            applyFilters?: () => void;
            disableFilterButton?: boolean;
          };
        };
      };
    }).angular;

    if (!angular) return 'no_angular';

    const findApply = (): HTMLElement | null => {
      for (const selector of [
        'div.filter-footer .btn-success',
        'div.filter-footer [ng-click*="applyFilters"]',
      ]) {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (el) return el;
      }
      const drawer = document.querySelector('.sliding-filters.active, div.sliding-filters.active');
      return drawer?.parentElement?.querySelector(
        'div.filter-footer .btn-success, div.filter-footer [ng-click*="applyFilters"]',
      ) as HTMLElement | null;
    };

    const findCheckbox = (): HTMLInputElement | null => {
      const labels = Array.from(document.querySelectorAll('label, div, span, li'));
      for (const el of labels) {
        const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (!/^Hide viewed by me(\s*\(\d+\))?$/i.test(text)) continue;
        const container = el.closest('label, li, div') ?? el.parentElement;
        const input = container?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (input) return input;
      }
      return null;
    };

    type Scope = Record<string, unknown> & {
      $apply?: (fn?: () => void) => void;
      $parent?: Scope;
      applyFilters?: () => void;
      disableFilterButton?: boolean;
    };

    const anchors: Element[] = [];
    const applyEl = findApply();
    const drawer = document.querySelector('.sliding-filters.active, div.sliding-filters.active');
    const checkbox = findCheckbox();
    if (applyEl) anchors.push(applyEl);
    if (drawer) anchors.push(drawer);
    if (checkbox) anchors.push(checkbox);

    for (const anchor of anchors) {
      let scope = angular.element(anchor).scope?.() as Scope | undefined;
      while (scope) {
        if (typeof scope.applyFilters === 'function') {
          const run = () => {
            scope!.disableFilterButton = false;
            scope!.applyFilters!();
          };
          if (typeof scope.$apply === 'function') {
            scope.$apply(run);
          } else {
            run();
          }
          return 'applied';
        }
        scope = scope.$parent;
      }
    }

    return 'missing_scope';
  });
}
