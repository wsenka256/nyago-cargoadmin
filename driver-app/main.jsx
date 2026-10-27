import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { MapPin, Package, CheckCircle2, LogIn, LogOut, RefreshCw, Truck, Phone, Navigation, AlertCircle } from 'lucide-react';
import './style.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [registering, setRegistering] = useState(false);
  const [assignments, setAssignments] = useState([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  const ensureDriverProfile = useCallback(async (user) => {
    const { data, error } = await supabase.from('pickup_drivers').select('id').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      const displayName = name.trim() || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Nyago Driver';
      const { error: insertError } = await supabase.from('pickup_drivers').insert({ id: user.id, display_name: displayName, phone: phone.trim() || null });
      if (insertError) throw insertError;
    }
  }, [name, phone]);

  const loadAssignments = useCallback(async () => {
    if (!supabase || !session?.user) return;
    setLoading(true); setMessage('');
    try {
      await ensureDriverProfile(session.user);
      const { data, error } = await supabase
        .from('shipment_pickup_assignments')
        .select('id, shipment_id, assigned_at, pickup_status, picked_at, shipments(id, tracking_id, cargo_type, sender_name, sender_phone, sender_city, pickup_address, pickup_instructions, pickup_latitude, pickup_longitude, receiver_city, receiver_country, package_count, weight_kg, current_status)')
        .eq('driver_id', session.user.id)
        .order('assigned_at', { ascending: false });
      if (error) throw error;
      setAssignments(data || []);
    } catch (e) {
      setMessage(e.message || 'Could not load pickup assignments. Ask the admin to check your driver account and database permissions.');
    } finally { setLoading(false); }
  }, [session, ensureDriverProfile]);

  useEffect(() => { if (session?.user) loadAssignments(); }, [session?.user?.id, loadAssignments]);

  useEffect(() => {
    if (!supabase || !session?.user) return;
    const channel = supabase.channel('driver-pickups-' + session.user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shipment_pickup_assignments', filter: 'driver_id=eq.' + session.user.id }, () => loadAssignments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, loadAssignments]);

  async function signIn(e) {
    e.preventDefault(); setMessage('');
    if (!supabase) { setMessage('App configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the deployment settings.'); return; }
    setBusy('auth');
    try {
      if (registering) {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim(), phone: phone.trim(), account_type: 'driver' } } });
        if (error) throw error;
        if (data.session) setSession(data.session);
        else setMessage('Account created. Check your email to confirm the account, then sign in. The admin may need to approve your driver profile.');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setSession(data.session);
      }
    } catch (e) { setMessage(e.message || 'Sign-in failed.'); }
    finally { setBusy(''); }
  }

  async function confirmPickup(a) {
    if (!supabase || !a?.id || a.pickup_status === 'Picked') return;
    if (!window.confirm('Confirm that you have physically collected shipment ' + (a.shipments?.tracking_id || '') + '?')) return;
    setBusy(a.id); setMessage('');
    try {
      const { data, error } = await supabase.rpc('driver_confirm_pickup', { p_assignment_id: a.id });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Pickup could not be confirmed.');
      setMessage('Pickup confirmed for ' + (data.tracking_id || a.shipments?.tracking_id || 'shipment') + '. Admin and customer status will update from Supabase.');
      await loadAssignments();
    } catch (e) { setMessage(e.message || 'Pickup confirmation failed. Please retry or contact the admin.'); }
    finally { setBusy(''); }
  }

  async function signOut() { await supabase?.auth.signOut(); setAssignments([]); setSession(null); }

  if (!supabase) return <main className="shell"><section className="panel"><div className="brand"><Truck size={28}/><span>NYAGO CARGO</span></div><h1>Driver Pickup</h1><p className="notice">Configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the Vercel project environment variables, then redeploy.</p></section></main>;

  if (!session) return <main className="shell auth-shell"><section className="panel auth-panel"><div className="brand"><Truck size={28}/><span>NYAGO CARGO</span></div><p className="eyebrow">PICKUP OPERATIONS</p><h1>{registering ? 'Create driver account' : 'Driver sign in'}</h1><p className="muted">Receive pickup assignments and confirm collection directly from your phone.</p><form onSubmit={signIn}>
    {registering && <><label>Full name<input value={name} onChange={e=>setName(e.target.value)} required autoComplete="name" placeholder="Driver full name"/></label><label>Phone number<input value={phone} onChange={e=>setPhone(e.target.value)} autoComplete="tel" placeholder="+966…"/></label></>}
    <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email" placeholder="driver@example.com"/></label>
    <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} autoComplete={registering?'new-password':'current-password'} placeholder="Password"/></label>
    <button className="primary" disabled={busy==='auth'}>{busy==='auth'?'Please wait…':registering?'Create account':'Sign in'} <LogIn size={18}/></button>
  </form><button className="link-button" onClick={()=>{setRegistering(!registering);setMessage('');}}>{registering?'Already registered? Sign in':'New driver? Create an account'}</button>{message&&<p className="notice">{message}</p>}<p className="tiny">Driver accounts should only be used by authorized pickup personnel.</p></section></main>;

  return <main className="shell"><header className="topbar"><div className="brand"><Truck size={26}/><span>NYAGO CARGO</span></div><button className="icon-button" onClick={signOut} aria-label="Sign out"><LogOut size={18}/></button></header><section className="welcome"><p className="eyebrow">DRIVER PORTAL</p><h1>Your pickup tasks</h1><p className="muted">Collect the shipment, then confirm pickup so the admin and customer can see the update.</p><div className="stats"><div><strong>{assignments.filter(a=>a.pickup_status!=='Picked').length}</strong><span>Pending</span></div><div><strong>{assignments.filter(a=>a.pickup_status==='Picked').length}</strong><span>Picked up</span></div></div></section>
    {message&&<div className="notice"><AlertCircle size={18}/><span>{message}</span></div>}
    <div className="section-head"><h2>Assigned shipments</h2><button className="icon-button" onClick={loadAssignments} disabled={loading} aria-label="Refresh assignments"><RefreshCw size={18}/></button></div>
    {loading&&<p className="muted">Loading assignments…</p>}
    {!loading && assignments.length===0 && <section className="empty"><Package size={30}/><h3>No pickups assigned yet</h3><p>Your admin will assign shipments here when pickup is ready.</p></section>}
    <div className="cards">{assignments.map(a=>{const s=a.shipments||{};const picked=a.pickup_status==='Picked';const coords=s.pickup_latitude!=null&&s.pickup_longitude!=null;const maps=coords?'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(s.pickup_latitude+','+s.pickup_longitude):'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(s.pickup_address||s.sender_city||'');return <article className="task-card" key={a.id}><div className="task-title"><div><span className="tracking">{s.tracking_id||'Shipment'}</span><h3>{s.sender_name||'Sender'}</h3></div><span className={'status '+(picked?'done':'pending')}>{picked?'Picked':'Assigned'}</span></div><div className="detail"><MapPin size={18}/><div><strong>Pickup location</strong><p>{s.pickup_address||s.sender_city||'Pickup address not provided'}</p>{s.pickup_instructions&&<p className="instructions">{s.pickup_instructions}</p>}</div></div>{s.sender_phone&&<a className="detail link-detail" href={'tel:'+s.sender_phone}><Phone size={18}/><div><strong>Contact sender</strong><p>{s.sender_phone}</p></div></a>}<div className="meta"><span>{s.cargo_type||'Cargo'}</span><span>{s.package_count||1} package(s)</span>{s.weight_kg!=null&&<span>{s.weight_kg} kg</span>}</div><div className="actions"><a className="secondary" href={maps} target="_blank" rel="noreferrer"><Navigation size={17}/> Navigate</a><button className="primary" disabled={picked||busy===a.id} onClick={()=>confirmPickup(a)}>{picked?<><CheckCircle2 size={17}/> Pickup confirmed</>:busy===a.id?'Confirming…':'Confirm Pickup'}</button></div>{picked&&<p className="picked-time"><CheckCircle2 size={15}/> Picked {a.picked_at?new Date(a.picked_at).toLocaleString():''}</p>}</article>})}</div>
    <footer>Nyago Cargo · Driver pickup operations</footer></main>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
