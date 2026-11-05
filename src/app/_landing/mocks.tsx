/** The money mockups: on the landing page's call demo, as Penny's shared screen. Server-safe, so both the page and the client player use them. */

export function SummaryMock({ reminded = false }: { reminded?: boolean }) {
  return (
    <>
      <div className="kpis">
        <div className="kpi ok">
          <div className="l">Collected · Oct</div>
          <div className="n">$11,200</div>
          <div className="s">4 paid</div>
        </div>
        <div className="kpi">
          <div className="l">Outstanding</div>
          <div className="n">$6,400</div>
          <div className="s">3 open</div>
        </div>
        <div className="kpi warn">
          <div className="l">Overdue</div>
          <div className="n">$4,650</div>
          <div className="s">2 invoices</div>
        </div>
        <div className="kpi bad">
          <div className="l">Disputes</div>
          <div className="n">1</div>
          <div className="s">$120 at risk</div>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Due</th>
            <th className="r">Amount</th>
            <th className="r">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>0042</td>
            <td>Acme Studio</td>
            <td>Oct 1</td>
            <td className="r">4,000.00</td>
            <td className="r">
              <span className={`chip ${reminded ? 'ok' : 'bad'}`}>{reminded ? 'reminder sent' : '12 days late'}</span>
            </td>
          </tr>
          <tr>
            <td>0039</td>
            <td>Northwind</td>
            <td>Oct 9</td>
            <td className="r">650.00</td>
            <td className="r">
              <span className="chip bad">4 days late</span>
            </td>
          </tr>
          <tr>
            <td>0044</td>
            <td>Lumen Co.</td>
            <td>Oct 28</td>
            <td className="r">1,750.00</td>
            <td className="r">
              <span className="chip">sent</span>
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

export function DisputeMock({ sent = false }: { sent?: boolean }) {
  return (
    <div className="doc">
      <div className="meta">Dispute PP-D-83 · opened yesterday</div>
      <h4>Item not received</h4>
      <div className="meta" style={{ marginBottom: 10 }}>
        $120.00 · respond by <b style={{ color: 'var(--amber)' }}>Oct 18</b>
      </div>
      <div className="row">
        <span>Shipped</span>
        <span>Oct 2 · tracking 1Z…</span>
      </div>
      <div className="row">
        <span>Delivered</span>
        <span>Oct 5 · signed</span>
      </div>
      <div className="msg">
        <b>Buyer</b>I never got this.
      </div>
      <div className="msg" style={{ background: 'var(--green-soft)' }}>
        <b>Penny · {sent ? 'sent' : 'draft'}</b>Hi Jordan, tracking shows delivery on Oct 5 with a signature. Here is the tracking number and the photo of the package.
      </div>
    </div>
  );
}

export function ApprovalMock({ paid = false }: { paid?: boolean }) {
  return (
    <div className={`doc approve${paid ? ' is-done' : ''}`}>
      <div className="mono">Penny is asking</div>
      <div className="big">$400.00</div>
      <div className="what">Pay sam@studio.co · &quot;logo work&quot;</div>
      <div className="btns">
        <span className="b dark">Approve</span>
        <span className="b">Reject</span>
        <div className="meta" style={{ marginTop: 12 }}>
          or just say yes on the call
        </div>
      </div>
      <div className="done">
        <span className="t-success-check" data-state={paid ? 'in' : 'out'}>
          <svg viewBox="0 0 48 48">
            <path d="M14 25l7 7 13-14" />
          </svg>
          Approved by Alex, on the call · paid once
        </span>
      </div>
    </div>
  );
}

/** Day offsets from today (Oct 16) over a 30-day window; Acme slides two weeks when `late`, and Sam's payout rides with it. */
export function ForecastMock({ late = false, waiting = false }: { late?: boolean; waiting?: boolean }) {
  const acme = late ? 26 : 12;
  const rows = [
    { who: 'Northwind', day: 7, amount: 1500 },
    { who: 'Brightside', day: 8, amount: 900 },
    { who: 'Acme Studio', day: acme, amount: 4000, note: late ? '+14 days?' : 'pays ~12 days late' },
    { who: 'Payroll', day: 14, amount: -7200 },
    ...(waiting ? [{ who: 'Sam', day: acme, amount: -800, note: 'when Acme pays' }] : []),
  ];
  let balance = 5900;
  let low = balance;
  const points = Array.from({ length: 31 }, (_, d) => {
    balance += rows.filter((r) => r.day === d).reduce((a, r) => a + r.amount, 0);
    low = Math.min(low, balance);
    return balance;
  });
  const y = (v: number) => 52 - (v / 9000) * 46;
  const k = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(n) >= 1000 ? `${Math.abs(n) / 1000}k` : Math.abs(n)}`;
  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <div className="l">Today</div>
          <div className="n">$5,900</div>
          <div className="s">PayPal balance</div>
        </div>
        <div className="kpi ok">
          <div className="l">Coming in</div>
          <div className="n">$6,400</div>
          <div className="s">3 invoices</div>
        </div>
        <div className="kpi bad">
          <div className="l">Payroll</div>
          <div className="n">−$7,200</div>
          <div className="s">Oct 30</div>
        </div>
        <div className={`kpi ${low < 2000 ? 'warn' : 'ok'}`}>
          <div className="l">Lowest point</div>
          <div className="n">${low.toLocaleString('en-US')}</div>
          <div className="s">{late ? 'if Acme slips' : 'Oct 30'}</div>
        </div>
      </div>
      <div className="fc">
        {rows.map((r) => (
          <div className="fc-row" key={r.who}>
            <span className="fc-who">{r.who}</span>
            <span className="fc-track">
              <span className={`fc-pill ${r.amount < 0 ? 'out' : 'in'}`} style={{ left: `${(r.day / 30) * 100}%`, transform: r.day > 18 ? 'translateX(calc(-100% + 10px))' : 'translateX(-4px)' }}>
                {k(r.amount)}
                {r.note && <i>{r.note}</i>}
              </span>
            </span>
          </div>
        ))}
        <svg className="fc-line" viewBox="0 0 300 56" preserveAspectRatio="none" aria-hidden="true">
          <path d={points.map((v, d) => `${d ? 'L' : 'M'}${d * 10},${y(v)}`).join('')} />
        </svg>
        <div className="fc-axis">
          <span>Oct 16</span>
          <span>Oct 30</span>
          <span>Nov 15</span>
        </div>
      </div>
    </>
  );
}
