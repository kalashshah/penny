'use client';

// Penny's reports page: one AG Studio instance over the tenant's live PayPal data (src/reports.ts shapes it,
// page.tsx loads it). Penny opens a page of it on screen during calls (?page=receivables); the owner can
// switch to edit mode, rearrange widgets, or ask the AI assistant (OpenAI, proxied by ai/responses/route.ts) for new ones.
// Browser-only: reports-client.tsx loads it with ssr disabled.

import { useMemo, useRef, useState } from 'react';
import {
  AgStudioAiModule,
  createAiHarness,
  studioTheme,
  type AgAiHarnessSetup,
  type AgDataSourcesDefinition,
  type AgFieldDefinition,
  type AgFormat,
  type AgPageState,
  type AgReportState,
  type AgStudioApi,
  type AgStudioMode,
  type AgWidgetLayoutState,
} from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import type { ReportData, ReportPage } from '@/reports';
import { openaiAdapter } from './openai-adapter';

export interface Boot {
  data: ReportData;
  page: ReportPage;
  pageKey: string;
  licenseKey?: string;
  aiModel?: string;
}

// ---- data sources ------------------------------------------------------------------

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];
const fields = (specs: FieldSpec[]): AgFieldDefinition[] => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));

function sources(d: ReportData): AgDataSourcesDefinition {
  const dates = [...d.invoices.map((i) => i.invoiceDate), ...d.transactions.map((t) => t.date.slice(0, 10))].filter((x): x is string => !!x).sort();
  const today = d.asOf.slice(0, 10);
  return {
    description:
      `PayPal books of ${d.business}, a small business, as Penny (its AI CFO) sees them. Amounts are in ${d.currency}. ` +
      'Invoices are what the business billed its customers; transactions are the PayPal account ledger for the last 31 days; disputes are customer chargebacks and claims.',
    sources: [
      {
        id: 'customers',
        description: 'Who the business invoices, keyed by lower-cased email.',
        data: d.customers,
        fields: fields([
          ['id', 'Customer ID', 'textFormat', true],
          ['name', 'Customer', 'textFormat'],
          ['email', 'Customer email', 'textFormat'],
        ]),
      },
      {
        id: 'invoices',
        description: 'One row per invoice. Outstanding, overdue and aging apply only to open or partially paid invoices; paid is what has been received against each.',
        data: d.invoices,
        fields: fields([
          ['id', 'Invoice ID', 'textFormat', true],
          ['number', 'Invoice', 'textFormat'],
          ['customerId', 'Customer ID', 'textFormat', true],
          ['status', 'Status', 'textFormat'],
          ['isOpen', 'Is open', 'booleanFormat'],
          ['invoiceDate', 'Invoice date', 'dateFormat'],
          ['dueDate', 'Due date', 'dateFormat'],
          ['paidDate', 'Paid on', 'dateFormat'],
          ['total', 'Invoiced', 'currencyFormat'],
          ['paid', 'Paid', 'currencyFormat'],
          ['outstanding', 'Outstanding', 'currencyFormat'],
          ['overdue', 'Overdue', 'currencyFormat'],
          ['daysOverdue', 'Days late', 'integerFormat'],
          ['aging', 'Aging', 'textFormat'],
          ['memo', 'What for', 'textFormat'],
        ]),
      },
      {
        id: 'transactions',
        description: 'PayPal ledger, last 31 days. Amount is signed (money out is negative); fee is negative; net is amount plus fee.',
        data: d.transactions,
        fields: fields([
          ['id', 'Transaction ID', 'textFormat'],
          ['date', 'Date', 'dateTimeFormat'],
          ['kind', 'Type', 'textFormat'],
          ['status', 'Transaction status', 'textFormat'],
          ['direction', 'In or out', 'textFormat'],
          ['counterparty', 'Counterparty', 'textFormat'],
          ['note', 'Note', 'textFormat'],
          ['amount', 'Amount', 'currencyFormat'],
          ['fee', 'Fee', 'currencyFormat'],
          ['net', 'Net', 'currencyFormat'],
        ]),
      },
      {
        id: 'disputes',
        description: 'Customer disputes and chargebacks on PayPal payments.',
        data: d.disputes,
        fields: fields([
          ['id', 'Dispute ID', 'textFormat'],
          ['reason', 'Reason', 'textFormat'],
          ['status', 'Dispute status', 'textFormat'],
          ['amount', 'Disputed', 'currencyFormat'],
          ['openedOn', 'Opened', 'dateFormat'],
          ['respondBy', 'Respond by', 'dateFormat'],
          ['buyer', 'Buyer', 'textFormat'],
        ]),
      },
    ],
    relationships: [
      { id: 'invoice-customer', source: { tableId: 'invoices', fieldId: 'customerId' }, target: { tableId: 'customers', fieldId: 'id' }, type: 'many-to-one' },
      { id: 'invoices-calendar', source: { tableId: 'invoices', fieldId: 'invoiceDate' }, target: { calendarId: 'calendar' } },
      { id: 'transactions-calendar', source: { tableId: 'transactions', fieldId: 'date' }, target: { calendarId: 'calendar' }, truncate: 'day' },
    ],
    calendars: [
      {
        id: 'calendar',
        label: 'Calendar',
        range: { from: { type: 'date', value: dates[0] ?? today }, to: { type: 'date', value: dates.at(-1) ?? today } },
        fragments: ['year', 'quarter', 'month', 'week', 'day'],
      },
    ],
    expressions: [
      {
        id: 'collectionRate',
        name: 'Collection rate',
        description: 'Paid / invoiced.',
        format: 'percentageFormat',
        isMeasure: true,
        expression: { operator: 'divide', inputs: [{ id: 'invoices.paid', aggregation: 'sum' }, { id: 'invoices.total', aggregation: 'sum' }] },
      },
    ],
  };
}

