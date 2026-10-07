import { humanDuration } from './mail.service';
import { MemoryMailTransport } from './transports';

describe('humanDuration', () => {
  it.each([
    [30 * 60_000, '30 minutes'],
    [60 * 60_000, '1 hour'],
    [72 * 60 * 60_000, '3 days'],
    [90 * 60_000, '90 minutes'],
    [60_000, '1 minute'],
  ])('%d ms → %s', (ms, text) => expect(humanDuration(ms)).toBe(text));
});

describe('MemoryMailTransport', () => {
  it('keeps the outbox and finds the latest message to an address', async () => {
    const t = new MemoryMailTransport();
    await t.send(
      { to: 'a@example.test', subject: 'one', html: '', text: '', category: 'x' },
      'from@example.test',
    );
    await t.send(
      { to: 'a@example.test', subject: 'two', html: '', text: '', category: 'x' },
      'from@example.test',
    );
    expect(t.lastTo('A@example.test')?.subject).toBe('two');
    t.clear();
    expect(t.outbox).toHaveLength(0);
  });
});
