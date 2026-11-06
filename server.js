const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const server = http.createServer((q, s) => {
  if (q.url === '/health') { s.writeHead(200); return s.end('ok'); }
  s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); s.end(page);
});
const wss = new WebSocketServer({ server });

const WP = [["باب","نافذة"],["مروحة","مكيف"],["قهوة","شاي"],["أسد","نمر"],["سيارة","دباب"],["مطار","ميناء"],["مدرسة","جامعة"],["بحر","نهر"],["قمر","شمس"],["كبسة","مندي"],["جوال","لابتوب"],["تمر","زبيب"],["جمل","حصان"],["مطر","ثلج"],["ساعة","منبه"],["كرسي","طاولة"],["نخلة","شجرة"],["صقر","نسر"],["بيتزا","برجر"],["مسجد","مستشفى"],["قلم","مسطرة"],["ذهب","فضة"],["سفينة","طائرة"],["دجاج","سمك"],["مكتبة","مدرسة"],["كورة","سلة"],["ثلاجة","فريزر"],["شنطة","محفظة"],["عسل","سكر"],["جبل","تلة"]];
const COL = ['#ff8787','#ffa94d','#ffd43b','#8ce99a','#63e6be','#74c0fc','#b197fc','#faa2c1','#c0eb75','#99e9f2'];
const rnd = a => a[Math.floor(Math.random() * a.length)];
const shuf = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
const rooms = {};

function newRoom(code) { return { code, clients: new Map(), S: { ph: 'lobby', pl: [], host: null, cl: [], vt: {}, rd: 1, t: 0, dl: 0, ord: [], res: null }, last: Date.now() }; }
function addPlayer(r, id, n) {
  if (r.S.pl.some(p => p.id === id)) return;
  r.S.pl.push({ id, n: String(n || 'لاعب').slice(0, 12), c: COL[r.S.pl.length % 10], s: 0 });
  if (!r.S.host) r.S.host = id;
}
function startRound(r) {
  const S = r.S, pr = rnd(WP), sw = Math.random() < .5;
  S.wa = pr[sw ? 1 : 0]; S.wb = pr[sw ? 0 : 1]; S.imp = rnd(S.pl).id; S.ord = shuf(S.pl.map(p => p.id));
  S.cl = []; S.rd = 1; S.t = 0; S.vt = {}; S.res = null; S.ph = 'clues'; S.dl = Date.now() + 30000;
}
function tally(r) {
  const S = r.S, cnt = {};
  Object.values(S.vt).forEach(t => cnt[t] = (cnt[t] || 0) + 1);
  const mx = Math.max(0, ...Object.values(cnt)), top = Object.keys(cnt).filter(k => cnt[k] === mx);
  const out = top.length === 1 ? top[0] : null, caught = out === S.imp;
  S.pl.forEach(p => { if (caught) { if (p.id !== S.imp && S.vt[p.id] === S.imp) p.s++; } else if (p.id === S.imp) p.s += 2; });
  S.res = { out, caught, cnt }; S.ph = 'res';
}
function checkVotes(r) {
  const alive = r.S.pl.filter(p => r.clients.has(p.id));
  if (alive.length && alive.every(p => r.S.vt[p.id])) tally(r);
}
function handle(r, t, d, from) {
  const S = r.S, host = from === S.host;
  if (t === 'start' && host && S.ph === 'lobby' && S.pl.length >= 3) startRound(r);
  else if (t === 'clue' && S.ph === 'clues' && from === S.ord[S.t]) {
    S.cl.push({ id: from, x: String(d.x || '—').slice(0, 16), r: S.rd }); S.t++; S.dl = Date.now() + 30000;
    if (S.t >= S.ord.length) S.ph = 'mid';
  }
  else if (t === 'more' && host && S.ph === 'mid' && S.rd < 3) { S.rd++; S.t = 0; S.ph = 'clues'; S.dl = Date.now() + 30000; }
  else if (t === 'tovote' && host && S.ph === 'mid') { S.ph = 'vote'; S.vt = {}; }
  else if (t === 'vote' && S.ph === 'vote' && d.to !== from && S.pl.some(p => p.id === d.to)) { S.vt[from] = d.to; checkVotes(r); }
  else if (t === 'again' && host && S.ph === 'res') startRound(r);
  else if (t === 'kick' && host && S.ph === 'lobby') { S.pl = S.pl.filter(p => p.id !== d.id || p.id === from); }
}
function broadcast(r) {
  r.last = Date.now();
  const S = r.S;
  r.clients.forEach((ws, id) => {
    const v = { ...S, code: r.code, me: id };
    if (S.ph === 'clues' || S.ph === 'mid' || S.ph === 'vote') v.w = id === S.imp ? S.wb : S.wa;
    if (S.ph !== 'res') { delete v.imp; delete v.wa; delete v.wb; }
    if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'st', S: v }));
  });
}
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));

wss.on('connection', ws => {
  let room = null, id = null;
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
  }
}, 1000);
setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);
server.listen(PORT, () => console.log('running on ' + PORT));