// ---- the built-in report: one page per thing Penny talks about -----------------------

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const countd = (id: string) => ({ id, aggregation: 'countd' as const });
const FONT = '"General Sans", system-ui, sans-serif';
const kpi = (text: string, value: { id: string; aggregation?: 'sum' | 'countd' }) => ({
  type: 'value' as const,
  dataMapping: { value: [value] },
  format: {
    title: { enabled: true, text, typography: { fontFamily: FONT, fontSize: 13, fontWeight: 'bold' as const, fontStyle: 'normal' as const } },
    style: { typography: { fontFamily: FONT, fontSize: 26, fontWeight: 'normal' as const, fontStyle: 'normal' as const } },
  },
});
const legend = { style: { theme: { common: { legend: { enabled: true } } } } };

const overview: AgPageState = {
  id: 'overview',
  widgets: {
    'kpi-invoiced': kpi('Invoiced', sum('invoices.total')),
    'kpi-collected': kpi('Collected', sum('invoices.paid')),
    'kpi-outstanding': kpi('Outstanding', sum('invoices.outstanding')),
    'kpi-overdue': kpi('Overdue', sum('invoices.overdue')),
    'billed-vs-collected': {
      type: 'combo-chart-grouped-column-line',
      dataMapping: { categoryKey: [{ id: 'calendar::month' }], valueKey: [sum('invoices.total'), sum('invoices.paid')], secondaryValueKey: [{ id: 'collectionRate' }] },
      format: { ...title('Billed and collected by invoice month, with collection rate'), ...legend },
    },
    'collection-rate': {
      type: 'radial-gauge',
      dataMapping: { value: [{ id: 'collectionRate' }] },
      format: { ...title('Collection rate'), style: { scaleLabel: { min: 0, max: 1 }, secondaryLabel: { enabled: true, text: 'of everything billed is paid' } } },
    },
    'by-customer': {
      type: 'bar-chart-stacked',
      dataMapping: { categoryKey: [{ id: 'customers.name' }], valueKey: [sum('invoices.paid'), sum('invoices.outstanding')] },
      format: { ...title('Paid and still owed, by customer'), ...legend },
    },
    'by-status': {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'invoices.status' }], valueKey: [sum('invoices.total')] },
      format: title('Invoice value by status'),
    },
  },
  widgetLayout: {
    'kpi-invoiced': at(0, 0, 6, 7),
    'kpi-collected': at(6, 0, 6, 7),
    'kpi-outstanding': at(12, 0, 6, 7),
    'kpi-overdue': at(18, 0, 6, 7),
    'billed-vs-collected': at(0, 7, 16, 18),
    'collection-rate': at(16, 7, 8, 18),
    'by-customer': at(0, 25, 14, 18),
    'by-status': at(14, 25, 10, 18),
  },
};

