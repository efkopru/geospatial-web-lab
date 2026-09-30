import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InspectionCard } from '../05-infrastructure-inspections/frontend/src/App.jsx';

const shared = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@geo/shared', () => ({ api: shared.api }));
vi.mock('../05-infrastructure-inspections/frontend/src/CorridorViewer.jsx', () => ({ default: () => null }));

const inspection = { id: 9, status: 'open', severity: 'high', observed_at: '2026-09-29T12:00:00Z', notes: 'Connection needs repair.', author_name: 'Inspector', events: [], lock_version: 0 };
beforeEach(() => shared.api.mockReset().mockResolvedValue({}));
afterEach(cleanup);

it('preserves the original resolution intent when a live update changes the observation', async () => {
  const onChange = vi.fn();
  const view = render(<InspectionCard inspection={inspection} staff onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Resolve observation' }));
  fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Connection repaired and checked.' } });
  view.rerender(<InspectionCard inspection={{ ...inspection, status: 'resolved', lock_version: 1 }} staff onChange={onChange} />);
  expect(screen.getByRole('alert')).toHaveTextContent('changed while you were editing');
  expect(screen.getByLabelText('Resolution notes')).toHaveValue('Connection repaired and checked.');
  expect(screen.getByRole('button', { name: 'Save status change' })).toBeDisabled();
  fireEvent.submit(screen.getByLabelText('Resolution notes').closest('form'));
  expect(shared.api).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reopen observation' }));
  fireEvent.change(screen.getByLabelText('Reason for reopening'), { target: { value: 'Follow-up inspection found recurrence.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save status change' }));
  await waitFor(() => expect(shared.api).toHaveBeenCalledWith('/api/inspections/9', { method: 'PATCH', body: { inspection: { status: 'open', resolution_notes: 'Follow-up inspection found recurrence.', lock_version: 1 } } }));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
});

it('submits the version and status captured when the editor was opened', async () => {
  render(<InspectionCard inspection={inspection} staff onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Resolve observation' }));
  fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Connection inspected and repaired.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save status change' }));
  await waitFor(() => expect(shared.api).toHaveBeenCalledWith('/api/inspections/9', { method: 'PATCH', body: { inspection: { status: 'resolved', resolution_notes: 'Connection inspected and repaired.', lock_version: 0 } } }));
});
