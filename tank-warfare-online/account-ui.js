/* Tank Warfare: Evolution - TÀI KHOẢN · ID · TẶNG QUÀ (phía người chơi)
   Cần máy chủ chạy server.js (xem README). Không đăng nhập = chơi khách như cũ (lưu trên máy).
   Đăng nhập: tiến trình (gems, xe, cấp...) lưu trên máy chủ theo tài khoản; mỗi tài khoản có ID 8 chữ số.
   Tặng quà theo ID: 💎 gems · 🚗 xe tăng đã sở hữu · 🔧 xe tuỳ chỉnh trong kho. */
(function () {
  'use strict';
  const LS = 'twe_acc';
  const st = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') } catch (e) { return {} } };
  const put = o => { try { localStorage.setItem(LS, JSON.stringify(Object.assign(st(), o))) } catch (e) { } };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n).toLocaleString('vi-VN');

  let acc = st().acc || null, rev = +st().rev || 0, lastSnap = '', busy = false, dirty = false, kickT = 0, needPull = false;
  let panel = null, msg = '', msgOk = true, who = null;

  /* ---------- địa chỉ máy chủ ---------- */
  function normSrv(s) {
    s = String(s || '').trim().replace(/\/+$/, '');
    if (!s) return '';
    s = s.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
    if (!/^https?:\/\//i.test(s)) s = (/^(localhost|127\.|192\.168\.|10\.)/.test(s) ? 'http://' : 'https://') + s;
    return s;
  }
  function base() {
    const s = st().srv; if (s) return s;
    if (/^https?:$/.test(location.protocol) && !/github\.io$/.test(location.hostname)) return location.origin;
    return '';
  }
  async function api(path, body, method) {
    const b = base(); if (!b) return { status: 0, j: { err: 'Chưa nhập địa chỉ máy chủ' } };
    const h = { 'Content-Type': 'application/json' }; if (acc && acc.token) h.Authorization = 'Bearer ' + acc.token;
    try {
      const r = await fetch(b + path, { method: method || (body ? 'POST' : 'GET'), headers: h, body: body ? JSON.stringify(body) : undefined });
      let j = {}; try { j = await r.json() } catch (e) { }
      return { status: r.status, j };
    } catch (e) { return { status: 0, j: { err: 'Không kết nối được máy chủ' } }; }
  }

  /* ---------- dữ liệu người chơi ---------- */
  function adopt(r) {
    const f = fresh;
    D = Object.assign(f(), r || {});
    D.stats = Object.assign(f().stats, D.stats); D.chests = Object.assign(f().chests, D.chests);
    D.st = Object.assign(f().st, D.st); D.cap = Object.assign(f().cap, D.cap); D.bkm = Object.assign(f().bkm, D.bkm);
    D.chain = Object.assign(f().chain, D.chain); D.qs = D.qs || {}; D.spins = D.spins || 0; D.gems = +D.gems || 0;
    D.owned = (Array.isArray(D.owned) ? D.owned : ['basic']).filter(k => S[k]); if (!D.owned.includes('basic')) D.owned.push('basic');
    D.garage = Array.isArray(D.garage) ? D.garage : [];
    if (D.custom) { if (!D.custom.gid) D.custom.gid = 'T' + Date.now().toString(36); regCustom(); if (D.customSel) D.type = 'custom'; }
    else { try { delete S.custom } catch (e) { } if (D.type === 'custom') D.type = 'basic'; }
    if (!S[D.type] || D.type === 'pentarailgun') D.type = 'basic';
    try { localStorage.setItem(KEY, JSON.stringify(D)) } catch (e) { }
    lastSnap = JSON.stringify(D); dirty = false;
    menuInfo();
    try { if (typeof renderShop === 'function' && !$('shop').classList.contains('hidden')) renderShop() } catch (e) { }
  }
  function loadGuest() { try { const r = JSON.parse(localStorage.getItem(KEY) || 'null'); adopt(r || fresh()); } catch (e) { adopt(fresh()); } }
  const inMenu = () => !player && !$('menu').classList.contains('hidden');

  /* ---------- đồng bộ ---------- */
  function toast(t) {
    let el = document.getElementById('twToast');
    if (!el) { el = document.createElement('div'); el.id = 'twToast'; el.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 10px);left:50%;transform:translateX(-50%);z-index:9999;max-width:92vw;background:#0f172a;border:2px solid #fbbf24;color:#fde68a;padding:10px 16px;border-radius:12px;font:600 14px sans-serif;text-align:center;white-space:pre-line;box-shadow:0 6px 24px #000a'; document.body.appendChild(el); }
    el.textContent = t; el.style.display = 'block'; clearTimeout(el._t); el._t = setTimeout(() => el.style.display = 'none', 7000);
  }
  function giftText(g) {
    const fr = g.from ? g.from.name + ' (ID ' + g.from.id + ')' : 'Ai đó';
    const nm = g.kind === 'tank' ? (S[g.key] ? S[g.key].name : g.key) : g.name || 'Xe tuỳ chỉnh';
    if (g.rejected) return '↩️ Bạn đã có xe ' + nm + ' nên đã trả lại cho ' + fr;
    if (g.returned) return '↩️ ' + fr + ' đã có xe ' + nm + ' nên trả lại bạn';
    if (g.kind === 'gems') return '🎁 ' + fr + ' tặng bạn 💎 ' + num(g.amount);
    if (g.kind === 'tank') return '🎁 ' + fr + ' tặng bạn xe tăng ' + nm;
    return '🎁 ' + fr + ' tặng bạn xe tuỳ chỉnh ' + nm + ' (xem trong Kho xe ở phòng 🔧 newtank)';
  }
  function expired() {
    acc = null; put({ acc: null }); KEY = KEY0; loadGuest(); msg = 'Hết phiên đăng nhập, hãy đăng nhập lại'; msgOk = false; draw();
  }
  /* push=true: gửi tiến trình lên; luôn nhận quà trong hòm thư. Trả về true nếu thành công */
  async function sync(push, force) {
    if (!acc || busy || (!force && !inMenu())) return false;
    busy = true;
    try {
      const snap = JSON.stringify(D);
      const sendData = needPull ? false : (push || snap !== lastSnap);
      const r = await api('/api/sync', sendData ? { data: D, rev } : {});
      if (r.status === 401) { busy = false; expired(); return false; }
      if (r.status === 0) return false;
      const j = r.j || {};
      if (r.status === 409 && j.data) { rev = j.rev; put({ rev }); adopt(j.data); toast('⚠️ ' + j.err); return false; }
      if (r.status !== 200) return false;
      const gifts = j.gifts || [];
      if (needPull || gifts.length) { adopt(j.data); needPull = false; }
      else lastSnap = snap, dirty = false;
      rev = j.rev; put({ rev });
      if (gifts.length) { toast(gifts.map(giftText).join('\n')); draw(); }
      return true;
    } finally { busy = false; }
  }
  const kick = () => { clearTimeout(kickT); kickT = setTimeout(() => { if (acc && inMenu()) sync(true); else if (acc) kick(); }, 2500); };

  /* móc vào các hàm của game */
  const _save = window.save; window.save = function () { const r = _save.apply(this, arguments); if (acc) { dirty = true; kick(); } return r; };
  const _mi = window.menuInfo; window.menuInfo = function () { const r = _mi.apply(this, arguments); if (acc) { const el = $('saveInfo'); if (el) el.insertAdjacentHTML('beforeend', ' · 👤 ' + esc(acc.name) + ' <span style="color:#7dd3fc">(ID ' + esc(acc.id) + ')</span>'); } return r; };
  const _tm = window.toMenu; window.toMenu = function () { const r = _tm.apply(this, arguments); if (acc) setTimeout(() => sync(true), 400); return r; };
  setInterval(() => { if (acc && inMenu()) sync(false); }, 20000);
  window.addEventListener('beforeunload', () => {
    if (!acc || player || !(dirty || JSON.stringify(D) !== lastSnap)) return;
    try { fetch(base() + '/api/sync', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + acc.token }, body: JSON.stringify({ data: D, rev }) }) } catch (e) { }
  });

  /* ---------- đăng nhập / đăng ký / đăng xuất ---------- */
  async function auth(kind) {
    const name = panel.querySelector('#aN').value.trim(), pass = panel.querySelector('#aP').value;
    const srv = panel.querySelector('#aS'); if (srv) put({ srv: normSrv(srv.value) });
    if (!name || !pass) { msg = 'Nhập tên và mật khẩu'; msgOk = false; return draw(); }
    msg = 'Đang xử lý...'; msgOk = true; draw();
    const body = { name, pass };
    if (kind === 'register') body.data = panel.querySelector('#aM') && panel.querySelector('#aM').checked ? D : fresh(); // mặc định: tài khoản mới = xe tăng cơ bản
    const r = await api('/api/' + kind, body);
    if (r.status !== 200) { msg = (r.j && r.j.err) || 'Lỗi'; msgOk = false; return draw(); }
    const j = r.j;
    acc = { token: j.token, id: j.id, name: j.name, admin: !!j.admin };
    KEY = KEY0 + '_' + j.id; rev = j.rev || 0; put({ acc, rev });
    needPull = false;
    adopt(j.data || fresh());
    if (!j.data) { const r2 = await api('/api/sync', { data: D, rev }); if (r2.status === 200) { rev = r2.j.rev; put({ rev }); } }
    msg = 'Đã đăng nhập: ' + j.name + ' (ID ' + j.id + ')'; msgOk = true; who = null; draw();
    sync(false, true);
  }
  async function logout() {
    if (!acc) return;
    await sync(true, true);
    await api('/api/logout', {});
    acc = null; put({ acc: null, rev: 0 }); KEY = KEY0; loadGuest();
    msg = 'Đã đăng xuất (về chế độ khách)'; msgOk = true; who = null; draw();
  }

  /* ---------- tặng quà ---------- */
  const VOLT = () => {
    const mk = (k, n) => Array.from({ length: n }, () => ({ k, a: 0, o: 0, p: 0, wm: 1 }));
    return { gid: 'VOLTGIFT', name: 'VOLT LÃNH CHÚA', color: '#67e8f9', shape: 'o', hp: 12000, speed: 5.2, body: 160, reload: 6, dmg: 220, ps: 30, pr: 11, b: [...mk('e', 10), ...mk('en', 5), ...mk('r', 8)], r: [] };
  };
  async function lookup() {
    const id = panel.querySelector('#gI').value.trim();
    if (!/^\d{8}$/.test(id)) { who = { err: 'ID gồm 8 chữ số' }; return draw(true); }
    const r = await api('/api/lookup?id=' + encodeURIComponent(id));
    who = r.status === 200 ? r.j : { err: (r.j && r.j.err) || 'Lỗi' }; draw(true);
  }
  async function gift() {
    const id = panel.querySelector('#gI').value.trim(), kind = panel.querySelector('#gK').value;
    if (!/^\d{8}$/.test(id)) { msg = 'ID người nhận gồm 8 chữ số'; msgOk = false; return draw(true); }
    const body = { to: id, kind }; let what = '';
    if (kind === 'gems') { body.amount = Math.floor(+panel.querySelector('#gA').value); what = '💎 ' + num(body.amount); }
    else if (kind === 'tank') { body.key = panel.querySelector('#gT').value; what = 'xe ' + (S[body.key] ? S[body.key].name : body.key); }
    else if (kind === 'custom') { body.gid = panel.querySelector('#gT').value; const g = D.garage.find(x => x.gid === body.gid); what = 'xe tuỳ chỉnh ' + (g ? g.name : ''); }
    else if (kind === 'volt') { body.kind = 'custom'; body.spec = VOLT(); what = 'xe VOLT LÃNH CHÚA'; }
    const t = who && who.id === id ? who.name + ' ' : '';
    if (!confirm('Tặng ' + what + ' cho ' + t + '(ID ' + id + ')?\nKhông thể lấy lại.')) return;
    msg = 'Đang gửi...'; msgOk = true; draw(true);
    if (!(await sync(true, true))) { msg = 'Không đồng bộ được với máy chủ, thử lại'; msgOk = false; return draw(true); }
    const r = await api('/api/gift', body);
    if (r.status !== 200) { msg = (r.j && r.j.err) || 'Lỗi'; msgOk = false; return draw(true); }
    rev = r.j.rev; put({ rev }); adopt(r.j.data);
    msg = '✅ Đã tặng ' + what + ' cho ' + r.j.to.name + ' (ID ' + r.j.to.id + ')'; msgOk = true; who = null; draw();
  }

  /* ---------- giao diện ---------- */
  const IN = 'width:100%;box-sizing:border-box;padding:8px;font-size:14px';
  function draw(keep) {
    if (!panel || panel.classList.contains('hidden')) return;
    let h = '<h1 style="font-size:26px">👤 TÀI KHOẢN</h1><div class="pn" style="width:min(380px,92vw);display:flex;flex-direction:column;gap:8px;text-align:left;font-size:13px">';
    if (msg) h += '<div style="color:' + (msgOk ? '#86efac' : '#fca5a5') + ';font-weight:600">' + esc(msg) + '</div>';
    if (!acc) {
      h += '<div class="mu">Đăng nhập để lưu tiến trình trên máy chủ, có <b>ID</b> riêng và nhận/tặng quà. Không đăng nhập = chơi khách (lưu trên máy này).</div>';
      h += '<input id="aN" placeholder="Tên đăng nhập (3-16, không dấu)" autocomplete="username" style="' + IN + '"><input id="aP" type="password" placeholder="Mật khẩu (từ 6 ký tự)" autocomplete="current-password" style="' + IN + '">';
      h += '<label class="mu" style="display:flex;gap:6px;align-items:center"><input id="aM" type="checkbox"> Khi tạo mới: chuyển tiến trình đang chơi sang tài khoản (bỏ chọn = bắt đầu với xe tăng mặc định)</label>';
      h += '<div style="display:flex;gap:8px"><button id="aL" style="flex:1;padding:10px;background:#0369a1">ĐĂNG NHẬP</button><button id="aR" class="gold" style="flex:1;padding:10px">TẠO TÀI KHOẢN</button></div>';
      h += '<input id="aS" placeholder="Địa chỉ máy chủ (vd https://ten.onrender.com)" value="' + esc(st().srv || '') + '" style="' + IN + '"><div class="mu" style="font-size:11px">' + (base() ? 'Máy chủ đang dùng: ' + esc(base()) : 'Chưa có máy chủ: chạy server.js rồi nhập địa chỉ vào ô trên.') + '</div>';
    } else {
      h += '<div style="text-align:center"><div class="mu">ID của bạn (đưa cho bạn bè để họ tặng quà)</div><div style="font-size:30px;font-weight:800;letter-spacing:3px;color:#7dd3fc">' + esc(acc.id) + '</div><button id="aC" style="padding:5px 12px">📋 Sao chép ID</button><div style="margin-top:6px">' + esc(acc.name) + (acc.admin ? ' <b style="color:#fbbf24">· ADMIN</b>' : '') + ' · 💎 <b style="color:#fcd34d">' + num(D.gems) + '</b></div></div>';
      h += '<hr style="width:100%;border:0;border-top:1px solid #334155"><b style="color:#fbbf24">🎁 TẶNG QUÀ</b>';
      h += '<div style="display:flex;gap:6px"><input id="gI" inputmode="numeric" maxlength="8" placeholder="ID người nhận (8 số)" value="' + esc(keep && panel.querySelector('#gI') ? panel.querySelector('#gI').value : '') + '" style="flex:1;min-width:0;padding:8px;font-size:14px"><button id="gL" style="padding:6px 10px">Kiểm tra</button></div>';
      if (who) h += '<div style="color:' + (who.err ? '#fca5a5' : '#86efac') + '">' + (who.err ? esc(who.err) : '✔ ' + esc(who.name)) + '</div>';
      const own = D.owned.filter(k => k !== 'basic' && S[k]), gar = D.garage || [];
      const kind = keep && panel.querySelector('#gK') ? panel.querySelector('#gK').value : 'gems';
      h += '<select id="gK" style="' + IN + '"><option value="gems"' + (kind === 'gems' ? ' selected' : '') + '>💎 Gems</option><option value="tank"' + (kind === 'tank' ? ' selected' : '') + '>🚗 Xe tăng đã sở hữu (' + own.length + ')</option><option value="custom"' + (kind === 'custom' ? ' selected' : '') + '>🔧 Xe tuỳ chỉnh trong kho (' + gar.length + ')</option>' + (acc.admin ? '<option value="volt"' + (kind === 'volt' ? ' selected' : '') + '>👑 VOLT LÃNH CHÚA (admin)</option>' : '') + '</select>';
      if (kind === 'gems') h += '<input id="gA" type="number" min="1" placeholder="Số gems" style="' + IN + '">' + (acc.admin ? '<div class="mu" style="font-size:11px">Admin: tặng không bị trừ gems.</div>' : '');
      else if (kind === 'tank') h += own.length ? '<select id="gT" style="' + IN + '">' + own.map(k => '<option value="' + esc(k) + '">' + esc(S[k].name) + ' (' + esc(S[k].tier) + ')</option>').join('') + '</select>' : '<div class="mu">Bạn chưa có xe nào để tặng (xe mặc định không tặng được).</div>';
      else if (kind === 'custom') h += gar.length ? '<select id="gT" style="' + IN + '">' + gar.map(g => '<option value="' + esc(g.gid) + '">' + esc(g.name || g.gid) + '</option>').join('') + '</select>' : '<div class="mu">Kho xe tuỳ chỉnh trống.</div>';
      h += '<button id="gS" class="gold" style="padding:10px">🎁 TẶNG</button>';
      h += '<div class="mu" style="font-size:11px">Quà đến hòm thư người nhận; họ nhận được khi đang ở menu (tự động trong ~20 giây hoặc khi bấm Đồng bộ). Quà bạn tặng sẽ bị trừ khỏi bạn (trừ admin). Người nhận đã có xe đó thì xe được trả lại cho bạn.</div>';
      h += '<div style="display:flex;gap:8px"><button id="aY" style="flex:1;padding:8px;background:#0369a1">🔄 Đồng bộ / nhận quà</button><button id="aO" class="red" style="flex:1;padding:8px">ĐĂNG XUẤT</button></div>';
    }
    h += '<button id="aX" class="red" style="padding:8px">ĐÓNG ✕</button></div>';
    const pv = { n: !acc && panel.querySelector('#aN') ? panel.querySelector('#aN').value : '', p: !acc && panel.querySelector('#aP') ? panel.querySelector('#aP').value : '' };
    panel.innerHTML = h;
    const q = s => panel.querySelector(s);
    if (q('#aN')) { q('#aN').value = pv.n; q('#aP').value = pv.p; q('#aL').onclick = () => auth('login'); q('#aR').onclick = () => auth('register'); q('#aP').onkeydown = e => { if (e.key === 'Enter') auth('login') }; }
    if (q('#aC')) q('#aC').onclick = () => { try { navigator.clipboard.writeText(acc.id); toast('Đã sao chép ID ' + acc.id) } catch (e) { toast('ID: ' + acc.id) } };
    if (q('#gL')) q('#gL').onclick = lookup;
    if (q('#gK')) q('#gK').onchange = () => draw(true);
    if (q('#gS')) q('#gS').onclick = gift;
    if (q('#aY')) q('#aY').onclick = async () => { msg = (await sync(true, true)) ? 'Đã đồng bộ' : 'Không đồng bộ được'; msgOk = msg === 'Đã đồng bộ'; draw(true); };
    if (q('#aO')) q('#aO').onclick = logout;
    q('#aX').onclick = close;
  }
  function open() {
    if (!panel) { panel = document.createElement('div'); panel.id = 'accPanel'; panel.className = 'ov hidden'; panel.style.zIndex = 40; document.body.appendChild(panel); }
    panel.classList.remove('hidden'); msg = ''; who = null; draw();
    if (acc) sync(true, true);
  }
  function close() { if (panel) panel.classList.add('hidden'); menuInfo(); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel && !panel.classList.contains('hidden')) { close(); e.stopPropagation(); } }, true);

  /* ---------- khởi động: khôi phục phiên ---------- */
  if (acc) {
    KEY = KEY0 + '_' + acc.id;
    let cache = null; try { cache = JSON.parse(localStorage.getItem(KEY) || 'null') } catch (e) { }
    if (cache) adopt(cache); else { adopt(fresh()); needPull = true; } // chưa có bản lưu trên máy: tải từ máy chủ
    setTimeout(() => sync(true, true), 600);
  }
  window.TWE_ACC = { open, close, sync: () => sync(true, true), get account() { return acc } };
})();
