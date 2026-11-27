// Mock backend สำหรับโหมดทดลอง — ใช้ core.js ตัวเดียวกับ Apps Script แต่เก็บข้อมูลใน localStorage
// เข้าระบบโหมดทดลอง: admin/admin, ผู้จัดการ 10001/10001 และ 10002/10002
window.mockBackend = (function () {
  const KEY = 'coaching-demo-db-v4';
  const pad = n => ('0' + n).slice(-2);
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const now = () => { const d = new Date(); return ymd(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const uuid = () => Math.random().toString(36).slice(2, 10);

  function seed() {
    const days = [];
    const d = new Date();
    while (days.length < 4) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) days.push(ymd(d));
    }
    return {
      managers: [
        { id: 'm1', name: 'คุณอรุณี ศรีสุข', title: 'ผู้จัดการฝ่ายขาย', photo: '', email: 'arunee@example.com',
          empId: '10001', username: '10001', password: '10001' },
        { id: 'm2', name: 'คุณธนพล วงศ์ดี', title: 'ผู้จัดการฝ่ายปฏิบัติการ', photo: '', email: '',
          empId: '10002', username: '10002', password: '10002' },
      ],
      members: [
        ['m1', 'สมชาย ใจดี', 'somchai@example.com'], ['m1', 'สมหญิง รักงาน', ''], ['m1', 'วิชัย ขยัน', 'wichai@example.com'],
        ['m2', 'มาลี ตั้งใจ', ''], ['m2', 'ประยุทธ มุ่งมั่น', ''], ['m2', 'กานดา สดใส', ''],
      ].map(([managerId, name, email]) => ({ managerId, name, email })),
      availability: [
        { id: uuid(), managerId: 'm1', date: days[0], start: '10:00', end: '12:00' },
        { id: uuid(), managerId: 'm1', date: days[0], start: '14:00', end: '16:00' },
        { id: uuid(), managerId: 'm1', date: days[2], start: '13:00', end: '15:00' },
        { id: uuid(), managerId: 'm2', date: days[1], start: '09:00', end: '11:30' },
        { id: uuid(), managerId: 'm2', date: days[3], start: '15:00', end: '17:00' },
      ],
      bookings: [
        { managerId: 'm1', date: days[0], start: '10:30', end: '11:00', name: 'วิชัย ขยัน', createdAt: '' },
        { managerId: 'm2', date: days[1], start: '09:30', end: '10:00', name: 'มาลี ตั้งใจ', createdAt: '' },
      ],
    };
  }

  const outbox = [];

  // SHA-256 แบบ synchronous (core.js เป็นแบบ sync จึงใช้ crypto.subtle ที่เป็น async ไม่ได้)
  function sha256Hex(str) {
    const K = [];
    const H = [];
    const frac = x => ((x - Math.floor(x)) * 0x100000000) >>> 0;
    for (let n = 2, c = 0; c < 64; n++) {
      let prime = true;
      for (let i = 2; i * i <= n; i++) if (n % i === 0) { prime = false; break; }
      if (!prime) continue;
      if (c < 8) H[c] = frac(Math.pow(n, 1 / 2));
      K[c++] = frac(Math.pow(n, 1 / 3));
    }
    const bytes = Array.from(new TextEncoder().encode(str));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    const W = new Array(64);
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) {
        W[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
    }
    return H.map(v => ('0000000' + v.toString(16)).slice(-8)).join('');
  }

  function load() {
    try { const db = JSON.parse(localStorage.getItem(KEY)); if (db) return db; } catch (_) {}
    const db = seed(); save(db); return db;
  }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }

  function store(db) {
    return {
      all: t => db[t].map(r => Object.assign({}, r)),
      insert: (t, o) => { db[t].push(Object.assign({}, o)); save(db); },
      removeWhere: (t, fn) => { const n = db[t].length; db[t] = db[t].filter(r => !fn(r)); save(db); return n - db[t].length; },
      updateWhere: (t, fn, patch) => { let n = 0; db[t].forEach(r => { if (fn(r)) { Object.assign(r, patch); n++; } }); save(db); return n; },
    };
  }

  return {
    handle(p) {
      try {
        const core = createCore(store(load()), {
          now, uuid, masterPassword: () => 'admin', hash: sha256Hex,
          // โหมดทดลองไม่ส่งอีเมลจริง แค่บันทึกไว้ดูใน console
          notify: ev => { outbox.push(ev); console.info('[โหมดทดลอง] แจ้งเตือน ' + ev.type, ev); },
        });
        return { ok: true, data: core.handle(p) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    reset() { localStorage.removeItem(KEY); },
    outbox: outbox,
    sha256: sha256Hex,
  };
})();
