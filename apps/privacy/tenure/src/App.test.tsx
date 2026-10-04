import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

describe('Tenure app (integration, added after the UI)', () => {
  it('renders the lineage map with every system as a focusable node and shows the open-finding count', () => {
    render(<App />);
    const map = screen.getByRole('group', { name: /Lineage map/ });
    expect(map).toHaveAccessibleName(/12 systems/);
    expect(within(map).getAllByRole('button')).toHaveLength(12);
    expect(screen.getByRole('tab', { name: /Findings \(\d+ open\)/ })).toBeInTheDocument();
  });

  it('selecting a system node updates the inspector', async () => {
    const user = userEvent.setup();
    render(<App />);
    const map = screen.getByRole('group', { name: /Lineage map/ });
    await user.click(within(map).getByRole('button', { name: /^Campaign Platform/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Campaign Platform' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Campaign Platform selected.');
  });

  it('accepting a finding with an exception marks it accepted and lowers the open count', async () => {
    const user = userEvent.setup();
    render(<App />);
    const before = Number(screen.getByRole('tab', { name: /Findings/ }).textContent!.match(/\((\d+) open\)/)![1]);
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('RETENTION_INFLATION') && within(r).queryByRole('button', { name: 'Accept with exception' }))!;
    await user.click(within(row).getByRole('button', { name: 'Accept with exception' }));
    await user.type(screen.getByLabelText(/Rationale/), 'Vendor contract renegotiation in progress, synthetic rationale.');
    await user.click(screen.getByRole('button', { name: 'Record exception' }));
    const after = Number(screen.getByRole('tab', { name: /Findings/ }).textContent!.match(/\((\d+) open\)/)![1]);
    expect(after).toBe(before - 1);
    // ex-001..ex-004 ship in the fixture (ex-004, a flow exception, was added in October 2026), so the next id is ex-005.
    expect(screen.getByRole('status')).toHaveTextContent(/Exception ex-005 recorded for element/);
  });

  it('offers the exception dialog for a flow-subject finding and records a flow exception (October 2026 round)', async () => {
    const user = userEvent.setup();
    render(<App />);
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('UNMAPPED_TRANSFER') && within(r).queryByRole('button', { name: 'Accept with exception' }));
    expect(row).toBeDefined();
    await user.click(within(row!).getByRole('button', { name: 'Accept with exception' }));
    await user.type(screen.getByLabelText(/Rationale/), 'Transfer impact assessment under way; interim clauses signed (synthetic rationale).');
    await user.click(screen.getByRole('button', { name: 'Record exception' }));
    expect(screen.getByRole('status')).toHaveTextContent(/recorded for flow flow-crm-marketing \(UNMAPPED_TRANSFER\)/);
  });

  it('marking an overdue element as reviewed removes it from the overdue list', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /Retention review calendar/ }));
    const tab = screen.getByRole('tab', { name: /Retention review calendar/ });
    const before = Number(tab.textContent!.match(/\((\d+) overdue\)/)![1]);
    await user.click(screen.getAllByRole('button', { name: 'Mark reviewed today' })[0]!);
    expect(Number(tab.textContent!.match(/\((\d+) overdue\)/)![1])).toBe(before - 1);
  });

  it('import rejects unknown vocabulary with a precise message', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Import catalog' }));
    await user.click(screen.getByLabelText('Or paste JSON'));
    await user.paste('{"schema":"tenure.catalog","version":1,"asOf":"2026-10-01","owners":[],"systems":[{"id":"a","name":"A","region":"Mars","hosting":"internal","purposes":[]}],"schedules":[],"elements":[],"flows":[],"exceptions":[]}');
    await user.click(screen.getByRole('button', { name: 'Validate and import' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/region "Mars" is not a known region or synonym/);
  });
});
