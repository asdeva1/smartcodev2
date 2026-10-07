/**
 * User-facing terminology (decision D-16).
 * "SPC" is displayed exactly as "SPC" — its full form is intentionally not expanded or assumed.
 * Labels can later be overridden from organization settings without schema or architecture changes.
 */
export const DEFAULT_TERMINOLOGY = {
  SPC: 'SPC',
  VENDOR: 'Vendor',
  LOGIN_NAME: 'SmartClues Login Name',
  EMPLOYEE_ID: 'Employee ID',
  CHART_ID: 'Chart ID',
} as const;

export type TermKey = keyof typeof DEFAULT_TERMINOLOGY;
export type TerminologyOverrides = Partial<Record<TermKey, string>>;

export function term(key: TermKey, overrides?: TerminologyOverrides): string {
  const override = overrides?.[key]?.trim();
  return override ? override : DEFAULT_TERMINOLOGY[key];
}
