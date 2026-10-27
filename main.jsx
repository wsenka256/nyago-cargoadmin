import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import {
  Activity, AlertCircle, ArrowDownUp, CheckCircle2, CircleHelp, Compass,
  CreditCard, LayoutDashboard, LogOut, Package, RefreshCw, Search,
  Settings, ShieldCheck, Truck, WandSparkles, MapPin, FileText, Plus
} from 'lucide-react';
import './style.css';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
const STATUSES = ['Booking Created', 'Picked', 'Received at KSA Hub', 'Customs Cleared (KSA ZATCA)', 'In Transit', 'Arrived at Destination Port/Airport', 'Customs Cleared (East Africa)', 'Out for Delivery / Ready for Pickup', 'Delivered'];
const PAYMENTS = ['Unpaid', 'Paid', 'Pay on Delivery'];

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'shipments', label: 'Shipments', icon: Package },
  { id: 'freight', label: 'Freight Explorer', icon: Compass },
  { id: 'finance', label: 'Finance', icon: CreditCard },
  { id: 'ship-now', label: 'Ship Now / Pay Later', icon: Truck },
  { id: 'ai-tools', label: 'AI Tools', icon: WandSparkles },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'help', label: 'Help Center', icon: CircleHelp },
];

function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [activePage, setActivePage] = useState('dashboard');

  const verifyAdmin = useCallback(async (currentSession) => {
    setAuthorized(false);
    if (!currentSession?.user?.id || !supabase) return;
    const { data, error } = await supabase.from('admin_users').select('id,email').eq('id', currentSession.user.id).maybeSingle();
    if (error) { setMessage(`Admin permission check failed: ${error.message}`); return; }
    if (!data) {
      setMessage('This account is not on the admin allowlist. Ask the project owner to authorize it.');
      await supabase.auth.signOut();
      return;
    }
    setAuthorized(true);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) verifyAdmin(data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) setTimeout(() => verifyAdmin(next), 0);
      else { setAuthorized(false); setShipments([]); }
    });
    return () => subscription.unsubscribe();
  }, [verifyAdmin]);

  const refresh = useCallback(async () => {
    if (!supabase || !authorized) return;
    setLoading(true);
    const { data, error } = await supabase.from('shipments').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) setMessage(`Could not load shipments: ${error.message}`);
    else setShipments(data || []);
    setLoading(false);
  }, [authorized]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!supabase || !authorized) return;
    const channel = supabase.channel(`admin-shipments-${session?.user?.id || 'session'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [authorized, session?.user?.id, refresh]);

  const visible = useMemo(() => shipments.filter(s => {
    const q = search.trim().toLowerCase();
    const matches = !q || [s.tracking_id, s.sender_name, s.receiver_name, s.receiver_city, s.current_status].some(v => String(v || '').toLowerCase().includes(q));
    return matches && (filter === 'All' || s.current_status === filter);
  }), [shipments, search, filter]);

  const counts = useMemo(() => ({
    total: shipments.length,
    transit: shipments.filter(s => s.current_status === 'In Transit').length,
    delivered: shipments.filter(s => s.current_status === 'Delivered').length,
    attention: shipments.filter(s => ['Booking Created', 'Unpaid'].includes(s.current_status) || s.payment_status === 'Unpaid').length
  }), [shipments]);

  const finance = useMemo(() => {
    const paid = shipments.filter(s => s.payment_status === 'Paid').reduce((sum, s) => sum + (Number(s.total_cost_sar) || 0), 0);
    const unpaid = shipments.filter(s => s.payment_status === 'Unpaid').reduce((sum, s) => sum + (Number(s.total_cost_sar) || 0), 0);
    return { paid, unpaid };
  }, [shipments]);

  async function login(e) {
    e.preventDefault();
    setMessage('');
    if (!supabase) { setMessage('Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY first.'); return; }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setMessage(error.message);
  }

  async function changeShipment(s, changes, note) {
    if (!supabase) return;
    setBusyId(s.id);
    setMessage('');
    const now = new Date().toISOString();
    const nextStatus = changes.current_status || s.current_status;
    const events = Array.isArray(s.events) ? s.events : [];
    const nextEvents = [...events, {
      status: nextStatus,
      timestamp: now,
      location: 'Nyago Cargo Admin',
      notes: note || `Updated by admin${changes.payment_status ? `; payment: ${changes.payment_status}` : ''}`
    }];
    const { data, error } = await supabase.from('shipments').update({ ...changes, events: nextEvents }).eq('id', s.id).select('*').single();
    if (error) setMessage(`Update failed: ${error.message}`);
    else {
      setShipments(prev => prev.map(x => x.id === s.id ? data : x));
      setMessage(`Shipment ${s.tracking_id} updated.`);
    }
    setBusyId(null);
  }

  async function logout() {
    await supabase?.auth.signOut();
    setSession(null);
    setAuthorized(false);
  }

  function goTo(page) {
    setActivePage(page);
    if (page === 'shipments') setFilter('All');
  }

  function PickupInfo({ shipment }) {
    const s = shipment;
    return (
      <article className="pickup-card" key={`pickup-${s.id}`}>
        <strong>{s.tracking_id || 'Shipment'}</strong>
        <p>{s.pickup_address || 'Pickup address not provided'}</p>
        {s.pickup_instructions && <p>Instructions: {s.pickup_instructions}</p>}
        {s.pickup_latitude != null && s.pickup_longitude != null && (
          <p>GPS: {Number(s.pickup_latitude).toFixed(6)}, {Number(s.pickup_longitude).toFixed(6)}</p>
        )}
        {s.pickup_address && (
          <a
            href={s.pickup_latitude != null && s.pickup_longitude != null
              ? `https://www.google.com/maps/dir/?api=1&destination=${s.pickup_latitude},${s.pickup_longitude}`
              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.pickup_address)}`}
            target="_blank"
            rel="noreferrer"
          >Open in Google Maps ↗</a>
        )}
      </article>
    );
  }

  function ShipmentTable({ rows }) {
    return (
      <div className="table-wrap">
        <table>
          <thead><tr><th>Shipment ID / Created</th><th>Route & customer</th><th>Shipment</th><th>Pickup location</th><th>Status</th><th>Payment</th></tr></thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id}>
                <td><strong className="tracking">{s.tracking_id || '—'}</strong><small>{s.created_at ? new Date(s.created_at).toLocaleString() : '—'}</small></td>
                <td><strong>{s.sender_name || '—'}</strong><small>{s.sender_city || 'Saudi Arabia'} → {s.receiver_city || '—'}, {s.receiver_country || ''}</small><small>Receiver: {s.receiver_name || '—'}</small></td>
                <td><strong>{s.cargo_type || '—'}</strong><small>{s.weight_kg ?? '—'} kg · {s.package_count ?? '—'} package(s)</small><small>{s.total_cost_sar == null ? '—' : `${Number(s.total_cost_sar).toLocaleString()} SAR`}</small></td>
                <td>{s.pickup_address ? <><strong>{s.pickup_address}</strong>{s.pickup_instructions && <small>Instructions: {s.pickup_instructions}</small>}{s.pickup_latitude != null && s.pickup_longitude != null && <small>GPS: {Number(s.pickup_latitude).toFixed(6)}, {Number(s.pickup_longitude).toFixed(6)}</small>}<a href={s.pickup_latitude != null && s.pickup_longitude != null ? `https://www.google.com/maps/dir/?api=1&destination=${s.pickup_latitude},${s.pickup_longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.pickup_address)}`} target="_blank" rel="noreferrer">Open in Google Maps ↗</a></> : <small>Not provided on this booking</small>}</td>
                <td><select aria-label={`Status for ${s.tracking_id}`} className="status-select" value={s.current_status || STATUSES[0]} disabled={busyId === s.id} onChange={e => changeShipment(s, { current_status: e.target.value }, `Status changed to ${e.target.value}`)}>{STATUSES.map(st => <option key={st}>{st}</option>)}</select></td>
                <td><select aria-label={`Payment for ${s.tracking_id}`} className="status-select" value={s.payment_status || 'Unpaid'} disabled={busyId === s.id} onChange={e => changeShipment(s, { payment_status: e.target.value }, `Payment status changed to ${e.target.value}`)}>{PAYMENTS.map(p => <option key={p}>{p}</option>)}</select></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty"><Package size={28}/><strong>No shipments found</strong><span>Try another search or clear the status filter.</span></div>}
      </div>
    );
  }

  if (!supabase) return <main className="center"><section className="login-card"><ShieldCheck size={36}/><h1>Nyago Cargo Admin</h1><p>Set up the environment before running the admin app.</p><code>VITE_SUPABASE_URL<br/>VITE_SUPABASE_ANON_KEY</code></section></main>;
  if (!session || !authorized) return <main className="center"><form className="login-card" onSubmit={login}><div className="brand-icon"><Truck size={26}/></div><p className="eyebrow">OPERATIONS CONSOLE</p><h1>Nyago Cargo Admin</h1><p className="muted">Sign in with an authorized administrator account.</p><label>Email address<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label><button className="primary" type="submit">Sign in securely</button>{message && <p className="notice"><AlertCircle size={16}/>{message}</p>}<p className="small muted">Access is verified against the <code>admin_users</code> allowlist. Registration is intentionally disabled.</p></form></main>;

  return (
    <div className="shell dashboard-layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon"><Truck size={24}/></div>
          <div><strong>NYAGO CARGO</strong><span>ADMIN OPERATIONS</span></div>
        </div>
        <p className="sidebar-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            return <button key={item.id} type="button" className={activePage === item.id ? 'active' : ''} onClick={() => goTo(item.id)}><Icon size={18}/><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <span className="live"><i/> Live sync enabled</span>
          <button className="quiet sidebar-signout" onClick={logout}><LogOut size={16}/> Sign out</button>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="mobile-brand"><Truck size={20}/> NYAGO CARGO</div>
          <div className="topbar-spacer"/>
          <span className="user-pill"><ShieldCheck size={17}/>{session.user.email}</span>
          <button className="quiet" onClick={refresh} disabled={loading}><RefreshCw size={16}/>{loading ? 'Refreshing' : 'Refresh'}</button>
        </header>

        {message && <div className="notice banner"><AlertCircle size={17}/><span>{message}</span><button onClick={() => setMessage('')}>Dismiss</button></div>}

        {activePage === 'dashboard' && <>
          <div className="dashboard-heading">
            <div><p className="eyebrow">OVERVIEW</p><h1>Dashboard Overview</h1><p className="muted">Monitor your logistics operations at a glance.</p></div>
          </div>
          <div className="metrics">
            <article><span>Total Shipments</span><strong>{counts.total}</strong><Package/><small>All loaded shipment records</small></article>
            <article><span>In Transit</span><strong>{counts.transit}</strong><Truck/><small>Currently marked in transit</small></article>
            <article><span>Delivered</span><strong>{counts.delivered}</strong><CheckCircle2/><small>Marked as delivered</small></article>
            <article><span>Pending / Review</span><strong>{counts.attention}</strong><Activity/><small>Bookings or unpaid shipments</small></article>
          </div>
          <section className="dashboard-section">
            <div className="section-title"><div><h2>Quick Actions</h2><p className="muted">Jump to common operations.</p></div></div>
            <div className="quick-actions">
              <button onClick={() => { goTo('shipments'); setSearch(''); setFilter('All'); }}><Plus size={17}/> View Shipments</button>
              <button onClick={() => { goTo('shipments'); setSearch(''); setFilter('All'); }}><Search size={17}/> Track Shipment</button>
              <button onClick={() => goTo('finance')}><FileText size={17}/> View Finance</button>
            </div>
          </section>
          <section className="dashboard-section">
            <div className="section-title"><div><h2>Recent Shipments</h2><p className="muted">Latest records from your Supabase database.</p></div><button className="quiet" onClick={() => goTo('shipments')}>View all shipments ↗</button></div>
            <ShipmentTable rows={shipments.slice(0, 5)} />
          </section>
        </>}

        {activePage === 'shipments' && <>
          <div className="dashboard-heading"><div><p className="eyebrow">OPERATIONS</p><h1>Shipments</h1><p className="muted">Search bookings, review pickup information, and update shipment or payment status.</p></div></div>
          <section className="dashboard-section">
            <div className="toolbar"><div className="search"><Search size={18}/><input aria-label="Search shipments" placeholder="Search tracking ID, sender, receiver…" value={search} onChange={e => setSearch(e.target.value)} /></div><select aria-label="Filter by status" value={filter} onChange={e => setFilter(e.target.value)}><option>All</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</select><button className="quiet" onClick={() => { setSearch(''); setFilter('All'); }}><ArrowDownUp size={16}/> Reset</button><span className="count">{visible.length} records</span></div>
            <h2 className="subsection-heading"><MapPin size={18}/> Pickup Addresses</h2>
            <div className="pickup-cards">{visible.map(s => <PickupInfo key={s.id} shipment={s} />)}{visible.length === 0 && <p className="muted">No matching pickup addresses.</p>}</div>
            <ShipmentTable rows={visible} />
          </section>
        </>}

        {activePage === 'finance' && <>
          <div className="dashboard-heading"><div><p className="eyebrow">BILLING</p><h1>Finance Overview</h1><p className="muted">Totals are calculated from shipment records and their current payment status.</p></div></div>
          <div className="metrics"><article><span>Paid shipment value</span><strong>{finance.paid.toLocaleString()} SAR</strong><CreditCard/><small>Sum of records marked Paid</small></article><article><span>Unpaid shipment value</span><strong>{finance.unpaid.toLocaleString()} SAR</strong><Activity/><small>Sum of records marked Unpaid</small></article><article><span>Paid shipments</span><strong>{shipments.filter(s => s.payment_status === 'Paid').length}</strong><CheckCircle2/><small>Payment status from database</small></article><article><span>Unpaid shipments</span><strong>{shipments.filter(s => s.payment_status === 'Unpaid').length}</strong><AlertCircle/><small>Payment status from database</small></article></div>
          <section className="dashboard-section"><h2>Shipment payment records</h2><p className="muted">Use the payment selector on the Shipments page to update a record. This app does not yet generate invoices or process payments.</p><button className="primary" onClick={() => goTo('shipments')}>Manage shipment payments</button></section>
        </>}

        {['freight', 'ship-now', 'ai-tools', 'settings', 'help'].includes(activePage) && <>
          <div className="dashboard-heading"><div><p className="eyebrow">NYAGO CARGO</p><h1>{NAV_ITEMS.find(n => n.id === activePage)?.label}</h1><p className="muted">This section is reserved for the next implementation stage.</p></div></div>
          <section className="dashboard-section feature-notice">
            <ShieldCheck size={30}/>
            <h2>{activePage === 'freight' ? 'Freight Explorer is not connected yet' : activePage === 'ship-now' ? 'Booking and pay-later workflow is not connected yet' : activePage === 'ai-tools' ? 'AI tools are not configured yet' : activePage === 'settings' ? 'Admin settings' : 'Help Center'}</h2>
            <p className="muted">{activePage === 'settings' ? 'Account access is currently managed through Supabase Auth and the admin_users allowlist.' : activePage === 'help' ? 'For now, use the Shipments page to review bookings, pickup addresses, and status updates.' : 'This navigation item is visible for the planned dashboard layout, but its business workflow has not been implemented. Existing shipment operations remain available.'}</p>
            <button className="primary" onClick={() => goTo('shipments')}>Go to Shipments</button>
          </section>
        </>}

        <p className="footer-note"><ShieldCheck size={15}/> Shipment data is loaded through Supabase authenticated sessions and database RLS. Never expose service-role credentials in this app.</p>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
