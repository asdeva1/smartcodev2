export interface MailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  /** Machine label for logs/metrics, e.g. `activation`. Never contains addresses or links. */
  category: string;
}

export interface MailTransport {
  readonly name: 'ses' | 'smtp' | 'file' | 'memory';
  send(message: MailMessage, from: string): Promise<void>;
}
