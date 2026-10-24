import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { Activity, AlertCircle, ArrowDownUp, CheckCircle2, LogOut, Package, RefreshCw, Search, ShieldCheck, Truck } from 'lucide-react';
import './style.css';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
const STATUSES = ['Booking Created','Received at KSA Hub','Customs Cleared (KSA ZATCA)','In Transit','Arrived at Destination Port/Airport','Customs Cleared (East Africa)','Out for Delivery / Ready for Pickup','Delivered'];
const PAYMENTS = ['Unpaid','Paid','Pay on Delivery'];

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

  const verifyAdmin = useCallback(async (currentSession) => {
    setAuthorized(false);
    if (!currentSession?.user?.id || !supabase) return;
    const { data, error } = await supabase.from('admin_users').select('id,email').eq('id', currentSession.user.id).maybeSingle();
    if (error) { setMessage(`Admin permission check failed: ${error.message}`); return; }
    if (!data) { setMessage('This account is not on the admin allowlist. Ask the project owner to authorize it.'); await supabase.auth.signOut(); return; }
    setAuthorized(true);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (data.session) verifyAdmin(data.session); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) setTimeout(() => verifyAdmin(next), 0); else { setAuthorized(false); setShipments([]); }
    });
    return () => subscription.unsubscribe();
  }, [verifyAdmin]);

  const refresh = useCallback(async () => {
    if (!supabase || !authorized) return;
    setLoading(true);
    const { data, error } = await supabase.from('shipments').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) setMessage(`Could not load shipments: ${error.message}`); else setShipments(data || []);
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
  const counts = useMemo(() => ({ total: shipments.length, transit: shipments.filter(s => s.current_status === 'In Transit').length, delivered: shipments.filter(s => s.current_status === 'Delivered').length, attention: shipments.filter(s => ['Booking Created','Unpaid'].includes(s.current_status) || s.payment_status === 'Unpaid').length }), [shipments]);

  async function login(e) {
    e.preventDefault(); setMessage('');
    if (!supabase) { setMessage('Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY first.'); return; }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setMessage(error.message);
  }
  async function changeShipment(s, changes, note) {
    if (!supabase) return;
    setBusyId(s.id); setMessage('');
    const now = new Date().toISOString();
    const nextStatus = changes.current_status || s.current_status;
    const events = Array.isArray(s.events) ? s.events : [];
    const nextEvents = [...events, { status: nextStatus, timestamp: now, location: 'Nyago Cargo Admin', notes: note || `Updated by admin${changes.payment_status ? `; payment: ${changes.payment_status}` : ''}` }];
    const { data, error } = await supabase.from('shipments').update({ ...changes, events: nextEvents }).eq('id', s.id).select('*').single();
    if (error) setMessage(`Update failed: ${error.message}`); else { setShipments(prev => prev.map(x => x.id === s.id ? data : x)); setMessage(`Shipment ${s.tracking_id} updated.`); }
    setBusyId(null);
  }
  async function logout() { await supabase?.auth.signOut(); setSession(null); setAuthorized(false); }

  if (!supabase) return <main className="center"><section className="login-card"><ShieldCheck size={36}/><h1>Nyago Cargo Admin</h1><p>Set up the environment before running the admin app.</p><code>VITE_SUPABASE_URL<br/>VITE_SUPABASE_ANON_KEY</code></section></main>;
  if (!session || !authorized) return <main className="center"><form className="login-card" onSubmit={login}><div className="brand-icon"><Truck size={26}/></div><p className="eyebrow">OPERATIONS CONSOLE</p><h1>Nyago Cargo Admin</h1><p className="muted">Sign in with an authorized administrator account.</p><label>Email address<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="primary" type="submit">Sign in securely</button>{message && <p className="notice"><AlertCircle size={16}/>{message}</p>}<p className="small muted">Access is verified against the <code>admin_users</code> allowlist. Registration is intentionally disabled.</p></form></main>;

  return <div className="shell"><header className="topbar"><div className="brand"><div className="brand-icon"><Truck size={24}/></div><div><strong>NYAGO CARGO</strong><span>ADMIN OPERATIONS</span></div></div><div className="top-actions"><span className="live"><i/> Live sync enabled</span><button className="quiet" onClick={refresh} disabled={loading}><RefreshCw size={16}/>{loading?'Refreshing':'Refresh'}</button><button className="quiet" onClick={logout}><LogOut size={16}/> Sign out</button></div></header>
    <main className="content"><div className="heading"><div><p className="eyebrow">CONTROL TOWER</p><h1>Shipment operations</h1><p className="muted">Manage bookings, shipment milestones, and payment status.</p></div><div className="user-pill"><ShieldCheck size={17}/>{session.user.email}</div></div>
    {message && <div className="notice banner"><AlertCircle size={17}/><span>{message}</span><button onClick={()=>setMessage('')}>Dismiss</button></div>}
    <div className="metrics"><article><span>Total shipments</span><strong>{counts.total}</strong><Package/></article><article><span>In transit</span><strong>{counts.transit}</strong><Truck/></article><article><span>Delivered</span><strong>{counts.delivered}</strong><CheckCircle2/></article><article><span>Unpaid / needs review</span><strong>{counts.attention}</strong><Activity/></article></div>
    <section className="panel"><div className="panel-head"><div><h2>Shipment register</h2><p className="muted">Updates from other authorized sessions appear automatically.</p></div><span className="count">{visible.length} records</span></div><div className="toolbar"><div className="search"><Search size={18}/><input aria-label="Search shipments" placeholder="Search tracking ID, sender, receiver…" value={search} onChange={e=>setSearch(e.target.value)}/></div><select aria-label="Filter by status" value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select><button className="quiet" onClick={()=>{setSearch('');setFilter('All')}}><ArrowDownUp size={16}/> Reset</button></div>
    <div className="table-wrap"><table><thead><tr><th>Tracking / created</th><th>Route & customer</th><th>Shipment</th><th>Status</th><th>Payment</th></tr></thead><tbody>{visible.map(s=><tr key={s.id}><td><strong className="tracking">{s.tracking_id}</strong><small>{s.created_at ? new Date(s.created_at).toLocaleString() : '—'}</small></td><td><strong>{s.sender_name || '—'}</strong><small>{s.sender_city || 'Saudi Arabia'} → {s.receiver_city || '—'}, {s.receiver_country || ''}</small><small>Receiver: {s.receiver_name || '—'}</small></td><td><strong>{s.cargo_type || '—'}</strong><small>{s.weight_kg ?? '—'} kg · {s.package_count ?? '—'} package(s)</small><small>{s.total_cost_sar == null ? '—' : `${Number(s.total_cost_sar).toLocaleString()} SAR`}</small></td><td><select aria-label={`Status for ${s.tracking_id}`} className="status-select" value={s.current_status || STATUSES[0]} disabled={busyId===s.id} onChange={e=>changeShipment(s,{current_status:e.target.value},`Status changed to ${e.target.value}`)}>{STATUSES.map(st=><option key={st}>{st}</option>)}</select></td><td><select aria-label={`Payment for ${s.tracking_id}`} className="status-select" value={s.payment_status || 'Unpaid'} disabled={busyId===s.id} onChange={e=>changeShipment(s,{payment_status:e.target.value},`Payment status changed to ${e.target.value}`)}>{PAYMENTS.map(p=><option key={p}>{p}</option>)}</select></td></tr>)}</tbody></table>{visible.length===0 && <div className="empty"><Package size={28}/><strong>No shipments found</strong><span>Try another search or clear the status filter.</span></div>}</div></section><p className="footer-note"><ShieldCheck size={15}/> Shipment data is available only through Supabase authenticated sessions and database RLS. Do not expose service-role credentials in this app.</p></main></div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
