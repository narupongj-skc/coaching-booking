/**
 * Booking core — ใช้ร่วมกันทั้งใน Google Apps Script (คัดลอกไฟล์นี้ไปเป็น Core.gs)
 * และในเบราว์เซอร์ (โหมดทดลอง)
 *
 * store: { all(table), insert(table, obj), removeWhere(table, fn), updateWhere(table, fn, patch) }
 * env:   { now() -> 'yyyy-MM-dd HH:mm', uuid(), masterPassword(), hash(str) -> hex SHA-256, notify?(event) }
 *   notify ถูกเรียกเมื่อมีการจอง/ย้าย/ยกเลิก:
 *   { type: 'book'|'move'|'cancel'|'managerCancel', manager: {id,name,title,email},
 *     member: {name,email}, booking, moved }
 *   book/move/cancel = ลูกทีมทำเอง, managerCancel = ผู้จัดการยกเลิกจากหน้า admin
 *
 * ตาราง:
 *   managers     : id, name, title, photo, password, email, username, empId
 *   members      : managerId, name, email, empId
 *
 * เข้าสู่ระบบหน้า admin: username + password
 *   ผู้จัดการ: ค่าเริ่มต้นทั้งสองช่องคือรหัสพนักงาน (เปลี่ยนเองได้ในหน้าโปรไฟล์)
 *   ผู้ดูแลระบบ: username "admin" + รหัสผ่านหลัก
 *   รหัสผ่านผู้จัดการเก็บเป็น 'sha256$<salt>$<hex>' (ค่าเก่าที่เป็นข้อความธรรมดาจะถูกแปลงเมื่อเข้าระบบสำเร็จ)
 *   availability : id, managerId, date, start, end
 *   bookings     : managerId, date, start, end, name, createdAt
 */
var TABLES = {
  managers: ['id', 'name', 'title', 'photo', 'password', 'email', 'username', 'empId'],
  members: ['managerId', 'name', 'email', 'empId'],
  availability: ['id', 'managerId', 'date', 'start', 'end'],
  bookings: ['managerId', 'date', 'start', 'end', 'name', 'createdAt'],
};