const receivables: AgPageState = {
  id: 'receivables',
  widgets: {
    'kpi-outstanding': kpi('Outstanding', sum('invoices.outstanding')),
    'kpi-overdue': kpi('Overdue', sum('invoices.overdue')),
    'kpi-open': kpi('Open invoices', countd('invoices.id')),
    'kpi-customers': kpi('Customers owing', countd('invoices.customerId')),
    'aging-by-customer': {
      type: 'column-chart-stacked',
      dataMapping: { categoryKey: [{ id: 'customers.name' }], valueKey: [sum('invoices.outstanding')], legendKey: [{ id: 'invoices.aging' }] },
      format: { ...title('Who owes us, and how late'), ...legend },
    },
    aging: {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'invoices.aging' }], valueKey: [sum('invoices.outstanding')] },
      format: title('Outstanding by age'),
    },
    'open-invoices': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'invoices.number' },
          { id: 'customers.name' },
          { id: 'invoices.memo' },
          { id: 'invoices.dueDate' },
          { id: 'invoices.daysOverdue' },
          sum('invoices.total'),
          sum('invoices.paid'),
          sum('invoices.outstanding'),
        ],
      },
      sort: [{ field: { id: 'invoices.daysOverdue' }, direction: 'desc' }],
      format: title('Open invoices, most overdue first'),
    },
  },
  widgetLayout: {
    'kpi-outstanding': at(0, 0, 6, 7),
    'kpi-overdue': at(6, 0, 6, 7),
    'kpi-open': at(12, 0, 6, 7),
    'kpi-customers': at(18, 0, 6, 7),
    'aging-by-customer': at(0, 7, 16, 18),
    aging: at(16, 7, 8, 18),
    'open-invoices': at(0, 25, 24, 18),
  },
  filter: { page: [{ field: { id: 'invoices.isOpen' }, model: { operator: 'isTrue' } }] },
};

const cash: AgPageState = {
  id: 'cash',
  widgets: {
    'kpi-net': kpi('Net movement (31 days)', sum('transactions.net')),
    'kpi-fees': kpi('PayPal fees', sum('transactions.fee')),
    'kpi-disputed': kpi('Disputed', sum('disputes.amount')),
    'kpi-disputes': kpi('Disputes', countd('disputes.id')),
    'net-by-day': {
      type: 'column-chart-stacked',
      dataMapping: { categoryKey: [{ id: 'calendar::day' }], valueKey: [sum('transactions.net')], legendKey: [{ id: 'transactions.kind' }] },
      format: { ...title('Net money movement by day and type'), ...legend },
    },
    'by-kind': {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'transactions.kind' }], valueKey: [countd('transactions.id')] },
      format: title('Transactions by type'),
    },
    ledger: {
      type: 'grid',
      dataMapping: {
        cols: [{ id: 'transactions.date' }, { id: 'transactions.kind' }, { id: 'transactions.counterparty' }, { id: 'transactions.note' }, { id: 'transactions.status' }, sum('transactions.amount'), sum('transactions.fee'), sum('transactions.net')],
      },
      sort: [{ field: { id: 'transactions.date' }, direction: 'desc' }],
      format: title('PayPal ledger'),
    },
    disputes: {
      type: 'grid',
      dataMapping: { cols: [{ id: 'disputes.openedOn' }, { id: 'disputes.reason' }, { id: 'disputes.status' }, { id: 'disputes.respondBy' }, sum('disputes.amount')] },
      format: title('Disputes'),
    },
  },
  widgetLayout: {
    'kpi-net': at(0, 0, 6, 7),
    'kpi-fees': at(6, 0, 6, 7),
    'kpi-disputed': at(12, 0, 6, 7),
    'kpi-disputes': at(18, 0, 6, 7),
    'net-by-day': at(0, 7, 16, 18),
    'by-kind': at(16, 7, 8, 18),
    ledger: at(0, 25, 15, 20),
    disputes: at(15, 25, 9, 20),
  },
};

const PAGES: { id: ReportPage; label: string; state: AgPageState }[] = [
  { id: 'overview', label: 'Overview', state: overview },
  { id: 'receivables', label: 'Who owes us', state: receivables },
  { id: 'cash', label: 'Cash & disputes', state: cash },
];

