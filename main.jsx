import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import {
  Activity, AlertCircle, ArrowDownUp, CheckCircle2, CircleHelp, Compass,
  CreditCard, LayoutDashboard, LogOut, Package, RefreshCw, Search,
  Settings, ShieldCheck, Truck, WandSparkles, MapPin, FileText, Plus
} from 'lucide-react';
import './style.css';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

function AdminPushNotificationSetup() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !supabase) return undefined;
    let active = true;
    let registrationListener;
    let errorListener;
    let authSubscription;

    const requestAndRegister = async (userId) => {
      if (!active || !userId) return;
      try {
        let permission = await PushNotifications.checkPermissions();
        if (permission.receive !== 'granted') permission = await PushNotifications.requestPermissions();
        if (active && permission.receive === 'granted') await PushNotifications.register();
      } catch (error) {
        console.error('Admin push registration failed:', error);
      }
    };

    const initialize = async () => {
      registrationListener = await PushNotifications.addListener('registration', async ({ value }) => {
        if (!active || !value) return;
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) return;
        const { error } = await supabase.from('push_notification_tokens').upsert({
          user_id: user.id,
          token: value,
          platform: 'android',
          app_role: 'admin',
          updated_at: new Date().toISOString()
        }, { onConflict: 'token' });
        if (error) console.error('Could not save admin push token:', error.message);
      });
      errorListener = await PushNotifications.addListener('registrationError', (error) => {
        console.error('Admin native push registration error:', error);
      });
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) await requestAndRegister(session.user.id);
      const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (nextSession?.user?.id) void requestAndRegister(nextSession.user.id);
      });
      authSubscription = data.subscription;
    };

    void initialize();
    return () => {
      active = false;
      authSubscription?.unsubscribe();
      registrationListener?.remove();
      errorListener?.remove();
    };
  }, []);
  return null;
}

