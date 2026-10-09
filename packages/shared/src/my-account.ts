/** The signed-in person's own account details ("My account"). Read-only; every role can open it. */
export interface MyAccount {
  fullName: string;
  employeeCode: string;
  email: string;
  role: string;
  status: string;
  /** SmartClues Login Name (the "Client Login"), when the person has one. */
  loginName: string | null;
  vendor: { id: string; name: string } | null;
  /** Current team and its Team Lead. */
  team: { id: string; name: string; teamLead: string | null } | null;
  /** Projects the person is currently staffed on. */
  projects: { id: string; name: string; client: string; projectRole: string }[];
  /** When the account was activated (first password set). */
  activatedAt: string | null;
  createdAt: string;
}