// ---- theme: Penny's own tokens (src/app/app.css) ----------------------------------------

// Series colours in order: settled money teal, money still owed amber, then Penny's green, red, grey.
const PALETTE = ['#0B6E77', '#E0A030', '#2FA84F', '#C8433B', '#838180', '#6B5CA5', '#CDF034', '#474644'];

const theme = studioTheme.withParams({
  ...Object.fromEntries(PALETTE.flatMap((c, i) => [[`chartPaletteFills${i + 1}Color`, c], [`chartPaletteStrokes${i + 1}Color`, c]])),
  fontFamily: FONT,
  fontSize: 14,
  textColor: '#1C1C1C',
  foregroundColor: '#1C1C1C',
  subtleTextColor: '#838180',
  backgroundColor: '#FFFFFF',
  borderColor: '#E6E2DE',
  accentColor: '#0B6E77',
  rowHoverColor: '#F4F2EF',
  studioWrapperBorder: false,
  studioWrapperBackgroundColor: '#FAF8F7',
  studioCanvasBorder: false,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: '#FAF8F7',
  studioCanvasPadding: 16,
  studioWidgetBackgroundColor: '#FFFFFF',
  studioWidgetBorder: { width: 1, color: '#E6E2DE' },
  studioWidgetBorderRadius: 16,
  studioWidgetTitleFontFamily: FONT,
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
});

// ---- AI assistant -----------------------------------------------------------------------

function buildAi(pageKey: string, model: string): AgAiHarnessSetup {
  // The page key is the bearer: the proxy checks it like ?k= and swaps in its own OpenAI key.
  const adapter = openaiAdapter({ endpoint: '/p/reports/ai', key: pageKey, model });
  return ({ api }) =>
    createAiHarness(api, {
      adapter,
      promptStarters: [
        { label: 'Who should I chase?', prompt: 'Which customers owe the most on overdue invoices, and how late are they? Add a widget that shows it.' },
        { label: 'Collection rate by customer', prompt: 'Add a chart of collection rate by customer.' },
        { label: 'Summarise this page', prompt: 'Summarise what this page shows and what stands out.' },
      ],
    });
}

// ---- the page ---------------------------------------------------------------------------

export default function Reports({ boot }: { boot: Boot }) {
  const apiRef = useRef<AgStudioApi | null>(null);
  const [page, setPage] = useState<ReportPage>(boot.page);
  const [mode, setMode] = useState<AgStudioMode>('view');
  const data = useMemo(() => sources(boot.data), [boot.data]);
  const ai = useMemo(() => (boot.aiModel ? buildAi(boot.pageKey, boot.aiModel) : undefined), [boot.aiModel, boot.pageKey]);
  const [initialState] = useState<AgReportState>(() => ({
    selectedPageId: boot.page,
    pages: PAGES.map((p) => p.state),
    // The filters panel is empty on these pages; keep it folded away so the charts get the width.
    panels: { filters: { collapsed: true } },
  }));

  const open = (id: ReportPage) => {
    const api = apiRef.current;
    if (api) api.setState({ ...api.getState(), selectedPageId: id });
    setPage(id);
    const url = new URL(location.href);
    url.searchParams.set('page', id);
    history.replaceState(null, '', url);
  };

  return (
    <div className="studio-shell">
      <div className="studio-bar">
        <div className="tabs">
          {PAGES.map((p) => (
            <button key={p.id} className={p.id === page ? 'tab on' : 'tab'} onClick={() => open(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <button className="btn sm" onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}>
          {mode === 'edit' ? 'Done editing' : 'Edit report'}
        </button>
      </div>
      <div className="studio-canvas">
        <AgStudioProvider licenseKey={boot.licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
          <AgStudio
            style={{ height: '100%', width: '100%' }}
            theme={theme}
            layout={{ widgetBorderEnabled: true }}
            data={data}
            ai={ai}
            initialState={initialState}
            mode={mode}
            onApiReady={(e) => {
              apiRef.current = e.api;
            }}
            onStateUpdated={(e) => {
              const id = e.state.selectedPageId as ReportPage;
              if (id && id !== page) setPage(id);
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
