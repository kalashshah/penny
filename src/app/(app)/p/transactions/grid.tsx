'use client';

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';

ModuleRegistry.registerModules([AllCommunityModule]);

export interface TxRow {
  date: string;
  who: string;
  note: string;
  amount: number;
  currency: string;
  fee: number | null;
  status: string;
  id: string;
  invoice: string;
}

const theme = themeQuartz.withParams({
  fontFamily: '"General Sans", Inter, system-ui, sans-serif',
  backgroundColor: '#FFFFFF',
  foregroundColor: '#1C1C1C',
  headerBackgroundColor: '#F4F2EF',
  headerTextColor: '#838180',
  borderColor: '#E6E2DE',
  rowHoverColor: '#FAF8F7',
  wrapperBorderRadius: 12,
  headerFontSize: 11,
  fontSize: 14,
});

const columns: ColDef<TxRow>[] = [
  { field: 'date', maxWidth: 120 },
  { field: 'who', headerName: 'Counterparty' },
  { field: 'note' },
  {
    field: 'amount',
    type: 'numericColumn',
    maxWidth: 140,
    valueFormatter: (p) => (p.value == null || !p.data ? '' : `${p.value < 0 ? '-' : ''}${p.data.currency} ${Math.abs(p.value).toFixed(2)}`),
    cellStyle: (p) => ({ color: p.value < 0 ? '#C8433B' : '#0B6E77', fontWeight: 600 }),
  },
  { field: 'fee', type: 'numericColumn', maxWidth: 100, valueFormatter: (p) => (p.value == null ? '' : p.value.toFixed(2)) },
  { field: 'status', maxWidth: 120 },
  { field: 'invoice', maxWidth: 140 },
  { field: 'id', headerName: 'Transaction id', maxWidth: 200 },
];

export function TransactionsGrid({ rows }: { rows: TxRow[] }) {
  return (
    <div style={{ height: 520 }}>
      <AgGridReact<TxRow> theme={theme} rowData={rows} columnDefs={columns} defaultColDef={{ sortable: true, filter: true, resizable: true, flex: 1 }} />
    </div>
  );
}