const STATUSES = ['Booking Created', 'Picked', 'Received at KSA Hub', 'Customs Cleared (KSA ZATCA)', 'In Transit', 'Arrived at Destination Port/Airport', 'Customs Cleared (East Africa)', 'Out for Delivery / Ready for Pickup', 'Delivered'];
const PAYMENTS = ['Paid', 'Unpaid', 'Pay on Delivery'];

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
  const [pickupDrivers, setPickupDrivers] = useState([]);
  const [pickupAssignments, setPickupAssignments] = useState([]);
  const [driverSelections, setDriverSelections] = useState({});
  const [assigningShipment, setAssigningShipment] = useState(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiDraftAction, setAiDraftAction] = useState(null);
  const [testingNotification, setTestingNotification] = useState(false);

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

  const refreshPickupData = useCallback(async () => {
    if (!supabase || !authorized) return;
    const [driversResult, assignmentsResult] = await Promise.all([
      supabase.from('pickup_drivers').select('id,display_name,phone,active').eq('active', true).order('display_name'),
      supabase.from('shipment_pickup_assignments').select('id,shipment_id,driver_id,pickup_status,picked_at,assigned_at')
    ]);
    if (driversResult.error) setMessage('Could not load driver list: ' + driversResult.error.message);
    else setPickupDrivers(driversResult.data || []);
    if (assignmentsResult.error) setMessage('Could not load pickup assignments: ' + assignmentsResult.error.message);
    else setPickupAssignments(assignmentsResult.data || []);
  }, [authorized]);

  useEffect(() => { refreshPickupData(); }, [refreshPickupData]);

  async function assignPickup(shipment) {
    const driverId = driverSelections[shipment.id];
    if (!driverId) { setMessage('Choose a driver before assigning this pickup.'); return; }
    setAssigningShipment(shipment.id); setMessage('');
    const existing = pickupAssignments.find(a => a.shipment_id === shipment.id);
    const payload = { shipment_id: shipment.id, driver_id: driverId, assigned_by: session.user.id, pickup_status: 'Assigned', picked_at: null };
    const { data, error } = await supabase.from('shipment_pickup_assignments')
      .upsert(payload, { onConflict: 'shipment_id' }).select('*').single();
    if (error) setMessage('Pickup assignment failed: ' + error.message);
    else {
      setPickupAssignments(prev => [...prev.filter(a => a.shipment_id !== shipment.id), data]);
      const driver = pickupDrivers.find(d => d.id === driverId);
      setMessage('Pickup assigned to ' + (driver?.display_name || 'driver') + ' for shipment ' + shipment.tracking_id + '.');
    }
    setAssigningShipment(null);
  }

  useEffect(() => {
    if (!supabase || !authorized) return;
    const channel = supabase.channel(`admin-shipments-${session?.user?.id || 'session'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, (payload) => {
        refresh();
        if (payload.eventType === 'INSERT') setMessage(`New shipment booking received: ${payload.new?.tracking_id || 'New shipment'}.`);
        else if (payload.eventType === 'UPDATE' && payload.old?.current_status !== payload.new?.current_status) setMessage(`Shipment ${payload.new?.tracking_id || ''} status changed to ${payload.new?.current_status || 'updated'}.`);
      })
      .subscribe();
    const pickupChannel = supabase.channel(`admin-pickups-${session?.user?.id || 'session'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipment_pickup_assignments' }, (payload) => {
        refreshPickupData();
        if (payload.eventType === 'INSERT') setMessage('A pickup assignment was created.');
        else if (payload.eventType === 'UPDATE') setMessage('A pickup assignment was updated.');
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); supabase.removeChannel(pickupChannel); };
  }, [authorized, session?.user?.id, refresh, refreshPickupData]);

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

  const aiInsights = useMemo(() => ({
    pendingPickups: shipments.filter(s => s.current_status === 'Booking Created' && !pickupAssignments.some(a => a.shipment_id === s.id)),
    picked: shipments.filter(s => s.current_status === 'Picked'),
    inTransit: shipments.filter(s => s.current_status === 'In Transit'),
    unpaid: shipments.filter(s => s.payment_status === 'Unpaid'),
    undelivered: shipments.filter(s => s.current_status !== 'Delivered'),
  }), [shipments, pickupAssignments]);

  function askAdminAssistant(e) {
    e.preventDefault();
    const q = aiQuestion.trim().toLowerCase();
    if (!q) return;
    if (/pending pickup|unassigned|pickup/.test(q)) {
      const rows = aiInsights.pendingPickups.slice(0, 8);
      setAiAnswer(rows.length
        ? `I found ${aiInsights.pendingPickups.length} booking(s) without a pickup assignment. ${rows.map(s => `${s.tracking_id} — ${s.sender_city || 'origin not recorded'} — ${s.receiver_city || 'destination not recorded'}`).join('; ')}. Review each booking and approve any driver assignment on the Pickups page.`
        : 'No bookings currently match the rule for an unassigned pickup.');
    } else if (/unpaid|payment|finance|revenue|paid/.test(q)) {
      setAiAnswer(`Current records: ${aiInsights.unpaid.length} unpaid shipment(s), total marked unpaid value ${finance.unpaid.toLocaleString()} SAR; ${shipments.filter(s => s.payment_status === 'Paid').length} paid shipment(s), total marked paid value ${finance.paid.toLocaleString()} SAR. These figures reflect the current database records, not independently verified payments.`);
    } else if (/delay|late|delivery|undelivered|status|report|summary|insight/.test(q)) {
      setAiAnswer(`Operations summary: ${shipments.length} shipment(s) loaded; ${aiInsights.picked.length} picked; ${aiInsights.inTransit.length} in transit; ${aiInsights.undelivered.length} not yet marked delivered; ${aiInsights.pendingPickups.length} bookings without a pickup assignment; ${aiInsights.unpaid.length} unpaid. This is a rules-based summary of current records; it does not predict delivery delays.`);
    } else {
      const found = shipments.filter(s => [s.tracking_id,s.sender_name,s.receiver_name,s.sender_city,s.receiver_city,s.current_status].some(v => String(v || '').toLowerCase().includes(q))).slice(0, 8);
      setAiAnswer(found.length
        ? `Matching shipments (${found.length} shown): ${found.map(s => `${s.tracking_id}: ${s.current_status || 'status unknown'}, ${s.sender_city || 'origin unknown'} → ${s.receiver_city || 'destination unknown'} (${s.receiver_country || 'country unknown'})`).join('; ')}. Open Shipments to review records and make any changes through the normal admin controls.`
        : 'I could not find a matching shipment or supported question. Try asking about pending pickups, unpaid payments, operations summary, or enter a tracking ID, sender, receiver, or city.');
    }
    setAiDraftAction(null);
  }

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
      let notificationMessage = '';
      if (changes.current_status && changes.current_status !== s.current_status) {
        const { data: pushData, error: pushError } = await supabase.functions.invoke('send-push-notification', {
          body: {
            recipient_role: 'customer',
            shipment_id: s.id,
            title: 'Nyago Cargo — Shipment Update',
            body: `Shipment ${s.tracking_id} status: ${changes.current_status}`
          }
        });
        if (pushError || pushData?.error || !pushData?.sent) {
          notificationMessage = ' Status saved; push not delivered' + (pushData?.error ? ': ' + pushData.error : pushError ? ': ' + pushError.message : '.');
        } else {
          notificationMessage = ` Customer notification accepted by Firebase (${pushData.sent} device).`;
        }
      }
      setMessage(`Shipment ${s.tracking_id} updated.` + notificationMessage);
    }
    setBusyId(null);
  }

  async function sendCustomerTestNotification() {
    if (!supabase || !session?.user?.id || testingNotification) return;
    setTestingNotification(true);
    setMessage('Sending a test notification to the most recently active Customer app…');
    try {
      const { data, error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          recipient_role: 'customer',
          title: 'Nyago Cargo — Customer Test',
          body: 'Your Nyago Cargo Customer app is successfully receiving push notifications.'
        }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.sent) throw new Error(data?.message || 'No Customer device accepted the notification.');
      setMessage(`Customer test notification accepted by Firebase (${data.sent} device). No shipment was changed.`);
    } catch (error) {
      console.error('Customer test notification failed:', error);
      setMessage('Customer test notification failed: ' + (error?.message || 'Unknown error'));
    } finally {
      setTestingNotification(false);
    }
  }

  async function sendTestNotification() {
    if (!supabase || !session?.user?.id || testingNotification) return;
    setTestingNotification(true);
    setMessage('Sending a test notification to your registered Admin devices…');
    try {
      const { data, error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          user_id: session.user.id,
          title: 'Nyago Cargo — Test Notification',
          body: 'Your Admin app is successfully receiving push notifications.'
        }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage('Test notification request sent. Check your Admin phone notification shade. No shipment was changed.');
    } catch (error) {
      console.error('Admin test notification failed:', error);
      setMessage('Test notification failed: ' + (error?.message || 'Unknown error'));
    } finally {
      setTestingNotification(false);
    }
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
              <button onClick={sendTestNotification} disabled={testingNotification}><Activity size={17}/>{testingNotification ? 'Sending test…' : 'Test push notification'}</button>
              <button onClick={sendCustomerTestNotification} disabled={testingNotification}><Activity size={17}/>{testingNotification ? 'Sending test…' : 'Test Customer notification'}</button>
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
            <section className="panel" style={{marginBottom:18,padding:16}}>
              <div className="section-heading"><div><p className="eyebrow">FIELD OPERATIONS</p><h2>Assign pickup driver</h2><p className="muted">Drivers create an account in the Driver Portal first. Assignments appear on their phones.</p></div><button className="secondary" onClick={refreshPickupData}><RefreshCw size={15}/> Refresh drivers</button></div>
              {pickupDrivers.length === 0 ? <p className="notice">No active driver profiles yet. Ask each driver to create an account in the Driver Portal, then refresh this list. If email confirmation is enabled, they must confirm their account and sign in once.</p> : <div className="pickup-cards">{visible.filter(s => s.pickup_address || s.sender_city).map(s => { const a = pickupAssignments.find(x => x.shipment_id === s.id); const d = pickupDrivers.find(x => x.id === (a?.driver_id || driverSelections[s.id])); return <article className="pickup-card" key={'assign-'+s.id}><strong>{s.tracking_id}</strong><p>{s.sender_name || 'Sender'} · {s.pickup_address || s.sender_city}</p><p className="muted">Assignment: {a ? (a.pickup_status === 'Picked' ? 'Picked' : 'Assigned') + (d ? ' · ' + d.display_name : '') : 'Not assigned'}</p><div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}><select className="status-select" aria-label={'Driver for '+s.tracking_id} value={driverSelections[s.id] || a?.driver_id || ''} onChange={e=>setDriverSelections(prev=>({...prev,[s.id]:e.target.value}))}><option value="">Choose driver</option>{pickupDrivers.map(driver=><option key={driver.id} value={driver.id}>{driver.display_name}{driver.phone?' · '+driver.phone:''}</option>)}</select><button className="primary" disabled={assigningShipment===s.id} onClick={()=>assignPickup(s)}>{assigningShipment===s.id?'Assigning…':a?'Reassign':'Assign pickup'}</button></div></article>; })}</div>}
            </section>
            <ShipmentTable rows={visible} />
          </section>
        </>}

        {activePage === 'finance' && <>
          <div className="dashboard-heading"><div><p className="eyebrow">BILLING</p><h1>Finance Overview</h1><p className="muted">Totals are calculated from shipment records and their current payment status.</p></div></div>
          <div className="metrics"><article><span>Paid shipment value</span><strong>{finance.paid.toLocaleString()} SAR</strong><CreditCard/><small>Sum of records marked Paid</small></article><article><span>Unpaid shipment value</span><strong>{finance.unpaid.toLocaleString()} SAR</strong><Activity/><small>Sum of records marked Unpaid</small></article><article><span>Paid shipments</span><strong>{shipments.filter(s => s.payment_status === 'Paid').length}</strong><CheckCircle2/><small>Payment status from database</small></article><article><span>Unpaid shipments</span><strong>{shipments.filter(s => s.payment_status === 'Unpaid').length}</strong><AlertCircle/><small>Payment status from database</small></article></div>
          <section className="dashboard-section"><h2>Shipment payment records</h2><p className="muted">Use the payment selector on the Shipments page to update a record. This app does not yet generate invoices or process payments.</p><button className="primary" onClick={() => goTo('shipments')}>Manage shipment payments</button></section>
        </>}

        {activePage === 'ai-tools' && <>
          <div className="dashboard-heading"><div><p className="eyebrow">OPERATIONS INTELLIGENCE</p><h1>AI Admin Assistant</h1><p className="muted">Free, rules-based assistance using the shipment and pickup data already loaded for this authorized admin session. No external AI provider or paid API is used.</p></div></div>
          <div className="metrics">
            <article><span>Unassigned pickups</span><strong>{aiInsights.pendingPickups.length}</strong><Truck/><small>Bookings not yet assigned to a driver</small></article>
            <article><span>In transit</span><strong>{aiInsights.inTransit.length}</strong><Activity/><small>Current shipment status</small></article>
            <article><span>Unpaid shipments</span><strong>{aiInsights.unpaid.length}</strong><CreditCard/><small>Based on payment_status</small></article>
            <article><span>Not delivered</span><strong>{aiInsights.undelivered.length}</strong><Package/><small>Includes all non-delivered statuses</small></article>
          </div>
          <section className="dashboard-section">
            <h2>Ask about cargo operations</h2>
            <p className="muted">Try “show pending pickups”, “unpaid payments”, “operations summary”, or search by tracking code, sender, receiver, or city.</p>
            <form onSubmit={askAdminAssistant} style={{display:'grid',gap:12}}>
              <label htmlFor="ai-admin-question">Your question</label>
              <textarea id="ai-admin-question" rows={3} value={aiQuestion} onChange={e=>setAiQuestion(e.target.value)} placeholder="e.g. Which bookings need a pickup driver?" style={{width:'100%',boxSizing:'border-box',padding:12,borderRadius:12,background:'var(--input-bg, #0b1220)',color:'inherit',border:'1px solid #334155'}}/>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <button className="primary" type="submit">Analyze records</button>
                <button className="quiet" type="button" onClick={()=>{setAiQuestion('Show pending pickups');setAiAnswer('');}}>Pending pickups</button>
                <button className="quiet" type="button" onClick={()=>{setAiQuestion('Give me an operations summary');setAiAnswer('');}}>Operations summary</button>
                <button className="quiet" type="button" onClick={()=>{setAiQuestion('Show unpaid payments');setAiAnswer('');}}>Unpaid payments</button>
              </div>
            </form>
            {aiAnswer && <div className="notice" role="status" style={{marginTop:16,whiteSpace:'pre-wrap',lineHeight:1.6}}><WandSparkles size={18}/><span>{aiAnswer}</span></div>}
          </section>
          <section className="dashboard-section">
            <h2>AI-assisted actions — approval required</h2>
            <p className="muted">The assistant does not make database changes. Select a suggestion to review it, then use the existing authorized admin workflow to approve and perform the action.</p>
            <div className="pickup-cards">
              <article className="pickup-card"><strong>Review unassigned pickups</strong><p>{aiInsights.pendingPickups.length} booking(s) may need driver assignment.</p><button className="primary" onClick={()=>goTo('shipments')}>Review shipments and approve assignments</button></article>
              <article className="pickup-card"><strong>Review unpaid shipments</strong><p>{aiInsights.unpaid.length} shipment(s) are marked unpaid. Verify payment before changing any status.</p><button className="primary" onClick={()=>goTo('finance')}>Review finance records</button></article>
            </div>
          </section>
          <section className="dashboard-section">
            <h2>Limitations and security</h2>
            <p className="muted">This first version is a no-cost rules-based assistant, not a generative language model. It uses only records available to the signed-in, allowlisted admin; database RLS remains in force. It does not change shipment status, assign drivers, verify payments, or predict delays.</p>
          </section>
        </>}

        {['freight', 'ship-now', 'settings', 'help'].includes(activePage) && <>
          <div className="dashboard-heading"><div><p className="eyebrow">NYAGO CARGO</p><h1>{NAV_ITEMS.find(n => n.id === activePage)?.label}</h1><p className="muted">This section is reserved for the next implementation stage.</p></div></div>
          <section className="dashboard-section feature-notice">
            <ShieldCheck size={30}/>
            <h2>{activePage === 'freight' ? 'Freight Explorer is not connected yet' : activePage === 'ship-now' ? 'Booking and pay-later workflow is not connected yet' : activePage === 'settings' ? 'Admin settings' : 'Help Center'}</h2>
            <p className="muted">{activePage === 'settings' ? 'Account access is currently managed through Supabase Auth and the admin_users allowlist.' : activePage === 'help' ? 'For now, use the Shipments page to review bookings, pickup addresses, and status updates.' : 'This navigation item is visible for the planned dashboard layout, but its business workflow has not been implemented. Existing shipment operations remain available.'}</p>
            <button className="primary" onClick={() => goTo('shipments')}>Go to Shipments</button>
          </section>
        </>}

        <p className="footer-note"><ShieldCheck size={15}/> Shipment data is loaded through Supabase authenticated sessions and database RLS. Never expose service-role credentials in this app.</p>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<React.StrictMode><><AdminPushNotificationSetup /><App /></></React.StrictMode>);

// Production sync: retain the pickup-driver assignment workflow on the main branch.
