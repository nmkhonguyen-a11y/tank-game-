/* Tank Warfare: Evolution - HỆ THỐNG TÀI KHOẢN (phía máy chủ)
   - Tài khoản: tên đăng nhập + mật khẩu (băm scrypt), mỗi tài khoản có ID 8 chữ số.
   - Lưu tiến trình (gems, xe sở hữu, cấp...) trên máy chủ -> đăng nhập máy nào cũng có.
   - Tặng quà theo ID: gems / xe tăng đã sở hữu / xe tuỳ chỉnh trong kho. Quà vào "hòm thư",
     người nhận nhận khi đồng bộ (đang ở menu).
   - Admin (biến môi trường ADMIN_USERS=ten1,ten2): tặng không bị trừ của mình.
   - Dữ liệu: file JSON (DATA_FILE, mặc định ./accounts.json). Lưu ý: ổ đĩa Render/Railway miễn phí
     có thể bị xoá khi khởi động lại -> gắn Disk/Volume và đặt DATA_FILE trỏ vào đó.
   Không cần cài thư viện. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'accounts.json');
const ADMINS = (process.env.ADMIN_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const MAX_BODY = 1024 * 1024, SESSION_MS = 30 * 24 * 3600 * 1000, MAX_INBOX = 200;

let db = { users: {}, ids: {}, sessions: {} };
try { const j = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); if (j && j.users) db = Object.assign(db, j); } catch (e) { }
let dirty = false, writing = false;
function flush() {
  if (!dirty || writing) return; dirty = false; writing = true;
  const tmp = DATA_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), err => {
    if (err) { writing = false; dirty = true; return; }
    fs.rename(tmp, DATA_FILE, () => { writing = false; if (dirty) setTimeout(flush, 200); });
  });
}
const mark = () => { dirty = true; setTimeout(flush, 500); };
function flushSync() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch (e) { } }
process.on('SIGTERM', () => { flushSync(); process.exit(0); });
process.on('SIGINT', () => { flushSync(); process.exit(0); });

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const scrypt = (pass, salt) => new Promise((res, rej) => crypto.scrypt(pass, salt, 32, (e, k) => e ? rej(e) : res(k)));
const newId = () => { for (let i = 0; i < 50; i++) { const id = String(10000000 + crypto.randomInt(0, 90000000)); if (!db.ids[id]) return id; } throw new Error('id'); };
const isAdmin = u => ADMINS.includes(u.key);
const pub = u => ({ id: u.id, name: u.name, admin: isAdmin(u) });

/* chống đoán mật khẩu: tối đa 20 lần đăng nhập/đăng ký mỗi 10 phút cho 1 IP */
const tries = new Map();
function limited(ip) {
  const now = Date.now(), t = (tries.get(ip) || []).filter(x => now - x < 600000);
  t.push(now); tries.set(ip, t); return t.length > 20;
}
setInterval(() => { const now = Date.now(); tries.forEach((t, k) => { if (!t.some(x => now - x < 600000)) tries.delete(k); }); for (const h in db.sessions) if (db.sessions[h].exp < now) delete db.sessions[h]; }, 600000).unref();

function cors(req, res) {
  const o = req.headers.origin;
  if (o && (!ORIGINS.length || ORIGINS.includes(o))) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  else if (!o && !ORIGINS.length) res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}
