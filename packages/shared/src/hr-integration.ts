/**
 * Smart HRMS integration boundary (decision D-09). No HRMS API specification has been provided, so SmartCode defines
 * only the boundary: what it would need from an HR system and where it would plug in. Nothing here invents an API,
 * and nothing is synchronised. Identity is matched on Employee ID (`employeeCode`).
 */

export interface HrIntegrationPoint {
  key: string;
  title: string;
  /** What SmartCode would do with the data once an adapter exists. */
  purpose: string;
  direction: 'HRMS_TO_SMARTCODE' | 'SMARTCODE_TO_HRMS';
}

export interface HrIntegrationStatus {
  /** False until a real adapter is installed. */
  configured: boolean;
  adapter: string;
  identity: 'EMPLOYEE_ID';
  message: string;
  points: HrIntegrationPoint[];
}

/** The documented integration points. Adding one needs the real HRMS specification first. */
export const HR_INTEGRATION_POINTS: readonly HrIntegrationPoint[] = [
  {
    key: 'employee-master',
    title: 'Employee master data',
    purpose: 'Compare name, email, joining date and status of a person, matched on Employee ID.',
    direction: 'HRMS_TO_SMARTCODE',
  },
  {
    key: 'separations',
    title: 'Resignations and separations',
    purpose: 'Raise an employee deactivation request for the Manager when HRMS records a separation.',
    direction: 'HRMS_TO_SMARTCODE',
  },
  {
    key: 'attendance',
    title: 'Attendance',
    purpose: 'Read attendance for productivity reports. Not part of the coding workflow.',
    direction: 'HRMS_TO_SMARTCODE',
  },
  {
    key: 'activation-events',
    title: 'Account events',
    purpose: 'Tell HRMS when an account is activated or deactivated in SmartCode.',
    direction: 'SMARTCODE_TO_HRMS',
  },
];
