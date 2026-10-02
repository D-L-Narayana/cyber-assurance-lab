import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

describe('Firstlight app (integration, added after the UI)', () => {
  it('shows the 72-hour clock within window at the fixed demo time and the sequence issue for the duplicate event', () => {
    render(<App />);
    const chips = screen.getByRole('list', { name: 'Jurisdiction clocks' });
    expect(chips).toHaveTextContent(/EU-GDPR: 23\.5 h left of 72 hours/);
    expect(screen.getByRole('list', { name: 'Sequence issues' })).toHaveTextContent('DUPLICATE_EVENT');
  });

  it('moving "now" past the deadline flips the clock to exceeded', () => {
    render(<App />);
    const input = screen.getByLabelText(/Now \(UTC\)/);
    // jsdom does not type into datetime-local inputs; dispatch the change directly.
    fireEvent.change(input, { target: { value: '2026-09-25T12:00' } });
    expect(screen.getByRole('list', { name: 'Jurisdiction clocks' })).toHaveTextContent(/72 hours exceeded by 48\.5 h/);
  });

  it('changing a circumstance factor recomputes the severity formula', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(document.querySelector('.sev .se')).toHaveTextContent('SE 2.25');
    await user.selectOptions(screen.getByLabelText('Confidentiality loss'), 'unknown-recipients');
    expect(document.querySelector('.sev .se')).toHaveTextContent('SE 2.5');
  });

  it('filling a missing fact increases readiness', async () => {
    const user = userEvent.setup();
    render(<App />);
    const before = screen.getByRole('heading', { name: /Notification-readiness packet/ }).textContent;
    await user.type(screen.getByLabelText('Likely consequences for individuals'), 'Phishing risk for affected customers.');
    const after = screen.getByRole('heading', { name: /Notification-readiness packet/ }).textContent;
    expect(after).not.toBe(before);
  });

  it('redaction toggle hides personal tokens in the packet preview', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByLabelText('Packet preview, redacted')).not.toHaveTextContent('Priya Oduya');
    await user.click(screen.getByRole('switch', { name: /Redaction preview/ }));
    const full = screen.getByLabelText('Packet preview, full');
    expect(full).toBeInTheDocument();
    expect(screen.getByText(/Escalated to the incident lead Priya Oduya/)).toBeInTheDocument();
  });

  it('a containment task needs an evidence reference to be marked done', async () => {
    const user = userEvent.setup();
    render(<App />);
    const table = screen.getByRole('region', { name: 'Containment tasks table' });
    const row = within(table).getAllByRole('row').find((r) => r.textContent?.includes('ct-4'))!;
    expect(within(row).getByRole('button', { name: 'Mark done' })).toBeDisabled();
    await user.type(within(row).getByLabelText(/Evidence reference for Review vendor mail-archive/), 'archive-check-7731');
    await user.click(within(row).getByRole('button', { name: 'Mark done' }));
    expect(within(row).getByText('done')).toBeInTheDocument();
  });
});
