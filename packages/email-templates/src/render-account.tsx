import { renderEmail, type RenderedEmail } from './render.js';
import {
  AccountStatusEmail,
  EmployeeActivationEmail,
  ManagerActivationEmail,
  PasswordResetEmail,
  SecurityNotificationEmail,
  type AccountStatusEmailProps,
  type ActivationEmailProps,
  type PasswordResetEmailProps,
  type SecurityNotificationEmailProps,
} from './account-emails.js';

/**
 * Server-side entry points: the API renders mail through these functions so it never needs React or JSX itself.
 */
export const renderManagerActivation = (p: ActivationEmailProps): Promise<RenderedEmail> =>
  renderEmail(<ManagerActivationEmail {...p} />);
export const renderEmployeeActivation = (p: ActivationEmailProps): Promise<RenderedEmail> =>
  renderEmail(<EmployeeActivationEmail {...p} />);
export const renderPasswordReset = (p: PasswordResetEmailProps): Promise<RenderedEmail> =>
  renderEmail(<PasswordResetEmail {...p} />);
export const renderSecurityNotification = (p: SecurityNotificationEmailProps): Promise<RenderedEmail> =>
  renderEmail(<SecurityNotificationEmail {...p} />);
export const renderAccountStatus = (p: AccountStatusEmailProps): Promise<RenderedEmail> =>
  renderEmail(<AccountStatusEmail {...p} />);
