const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const { CATS } = require('./words');
const PORT = process.env.PORT || 3000;
const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const server = http.createServer((q, s) => {
  if (q.url === '/health') { s.writeHead(200); return s.end('ok'); }
  s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); s.end(page);
});
const wss = new WebSocketServer({ server });

const CATLIST = Object.entries(CATS).map(([k, c]) => ({ k, n: c.n, e: c.e }));
const COL = ['#ff8787','#ffa94d','#ffd43b','#8ce99a','#63e6be','#74c0fc','#b197fc','#faa2c1','#c0eb75','#99e9f2'];
const EMO = ['😂','🤔','😱','👀','🔥','👏','🤫','😎'];
const rnd = a => a[Math.floor(Math.random() * a.length)];
const shuf = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
const norm = s => String(s || '').trim().replace(/[\u064B-\u065F]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/^ال/, '').replace(/\s+/g, '');
const rooms = {};

function newRoom(code) {
  return { code, clients: new Map(), used: new Set(), last: Date.now(), S: {
    ph: 'lobby', pl: [], host: null, cl: [], vt: {}, mv: {}, rd: 1, t: 0, dl: 0, ord: [], res: null, gm: 0,
    opts: { cats: Object.keys(CATS), timer: 30, knows: true, guess: true } } };
}
function addPlayer(r, id, n) {
  if (r.S.pl.some(p => p.id === id)) return;
  r.S.pl.push({ id, n: String(n || 'لاعب').slice(0, 12), c: COL[r.S.pl.length % 10], s: 0 });
  if (!r.S.host) r.S.host = id;
}
const alive = r => r.S.pl.filter(p => r.clients.has(p.id));
function pickPair(r) {
  for (let pass = 0; pass < 2; pass++) {
    const pool = [];
    r.S.opts.cats.forEach(k => CATS[k].pairs.forEach((p, i) => { if (!r.used.has(k + i)) pool.push([k, i, p]); }));
    if (pool.length) { const [k, i, p] = rnd(pool); r.used.add(k + i); return { k, p }; }
    r.used.clear();
  }
}
function startRound(r) {
  const S = r.S, { k, p } = pickPair(r), sw = Math.random() < .5;
  S.wa = p[sw ? 1 : 0]; S.wb = p[sw ? 0 : 1]; S.cat = CATS[k].e + ' ' + CATS[k].n;
  S.imp = rnd(S.pl).id; S.ord = shuf(S.pl.map(p => p.id));
  S.cl = []; S.rd = 1; S.t = 0; S.vt = {}; S.mv = {}; S.res = null; S.gm++;
  S.ph = 'clues'; S.dl = Date.now() + S.opts.timer * 1000;
}
function tally(r) {
  const S = r.S, cnt = {};
  Object.values(S.vt).forEach(t => cnt[t] = (cnt[t] || 0) + 1);
  const mx = Math.max(0, ...Object.values(cnt)), top = Object.keys(cnt).filter(k => cnt[k] === mx);
  const out = top.length === 1 ? top[0] : null, caught = out === S.imp;
  S.res = { out, caught, cnt, guess: null, stolen: false };
  if (caught && S.opts.guess && r.clients.has(S.imp)) { S.ph = 'guess'; S.dl = Date.now() + 25000; }
  else finalize(r, null);
}
function finalize(r, guess) {
  const S = r.S, rs = S.res;
  rs.guess = guess; rs.stolen = !!(rs.caught && guess && norm(guess) === norm(S.wa));
  S.pl.forEach(p => {
    if (rs.caught && !rs.stolen) { if (p.id !== S.imp && S.vt[p.id] === S.imp) p.s++; }
    else if (p.id === S.imp) p.s += 2;
  });
  S.ph = 'res';
}
function checkVotes(r) { const a = alive(r); if (a.length && a.every(p => r.S.vt[p.id])) tally(r); }
function decideMid(r) {
  const S = r.S, n = Object.values(S.mv).filter(x => x === 'vote').length, m = Object.values(S.mv).filter(x => x === 'more').length;
  if (n > m) { S.ph = 'vote'; S.vt = {}; } else { S.rd++; S.t = 0; S.ph = 'clues'; S.dl = Date.now() + S.opts.timer * 1000; }
  S.mv = {};
}
function checkMid(r) { const a = alive(r); if (a.length && a.every(p => r.S.mv[p.id])) decideMid(r); }
function handle(r, t, d, from) {
  const S = r.S, host = from === S.host;
  if (t === 'opts' && host && (S.ph === 'lobby')) {
    const cats = (Array.isArray(d.cats) ? d.cats : []).filter(k => CATS[k]);
    if (cats.length) S.opts.cats = cats;
    if ([20, 30, 45, 60].includes(+d.timer)) S.opts.timer = +d.timer;
    S.opts.knows = !!d.knows; S.opts.guess = !!d.guess;
  }
  else if (t === 'start' && host && S.ph === 'lobby' && S.pl.length >= 3) startRound(r);
  else if (t === 'clue' && S.ph === 'clues' && from === S.ord[S.t]) {
    S.cl.push({ id: from, x: String(d.x || '—').slice(0, 16), r: S.rd }); S.t++; S.dl = Date.now() + S.opts.timer * 1000;
    if (S.t >= S.ord.length) { if (S.rd >= 3) { S.ph = 'vote'; S.vt = {}; } else { S.ph = 'mid'; S.mv = {}; } }
  }
  else if (t === 'choose' && S.ph === 'mid' && (d.c === 'more' || d.c === 'vote')) { S.mv[from] = d.c; checkMid(r); }
  else if (t === 'decide' && host && S.ph === 'mid') decideMid(r);
  else if (t === 'vote' && S.ph === 'vote' && d.to !== from && S.pl.some(p => p.id === d.to)) { S.vt[from] = d.to; checkVotes(r); }
  else if (t === 'guess' && S.ph === 'guess' && from === S.imp) finalize(r, String(d.x || '').slice(0, 20));
  else if (t === 'again' && host && S.ph === 'res') startRound(r);
  else if (t === 'lobby' && host && S.ph === 'res') { S.ph = 'lobby'; S.res = null; }
  else if (t === 'kick' && host && S.ph === 'lobby' && d.id !== from) {
    S.pl = S.pl.filter(p => p.id !== d.id); const w = r.clients.get(d.id);
    if (w) { r.clients.delete(d.id); send(w, { t: 'err', m: 'تم إخراجك من الغرفة' }); }
  }
}
function broadcast(r) {
  r.last = Date.now(); const S = r.S;
  r.clients.forEach((ws, id) => {
    const v = { ...S, code: r.code, me: id, catlist: CATLIST };
    delete v.mv; v.mc = { more: 0, vote: 0 }; Object.values(S.mv).forEach(c => v.mc[c]++); v.mymv = S.mv[id] || null;
    if (['clues', 'mid', 'vote', 'guess'].includes(S.ph)) {
      v.w = id === S.imp ? S.wb : S.wa;
      v.isImp = id === S.imp && (S.opts.knows || S.ph === 'guess');
    }
    if (S.ph !== 'res') { delete v.imp; delete v.wa; delete v.wb; }
    send(ws, { t: 'st', S: v });
  });
}
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));