function out(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function body(req) {
  return new Promise((res, rej) => {
    let n = 0; const ch = [];
    req.on('data', d => { n += d.length; if (n > MAX_BODY) { rej(new Error('big')); req.destroy(); } else ch.push(d); });
    req.on('end', () => { try { res(ch.length ? JSON.parse(Buffer.concat(ch).toString('utf8')) : {}); } catch (e) { rej(new Error('json')); } });
    req.on('error', rej);
  });
}
function authUser(req, b) {
  const h = req.headers.authorization || '', tk = h.startsWith('Bearer ') ? h.slice(7) : (b && b.token) || '';
  if (!tk) return null;
  const s = db.sessions[sha(String(tk))];
  if (!s || s.exp < Date.now()) return null;
  const id = s.id, k = db.ids[id], u = k && db.users[k];
  return u || null;
}
function login(u) {
  const tk = crypto.randomBytes(32).toString('hex');
  db.sessions[sha(tk)] = { id: u.id, exp: Date.now() + SESSION_MS };
  mark(); return tk;
}
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
const cleanData = d => { const o = JSON.parse(JSON.stringify(d)); delete o.__proto__; return o; };

/* áp dụng hòm thư vào dữ liệu đã lưu của người nhận; trả về danh sách quà đã nhận */
function applyInbox(u) {
  const got = [], d = u.data; if (!d || !u.inbox.length) return got;
  d.owned = Array.isArray(d.owned) ? d.owned : ['basic']; d.garage = Array.isArray(d.garage) ? d.garage : [];
  for (const g of u.inbox) {
    if (g.kind === 'gems') { d.gems = (+d.gems || 0) + g.amount; got.push(g); }
    else if (g.kind === 'tank') {
      if (d.owned.includes(g.key)) { // đã có -> trả lại người tặng
        const s = db.users[db.ids[g.from.id]];
        if (s && s.id !== u.id && s.inbox.length < MAX_INBOX) s.inbox.push({ kind: 'tank', key: g.key, from: { id: u.id, name: u.name }, returned: true, t: Date.now() });
        got.push(Object.assign({}, g, { rejected: true }));
      } else { d.owned.push(g.key); got.push(g); }
    } else if (g.kind === 'custom' && isObj(g.spec)) {
      const spec = JSON.parse(JSON.stringify(g.spec));
      if (d.garage.some(x => x.gid === spec.gid)) spec.gid = String(spec.gid).slice(0, 24) + '_' + crypto.randomBytes(2).toString('hex');
      d.garage.push(spec); got.push(Object.assign({}, g, { spec: undefined, name: spec.name }));
    }
  }
  u.inbox = []; return got;
}

async function handle(req, res, url) {
  if (!url.startsWith('/api/')) return false;
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  try {
    if (url === '/api/ping') return out(res, 200, { ok: true, accounts: true }), true;
    let b = {};
    if (req.method === 'POST') b = await body(req);

    if (url === '/api/register' && req.method === 'POST') {
      if (limited(ip)) return out(res, 429, { err: 'Thử quá nhiều lần, đợi vài phút' }), true;
      const name = String(b.name || '').trim(), pass = String(b.pass || '');
      if (!/^[A-Za-z0-9_.-]{3,16}$/.test(name)) return out(res, 400, { err: 'Tên 3-16 ký tự: chữ không dấu, số, _ . -' }), true;
      if (pass.length < 6 || pass.length > 64) return out(res, 400, { err: 'Mật khẩu 6-64 ký tự' }), true;
      const key = name.toLowerCase();
      if (db.users[key]) return out(res, 409, { err: 'Tên đã có người dùng' }), true;
      const salt = crypto.randomBytes(16).toString('hex'), hash = (await scrypt(pass, salt)).toString('hex');
      if (db.users[key]) return out(res, 409, { err: 'Tên đã có người dùng' }), true;
      const u = { key, id: newId(), name, salt, hash, data: null, rev: 0, inbox: [], created: Date.now() };
      db.users[key] = u; db.ids[u.id] = key;
      if (isObj(b.data)) { u.data = cleanData(b.data); u.rev = 1; }
      const token = login(u); mark();
      return out(res, 200, Object.assign({ token, data: u.data, rev: u.rev }, pub(u))), true;
    }
    if (url === '/api/login' && req.method === 'POST') {
      if (limited(ip)) return out(res, 429, { err: 'Thử quá nhiều lần, đợi vài phút' }), true;
      const u = db.users[String(b.name || '').trim().toLowerCase()];
      const pass = String(b.pass || '').slice(0, 64);
      const ok = u && crypto.timingSafeEqual(await scrypt(pass, u.salt), Buffer.from(u.hash, 'hex'));
      if (!ok) return out(res, 401, { err: 'Sai tên hoặc mật khẩu' }), true;
      const token = login(u);
      return out(res, 200, Object.assign({ token, data: u.data, rev: u.rev }, pub(u))), true;
    }

    const u = authUser(req, b);
    if (!u) return out(res, 401, { err: 'Hết phiên đăng nhập, hãy đăng nhập lại', auth: true }), true;

    if (url === '/api/logout' && req.method === 'POST') {
      const h = req.headers.authorization || ''; const tk = h.startsWith('Bearer ') ? h.slice(7) : b.token;
      delete db.sessions[sha(String(tk))]; mark(); return out(res, 200, { ok: true }), true;
    }
    if (url === '/api/sync' && req.method === 'POST') {
      /* b.data (tuỳ chọn) + b.rev: đẩy tiến trình lên. Nếu rev lệch (đã chơi ở máy khác) -> trả dữ liệu mới, không ghi đè. */
      if (isObj(b.data)) {
        if (u.data && +b.rev !== u.rev) return out(res, 409, { err: 'Tài khoản vừa được dùng ở nơi khác, đã tải dữ liệu mới nhất', data: u.data, rev: u.rev }), true;
        u.data = cleanData(b.data); u.rev++;
      }
      const gifts = applyInbox(u); if (gifts.length) u.rev++;
      mark();
      return out(res, 200, { data: u.data, rev: u.rev, gifts }), true;
    }
    if (url.startsWith('/api/lookup')) {
      const id = (new URL(url, 'http://x').searchParams.get('id') || '').trim();
      const t = db.users[db.ids[id]];
      if (!t) return out(res, 404, { err: 'Không có tài khoản với ID này' }), true;
      return out(res, 200, { id: t.id, name: t.name }), true;
    }
    if (url === '/api/gift' && req.method === 'POST') {
      const t = db.users[db.ids[String(b.to || '').trim()]], adm = isAdmin(u);
      if (!t) return out(res, 404, { err: 'Không có tài khoản với ID này' }), true;
      if (t.id === u.id && !adm) return out(res, 400, { err: 'Không thể tự tặng cho mình' }), true;
      if (!u.data) return out(res, 400, { err: 'Hãy đồng bộ dữ liệu trước' }), true;
      if (t.inbox.length >= MAX_INBOX) return out(res, 400, { err: 'Hòm thư người nhận đầy' }), true;
      const d = u.data, from = { id: u.id, name: u.name }, kind = b.kind;
      d.owned = Array.isArray(d.owned) ? d.owned : ['basic']; d.garage = Array.isArray(d.garage) ? d.garage : [];
      let g;
      if (kind === 'gems') {
        const n = Math.floor(+b.amount);
        if (!(n >= 1) || n > 1e12) return out(res, 400, { err: 'Số gems không hợp lệ' }), true;
        if (!adm && n > (+d.gems || 0)) return out(res, 400, { err: 'Bạn không đủ gems' }), true;
        if (!adm) d.gems = (+d.gems || 0) - n;
        g = { kind, amount: n };
      } else if (kind === 'tank') {
        const k = String(b.key || '');
        if (k === 'basic') return out(res, 400, { err: 'Không tặng được xe mặc định' }), true;
        if (!adm && !d.owned.includes(k)) return out(res, 400, { err: 'Bạn không có xe này' }), true;
        if (t.data && Array.isArray(t.data.owned) && t.data.owned.includes(k)) return out(res, 400, { err: 'Người nhận đã có xe này' }), true;
        if (!adm) { d.owned = d.owned.filter(x => x !== k); if (d.type === k) d.type = 'basic'; }
        g = { kind, key: k };
      } else if (kind === 'custom') {
        const gid = String(b.gid || ''); let spec;
        if (adm && isObj(b.spec) && b.spec.gid) { spec = b.spec; }
        else {
          const i = d.garage.findIndex(x => x.gid === gid);
          if (i < 0) return out(res, 400, { err: 'Không có xe tuỳ chỉnh này trong kho' }), true;
          spec = d.garage[i];
          d.garage.splice(i, 1);
          if (d.custom && d.custom.gid === gid) { d.custom = null; d.customSel = false; if (d.type === 'custom') d.type = 'basic'; }
        }
        if (JSON.stringify(spec).length > 200000) return out(res, 400, { err: 'Xe quá lớn' }), true;
        g = { kind, spec: JSON.parse(JSON.stringify(spec)), name: String(spec.name || 'Xe tuỳ chỉnh').slice(0, 40) };
      } else return out(res, 400, { err: 'Loại quà không hợp lệ' }), true;
      t.inbox.push(Object.assign(g, { from, t: Date.now() }));
      u.rev++; mark();
      return out(res, 200, { ok: true, to: { id: t.id, name: t.name }, data: u.data, rev: u.rev }), true;
    }
    return out(res, 404, { err: 'Không tìm thấy' }), true;
  } catch (e) {
    return out(res, e && e.message === 'big' ? 413 : 400, { err: 'Yêu cầu không hợp lệ' }), true;
  }
}
module.exports = { handle };
