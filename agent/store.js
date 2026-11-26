// Saving and loading for the agent builder (PLAN.md task A3). Plain fetch to Supabase REST, no SDK (like the trip apps).
// Access: the agent's secret from the builder link (#a=...) goes in the header x-pab-agent; supabase_agent.sql decides what it may see.
// The publishable key below is public by design (it is in every trip app); it opens nothing without an agent secret.

export const SUPABASE_URL = 'https://ampynsmwdhouzfyyktfc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_HNPV_Rje7XMVWMCXJycWSg_VrED1TMz';
const SECRET_KEY = 'packandboard.agent.secret';

export class Conflict extends Error {}
export class NoAccess extends Error {}

// read the secret from the link once, keep it on this device, and take it out of the address bar
export function takeSecret() {
  const m = location.hash.match(/(?:^#|&)a=([A-Za-z0-9]{20,80})/);
  if (m) {
    try { localStorage.setItem(SECRET_KEY, m[1]); } catch (e) {}
    const rest = location.hash.replace(/^#/, '').split('&').filter((x) => !/^a=/.test(x)).join('&');   // keep a screen given after the secret
    history.replaceState(null, '', location.pathname + location.search + '#' + (rest || '/'));
    return m[1];
  }
  try { return localStorage.getItem(SECRET_KEY); } catch (e) { return null; }
}
export function forgetSecret() { try { localStorage.removeItem(SECRET_KEY); } catch (e) {} }

export function createStore(secret) {
  async function call(method, path, { body, prefer } = {}) {
    const h = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'x-pab-agent': secret };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (prefer) h.Prefer = prefer;
    let r;
    try { r = await fetch(SUPABASE_URL + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }); }
    catch (e) { throw new Error('offline'); }
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) {}
    if (!r.ok) {
      const err = new Error((json && (json.message || json.hint)) || ('HTTP ' + r.status));
      err.status = r.status;
      throw err;
    }
    return json;
  }
  const one = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : null);

  return {
    async me() {
      const me = await call('POST', '/rest/v1/rpc/agent_me', { body: {} });
      if (!me) throw new NoAccess();
      return me;
    },
    async listTrips() {
      return call('GET', '/rest/v1/agent_trips?select=id,status,version,updated_at,changed_since_publish,published,data&status=neq.archived&order=updated_at.desc');
    },
    async getTrip(id) {
      const row = one(await call('GET', '/rest/v1/agent_trips?select=*&id=eq.' + encodeURIComponent(id)));
      if (!row) throw new NoAccess();
      return row;
    },
    async createTrip(agentId, data) {
      return one(await call('POST', '/rest/v1/agent_trips', { body: { agent_id: agentId, data }, prefer: 'return=representation' }));
    },
    // save only if nobody saved in between; returns the new row, or throws Conflict
    async saveTrip(id, version, data) {
      const row = one(await call('PATCH', '/rest/v1/agent_trips?id=eq.' + encodeURIComponent(id) + '&version=eq.' + version, { body: { data }, prefer: 'return=representation' }));
      if (!row) throw new Conflict();
      return row;
    },
    async setStatus(id, status, extra = {}) {
      return one(await call('PATCH', '/rest/v1/agent_trips?id=eq.' + encodeURIComponent(id), { body: Object.assign({ status }, extra), prefer: 'return=representation' }));
    },
    async getPrivate(tripId) {
      const row = one(await call('GET', '/rest/v1/agent_trip_private?select=data&trip_id=eq.' + encodeURIComponent(tripId)));
      return row ? row.data : {};
    },
    async savePrivate(tripId, agentId, data) {
      return call('POST', '/rest/v1/agent_trip_private?on_conflict=trip_id', { body: { trip_id: tripId, agent_id: agentId, data }, prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    // documents for the travellers: the private bucket agent-docs, folder <agent>/<trip>/ (supabase_agent_docs.sql)
    async uploadDoc(agentId, tripId, file) {
      const path = agentId + '/' + tripId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      let r;
      try { r = await fetch(SUPABASE_URL + '/storage/v1/object/agent-docs/' + path, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'x-pab-agent': secret, 'Content-Type': file.type || 'application/octet-stream' }, body: file }); }
      catch (e) { throw new Error('offline'); }
      if (!r.ok) { const err = new Error('HTTP ' + r.status); err.status = r.status; throw err; }
      return path;
    },
    async deleteDoc(path) {
      await fetch(SUPABASE_URL + '/storage/v1/object/agent-docs/' + path, { method: 'DELETE', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'x-pab-agent': secret } }).catch(() => {});
    },
    async docLink(path) {             // a link for 10 minutes, to open the file
      const j = await call('POST', '/storage/v1/object/sign/agent-docs/' + path, { body: { expiresIn: 600 } });
      return SUPABASE_URL + '/storage/v1' + j.signedURL;
    },
    async listSnippets() {
      return call('GET', '/rest/v1/agent_snippets?select=id,dest,category,data&order=updated_at.desc');
    },
    async addSnippet(agentId, s) {
      return one(await call('POST', '/rest/v1/agent_snippets', { body: { agent_id: agentId, dest: s.dest, category: s.category, data: s.data }, prefer: 'return=representation' }));
    },
    async updateSnippet(id, s) {      // the rule "agent edits own snippets" (supabase_agent.sql) allows it
      return one(await call('PATCH', '/rest/v1/agent_snippets?id=eq.' + encodeURIComponent(id), { body: { dest: s.dest, category: s.category, data: s.data }, prefer: 'return=representation' }));
    },
    async deleteSnippet(id) {
      return call('DELETE', '/rest/v1/agent_snippets?id=eq.' + encodeURIComponent(id));
    },
  };
}
