import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

describe('Forethought app (integration, added after the UI)', () => {
  it('shows the demo as high inherent risk with no sign-off blockers', () => {
    render(<App />);
    expect(screen.getByText('No blockers. The assessment can be signed.')).toBeInTheDocument();
    const overall = screen.getAllByText('Inherent').map((el) => el.closest('span')!).find((el) => el.classList.length === 0 || el.textContent?.includes('Inherent'))!;
    expect(overall).toHaveTextContent(/Inherent\s*high/);
  });

  it('changing an answer reveals a follow-up question and can introduce a blocker', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByText('What age-assurance approach is used?')).toBeInTheDocument();
    await user.click(screen.getByLabelText(/No, adults only with controls in place/));
    expect(screen.queryByText('What age-assurance approach is used?')).toBeNull();
    await user.click(screen.getByLabelText(/Automated decisions with legal or similarly significant effects/));
    const list = screen.getByRole('list', { name: 'Sign-off blockers' });
    expect(within(list).getAllByRole('listitem').some((li) => li.textContent?.includes('HIGH_RESIDUAL_WITHOUT_ACCEPTANCE'))).toBe(true);
  });

  it('signing binds a hash; editing afterwards marks the signature stale', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Signer name'), 'Tamsin Reyes');
    await user.click(screen.getByRole('button', { name: 'Sign as product-owner' }));
    await waitFor(() => expect(screen.getByText(/^Current: product-owner Tamsin Reyes/)).toBeInTheDocument());
    await user.click(screen.getByLabelText(/More than 1 million/));
    await waitFor(() => expect(screen.getByText(/^Stale — content changed since signing/)).toBeInTheDocument());
  });

  it('refuses to sign while blockers exist and explains why', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('Load fixture'), 'vh');
    await user.click(screen.getByRole('button', { name: 'Sign as product-owner' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Sign-off blocked by \d+ issue/);
  });

  it('switching audience shows the executive summary', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('radio', { name: 'Executive' }));
    expect(screen.getByText(/Recommendation feature for the storefront \(PIA-2026-014\) is assessed at high inherent privacy risk/)).toBeInTheDocument();
  });

  it('marking an evidence-required mitigation verified without a reference does not count and blocks', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText('Status of Signed data-processing agreements with every recipient'), 'verified');
    expect(screen.getByText(/Marked verified without an evidence reference/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Sign-off blockers' });
    expect(list).toHaveTextContent('EVIDENCE_MISSING');
  });
});