wss.on('connection', ws => {
  let room = null, id = null, lastRx = 0;
  ws.isAlive = true; ws.on('pong', () => ws.isAlive = true);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'create' || m.t === 'join') {
      id = String(m.id || '').slice(0, 40); if (!id) return;
      let code = String(m.code || '');
      if (m.t === 'create') { do { code = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms[code]); rooms[code] = newRoom(code); }
      const r = rooms[code]; if (!r) return send(ws, { t: 'err', m: 'الغرفة غير موجودة' });
      const known = r.S.pl.some(p => p.id === id);
      if (!known && r.S.ph !== 'lobby') return send(ws, { t: 'err', m: 'اللعبة بدأت، انتظر الجولة الجاية' });
      if (!known && r.S.pl.length >= 10) return send(ws, { t: 'err', m: 'الغرفة ممتلئة' });
      room = r; const old = r.clients.get(id); if (old && old !== ws) try { old.close(); } catch {}
      r.clients.set(id, ws); addPlayer(r, id, m.n); broadcast(r);
    } else if (m.t === 'act' && room && id) {
      handle(room, String(m.a), m, id); broadcast(room);
    } else if (m.t === 'rx' && room && id && EMO.includes(m.e) && Date.now() - lastRx > 800) {
      lastRx = Date.now(); const p = room.S.pl.find(p => p.id === id);
      room.clients.forEach(w => send(w, { t: 'rx', e: m.e, n: p ? p.n : '' }));
    }
  });
  ws.on('close', () => {
    if (!room || room.clients.get(id) !== ws) return;
    room.clients.delete(id); const S = room.S;
    if (S.ph === 'lobby') {
      S.pl = S.pl.filter(p => p.id !== id);
      if (S.host === id) S.host = S.pl[0] ? S.pl[0].id : null;
    } else {
      if (S.host === id) { const nx = S.pl.find(p => room.clients.has(p.id)); if (nx) S.host = nx.id; }
      if (S.ph === 'vote') checkVotes(room);
      if (S.ph === 'mid') checkMid(room);
      if (S.ph === 'guess' && id === S.imp) finalize(room, null);
    }
    broadcast(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const code in rooms) {
    const r = rooms[code], S = r.S;
    if (!r.clients.size && now - r.last > 10 * 60 * 1000) { delete rooms[code]; continue; }
    if (S.ph === 'clues' && now > S.dl) { handle(r, 'clue', { x: '—' }, S.ord[S.t]); broadcast(r); }
    else if (S.ph === 'guess' && now > S.dl) { finalize(r, null); broadcast(r); }
  }
}, 1000);
setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);
server.listen(PORT, () => console.log('running on ' + PORT));
