import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

describe('Consentry app (integration, added after the UI)', () => {
  it('shows an ALLOW stamp for the default scenario with the consent record marked as used', () => {
    render(<App />);
    const stamps = screen.getAllByRole('status').filter((el) => el.classList.contains('stamp'));
    expect(stamps[0]).toHaveTextContent(/ALLOW/);
    expect(stamps[0]).toHaveTextContent('CONSENT_VALID');
    expect(screen.getByText('USED')).toBeInTheDocument();
  });

  it('flipping the GPC switch on a Californian sale/share purpose turns the decision to DENY', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('Subject'), 'sub-ca-jonah');
    await user.selectOptions(screen.getByLabelText('Purpose'), 'ad-partner-sharing');
    let stamp = screen.getAllByRole('status').find((el) => el.classList.contains('stamp'));
    expect(stamp).toHaveTextContent('NOTICE_AND_OPT_OUT');
    await user.click(screen.getByRole('switch', { name: /GPC/ }));
    stamp = screen.getAllByRole('status').find((el) => el.classList.contains('stamp'));
    expect(stamp).toHaveTextContent(/DENY/);
    expect(stamp).toHaveTextContent('GPC_OPT_OUT');
  });

  it('comparison mode renders two ladders and highlights the differing rung', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Consent withdrawn yesterday' }));
    expect(screen.getByRole('region', { name: /What if: withdrawal recorded/ })).toBeInTheDocument();
    const differs = document.querySelectorAll('.rung.differs');
    expect(differs.length).toBeGreaterThan(0);
  });

  it('disabling a rule in the coverage tab breaks the regression suite and reports which expectation failed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /Rule coverage/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Enable R06-gpc-signal' }));
    await user.click(screen.getByRole('tab', { name: /Policy regression suite/ }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('status')).toHaveTextContent(/1 of 21 expectations fail/);
    expect(within(panel).getByRole('status')).toHaveTextContent(/ev-11/);
  });

  it('adding a withdrawal before the event flips the default scenario to DENY', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('Status'), 'withdrawn');
    await user.click(screen.getByRole('button', { name: 'Add record' }));
    const stamp = screen.getAllByRole('status').find((el) => el.classList.contains('stamp'));
    expect(stamp).toHaveTextContent('CONSENT_WITHDRAWN');
  });

  it('renders the record-regime rung: a UK subject whose grant was captured under the EU notice gets REVIEW', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('Subject'), 'sub-uk-imogen');
    const stamp = screen.getAllByRole('status').find((el) => el.classList.contains('stamp'));
    expect(stamp).toHaveTextContent(/REVIEW/);
    expect(stamp).toHaveTextContent('RECORD_REGIME_MISMATCH');
    expect(screen.getByText('R09a-record-regime · matched')).toBeInTheDocument();
  });

  it('rejects a malformed workspace import with field-level errors', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Import workspace' }));
    await user.click(screen.getByLabelText('Or paste JSON'));
    await user.paste('{"schema":"consentry.workspace","version":1,"policy":{},"purposes":[],"subjects":[],"records":[],"events":[]}');
    await user.click(screen.getByRole('button', { name: 'Validate and import' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/policy\.id is required/);
  });
});
