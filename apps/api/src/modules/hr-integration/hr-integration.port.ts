/**
 * Port for the Smart HRMS adapter (D-09). The real implementation is written once the HRMS API specification is
 * provided; until then only the null adapter exists. Methods are added to this interface from that specification,
 * not guessed. Identity is always the Employee ID.
 */
export interface HrEmployeeSnapshot {
  employeeId: string;
  fullName: string;
  email: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface HrIntegrationPort {
  readonly name: string;
  readonly configured: boolean;
  /** One person from HRMS by Employee ID, or null when HRMS does not know them. */
  findByEmployeeId(employeeId: string): Promise<HrEmployeeSnapshot | null>;
}

export const HR_INTEGRATION = Symbol('HR_INTEGRATION');