function createCore(store, env) {
  const SLOT = 30; // นาทีต่อช่อง
  const MAX_PHOTO = 45000; // ตัวอักษร (ข้อจำกัด cell ของ Google Sheets คือ 50,000)

  const pad = n => ('0' + n).slice(-2);
  const fail = msg => { throw new Error(msg); };
  const toMin = s => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
    if (!m) fail('รูปแบบเวลาไม่ถูกต้อง: ' + s);
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  const key = (d, s) => d + ' ' + s;
  const byKey = (a, b) => (key(a.date, a.start) < key(b.date, b.start) ? -1 : 1);
  const clean = s => String(s == null ? '' : s).trim();
  const slim = b => (b ? { date: b.date, start: b.start, end: b.end } : null);

  function notify(type, m, name, booking, moved) {
    if (!env.notify) return;
    const mem = store.all('members').find(x => x.managerId === m.id && x.name === name);
    const memberEmail = (mem && mem.email) || '';
    if (!m.email && !memberEmail) return;
    env.notify({
      type: type,
      manager: { id: m.id, name: m.name, title: m.title || '', email: m.email || '' },
      member: { name: name, email: memberEmail },
      booking: slim(booking),
      moved: slim(moved),
    });
  }
  const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
  const checkEmail = e => { if (e && !EMAIL_RE.test(e)) fail('รูปแบบอีเมลไม่ถูกต้อง: ' + e); return e; };

  /* ---------- reads ---------- */
  const managers = () => store.all('managers');
  const manager = id => managers().find(m => m.id === id) || fail('ไม่พบผู้จัดการ');
  const team = mid => store.all('members').filter(x => x.managerId === mid).map(x => x.name);
  const availOf = mid => store.all('availability').filter(a => a.managerId === mid);
  const bookingsOf = mid => store.all('bookings').filter(b => b.managerId === mid);

  function slotsOf(mid) {
    const map = {};
    availOf(mid).forEach(a => {
      for (let t = toMin(a.start); t + SLOT <= toMin(a.end); t += SLOT) {
        map[key(a.date, fromMin(t))] = { date: a.date, start: fromMin(t), end: fromMin(t + SLOT) };
      }
    });
    return Object.keys(map).map(k => map[k]).sort(byKey);
  }

  function profile(m) {
    return { id: m.id, name: m.name, title: m.title || '', photo: m.photo || '' };
  }

  /* ---------- public ---------- */
  function listManagers() {
    const now = env.now();
    return managers().map(m => {
      const booked = {};
      bookingsOf(m.id).forEach(b => { booked[key(b.date, b.start)] = 1; });
      const free = slotsOf(m.id).filter(s => key(s.date, s.start) >= now && !booked[key(s.date, s.start)]).length;
      return Object.assign(profile(m), { freeSlots: free });
    });
  }

  function state(p) {
    const m = manager(p.managerId);
    const now = env.now();
    const name = clean(p.name);
    const bookings = bookingsOf(m.id);
    const booked = {};
    bookings.forEach(b => { booked[key(b.date, b.start)] = b.name; });
    const slots = slotsOf(m.id)
      .filter(s => key(s.date, s.start) >= now)
      .map(s => {
        const who = booked[key(s.date, s.start)];
        return Object.assign({}, s, { status: !who ? 'free' : name && who === name ? 'mine' : 'booked' });
      });
    const mine = name ? bookings.filter(b => b.name === name && key(b.date, b.start) >= now).sort(byKey)[0] : null;
    return {
      manager: profile(m),
      team: team(m.id),
      slots: slots,
      myBooking: mine ? { date: mine.date, start: mine.start, end: mine.end } : null,
    };
  }

  function book(p) {
    const m = manager(p.managerId);
    const name = clean(p.name);
    if (!name || team(m.id).indexOf(name) < 0) fail('กรุณาเลือกชื่อของคุณจากรายการ');
    const now = env.now();
    if (key(p.date, p.start) < now) fail('ช่วงเวลานี้ผ่านไปแล้ว');
    const slot = slotsOf(m.id).find(s => s.date === p.date && s.start === p.start);
    if (!slot) fail('ไม่พบช่วงเวลานี้ อาจถูกลบไปแล้ว');
    const bookings = bookingsOf(m.id);
    if (bookings.some(b => b.date === p.date && b.start === p.start)) fail('ช่วงเวลานี้มีคนจองไปแล้ว กรุณาเลือกช่วงอื่น');

    // คนละ 1 ช่องต่อผู้จัดการ: ย้ายการจองเดิมที่ยังไม่ถึงเวลามาที่ช่องใหม่
    const prev = bookings.filter(b => b.name === name && key(b.date, b.start) >= now).sort(byKey)[0] || null;
    store.removeWhere('bookings', b => b.managerId === m.id && b.name === name && key(b.date, b.start) >= now);
    store.insert('bookings', { managerId: m.id, date: slot.date, start: slot.start, end: slot.end, name: name, createdAt: now });
    notify(prev ? 'move' : 'book', m, name, slot, prev);
    return { booking: slot, moved: slim(prev) };
  }

  // silent = true เมื่อผู้จัดการยกเลิกเองจากหน้า admin (แจ้งลูกทีม ไม่แจ้งผู้จัดการ)
  function cancel(p, silent) {
    const m = manager(p.managerId);
    const name = clean(p.name);
    const b = bookingsOf(m.id).find(x => x.name === name && x.date === p.date && x.start === p.start) || fail('ไม่พบการจองนี้');
    store.removeWhere('bookings', x => x.managerId === m.id && x.name === name && x.date === p.date && x.start === p.start);
    notify(silent ? 'managerCancel' : 'cancel', m, name, b, null);
    return true;
  }

  /* ---------- auth ---------- */
  /* ---------- password hashing ---------- */
  const HASH_PREFIX = 'sha256$';
  const isHashed = stored => String(stored || '').indexOf(HASH_PREFIX) === 0;
  const hashWith = (pw, salt) => HASH_PREFIX + salt + '$' + env.hash(salt + ':' + String(pw));
  const hashPassword = pw => hashWith(pw, String(env.uuid()).replace(/-/g, '').slice(0, 16));
  function verifyPassword(stored, pw) {
    if (!stored || pw == null || pw === '') return false;
    if (isHashed(stored)) return hashWith(pw, String(stored).split('$')[1]) === stored;
    return stored === String(pw); // ค่าเก่าแบบข้อความธรรมดา
  }
  const usesDefault = m => !!m.empId && verifyPassword(m.password, m.empId);

  const MASTER_USER = 'admin';
  const norm = u => clean(u).toLowerCase();

  function login(username, password) {
    const u = norm(username);
    if (!u || !password) fail('กรุณาใส่ชื่อผู้ใช้และรหัสผ่าน');
    if (u === MASTER_USER) {
      if (password === env.masterPassword()) return { role: 'master' };
      fail('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    const m = managers().find(x => norm(x.username) === u);
    if (!m || !verifyPassword(m.password, password)) fail('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    if (!isHashed(m.password)) store.updateWhere('managers', x => x.id === m.id, { password: hashPassword(password) });
    return { role: 'manager', managerId: m.id, username: m.username };
  }

  function checkUsername(u, selfId) {
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(u)) fail('ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ ตัวเลข หรือ . _ - ยาว 3–30 ตัว');
    if (norm(u) === MASTER_USER) fail('ใช้ชื่อผู้ใช้ "admin" ไม่ได้');
    if (managers().some(x => x.id !== selfId && norm(x.username) === norm(u))) fail('ชื่อผู้ใช้นี้มีคนใช้แล้ว');
    return u;
  }

  function scope(session, mid) {
    if (session.role !== 'master' && session.managerId !== mid) fail('ไม่มีสิทธิ์จัดการข้อมูลของผู้จัดการท่านนี้');
    return manager(mid);
  }

  const masterOnly = session => { if (session.role !== 'master') fail('ต้องใช้รหัสผ่านหลัก'); };

  /* ---------- admin ---------- */
  function adminState(session, p) {
    const list = managers();
    const out = { session: session };
    if (session.role === 'master') {
      out.managers = list.map(m => Object.assign(profile(m), {
        hasPassword: !!m.password, hasEmail: !!m.email, username: m.username || '', empId: m.empId || '',
        defaultPassword: usesDefault(m),
      }));
    }
    const wanted = list.some(m => m.id === p.managerId) ? p.managerId : list[0] && list[0].id;
    const mid = session.role === 'master' ? wanted : session.managerId;
    if (!mid) return out;
    const m = manager(mid);
    const today = env.now().slice(0, 10);
    out.manager = Object.assign(profile(m), {
      hasPassword: !!m.password, email: m.email || '', username: m.username || '', empId: m.empId || '',
      defaultPassword: usesDefault(m),
    });
    out.team = team(mid);
    out.members = store.all('members').filter(x => x.managerId === mid).map(x => ({ name: x.name, email: x.email || '' }));
    out.availability = availOf(mid).filter(a => a.date >= today)
      .map(a => ({ id: a.id, date: a.date, start: a.start, end: a.end })).sort(byKey);
    out.bookings = bookingsOf(mid).filter(b => b.date >= today)
      .map(b => ({ date: b.date, start: b.start, end: b.end, name: b.name, createdAt: b.createdAt })).sort(byKey);
    return out;
  }

  function addAvailability(session, p) {
    const m = scope(session, p.managerId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) fail('กรุณาระบุวันที่');
    const s = toMin(p.start), e = toMin(p.end);
    if (s % SLOT || e % SLOT) fail('เวลาต้องลงที่ :00 หรือ :30 เท่านั้น');
    if (e - s < SLOT) fail('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มอย่างน้อย 30 นาที');
    if (key(p.date, fromMin(e)) <= env.now()) fail('ช่วงเวลานี้ผ่านไปแล้ว');
    const clash = availOf(m.id).find(a => a.date === p.date && toMin(a.start) < e && s < toMin(a.end));
    if (clash) fail('ซ้อนกับช่วง ' + clash.start + '–' + clash.end + ' ที่มีอยู่แล้ว');
    const id = env.uuid();
    store.insert('availability', { id: id, managerId: m.id, date: p.date, start: fromMin(s), end: fromMin(e) });
    return id;
  }

  function removeAvailability(session, p) {
    const m = scope(session, p.managerId);
    const a = availOf(m.id).find(x => x.id === p.id) || fail('ไม่พบช่วงเวลานี้');
    const s = toMin(a.start), e = toMin(a.end);
    const inside = bookingsOf(m.id).filter(b => b.date === a.date && toMin(b.start) >= s && toMin(b.start) < e);
    if (inside.length) {
      fail('มีการจองอยู่ในช่วงนี้ (' + inside.map(b => b.start + ' ' + b.name).join(', ') + ') กรุณายกเลิกการจองก่อน');
    }
    store.removeWhere('availability', x => x.id === a.id);
    return true;
  }

  function addMember(session, p) {
    const m = scope(session, p.managerId);
    const name = clean(p.name);
    if (!name) fail('กรุณาระบุชื่อ');
    if (team(m.id).indexOf(name) >= 0) fail('มีชื่อนี้อยู่แล้ว');
    store.insert('members', { managerId: m.id, name: name, email: checkEmail(clean(p.email)) });
    return true;
  }

  function updateMember(session, p) {
    const m = scope(session, p.managerId);
    const email = checkEmail(clean(p.email));
    if (!store.updateWhere('members', x => x.managerId === m.id && x.name === p.name, { email: email })) fail('ไม่พบชื่อนี้');
    return true;
  }

  function removeMember(session, p) {
    const m = scope(session, p.managerId);
    if (!store.removeWhere('members', x => x.managerId === m.id && x.name === p.name)) fail('ไม่พบชื่อนี้');
    return true;
  }

  function saveManager(session, p) {
    const isNew = !p.id;
    if (isNew) masterOnly(session); else scope(session, p.id);
    const name = clean(p.name);
    if (!name) fail('กรุณาระบุชื่อผู้จัดการ');
    const photo = clean(p.photo);
    if (photo.length > MAX_PHOTO) fail('รูปใหญ่เกินไป กรุณาใช้รูปที่เล็กลง');
    const email = checkEmail(clean(p.email));
    const patch = { name: name, title: clean(p.title), photo: photo, email: email };
    const empId = clean(p.empId);
    if (isNew) {
      // ผู้จัดการใหม่: username และ password เริ่มต้น = รหัสพนักงาน
      if (!empId) fail('กรุณาระบุรหัสพนักงาน');
      patch.empId = empId;
      patch.username = checkUsername(clean(p.newUsername) || empId, null);
      patch.password = hashPassword(clean(p.newPassword) || empId);
      const id = env.uuid();
      store.insert('managers', Object.assign({ id: id }, patch));
      return id;
    }
    // newUsername แยกจาก username (ที่ใช้เข้าสู่ระบบในคำขอนี้)
    if (clean(p.newUsername)) patch.username = checkUsername(clean(p.newUsername), p.id);
    if (session.role === 'master' && empId) patch.empId = empId;
    const pw = clean(p.newPassword);
    if (pw) {
      if (pw.length < 4) fail('รหัสผ่านต้องยาวอย่างน้อย 4 ตัวอักษร');
      patch.password = hashPassword(pw);
    }
    store.updateWhere('managers', x => x.id === p.id, patch);
    return p.id;
  }

  function removeManager(session, p) {
    masterOnly(session);
    const m = manager(p.id);
    const now = env.now();
    if (bookingsOf(m.id).some(b => key(b.date, b.start) >= now)) fail('ผู้จัดการท่านนี้ยังมีการจองที่จะถึง กรุณายกเลิกการจองก่อน');
    ['availability', 'members', 'bookings'].forEach(t => store.removeWhere(t, x => x.managerId === m.id));
    store.removeWhere('managers', x => x.id === m.id);
    return true;
  }

  /* ---------- dispatcher ---------- */
  const publicActions = { managers: listManagers, state: state, book: book, cancel: p => cancel(p, false) };
  const adminActions = {
    login: s => s,
    resetPassword: (s, p) => {
      // ผู้ดูแลระบบรีเซ็ตรหัสผ่านผู้จัดการกลับเป็นรหัสพนักงาน
      masterOnly(s);
      const m = manager(p.id);
      if (!m.empId) fail('ผู้จัดการท่านนี้ไม่มีรหัสพนักงาน');
      store.updateWhere('managers', x => x.id === m.id, { password: hashPassword(m.empId) });
      return true;
    },
    adminState: adminState,
    addAvailability: addAvailability,
    removeAvailability: removeAvailability,
    adminCancel: (s, p) => { scope(s, p.managerId); return cancel(p, true); },
    addMember: addMember,
    updateMember: updateMember,
    removeMember: removeMember,
    saveManager: saveManager,
    removeManager: removeManager,
  };

  return {
    hashPassword: hashPassword,
    isHashed: isHashed,
    handle(p) {
      if (publicActions[p.action]) return publicActions[p.action](p);
      if (adminActions[p.action]) return adminActions[p.action](login(p.username, p.password), p);
      fail('ไม่รู้จักคำสั่ง: ' + p.action);
    },
  };
}
