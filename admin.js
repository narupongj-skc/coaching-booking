(function () {
  const PW_KEY = 'coaching-admin-pw';
  const USER_KEY = 'coaching-admin-user';
  const MGR_KEY = 'coaching-admin-mgr';
  const $ = id => document.getElementById(id);
  const esc = ui.esc;

  let pw = sessionStorage.getItem(PW_KEY) || '';
  let user = sessionStorage.getItem(USER_KEY) || '';
  let currentMgr = sessionStorage.getItem(MGR_KEY) || '';
  let data = null;
  let photo = ''; // รูปในฟอร์มโปรไฟล์ (data URL หรือ URL)

  ui.demoBanner();
  if (api.isDemo) {
    $('user').placeholder = 'ทดลอง: 10001, 10002 หรือ admin';
    $('pw').placeholder = 'ทดลอง: เหมือนชื่อผู้ใช้';
  }

  const call = (action, params) => api.call(action, Object.assign({ username: user, password: pw }, params || {}));
  const mcall = (action, params) => call(action, Object.assign({ managerId: data.manager.id }, params || {}));
  const shortDate = d => ui.thaiDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const pad = n => ('0' + n).slice(-2);
  const isMaster = () => data && data.session.role === 'master';

  /* ---------- Login ---------- */
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    user = $('user').value.trim();
    pw = $('pw').value;
    try {
      await call('login');
      sessionStorage.setItem(USER_KEY, user);
      sessionStorage.setItem(PW_KEY, pw);
      start();
    } catch (err) { ui.toast(err.message, 'error'); }
  });

  $('logout').addEventListener('click', () => {
    sessionStorage.removeItem(PW_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(MGR_KEY);
    location.reload();
  });

  async function start() {
    $('login').hidden = true;
    $('app').hidden = false;
    await refresh();
  }

  /* ---------- Tabs ---------- */
  function showTab(name) {
    document.querySelectorAll('.tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
  }
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  /* ---------- Data ---------- */
  async function refresh() {
    try {
      data = await call('adminState', { managerId: currentMgr });
      render();
    } catch (err) {
      ui.toast(err.message, 'error');
      if (/รหัสผ่าน|ชื่อผู้ใช้/.test(err.message)) { sessionStorage.removeItem(PW_KEY); setTimeout(() => location.reload(), 1200); }
    }
  }

  function render() {
    const master = isMaster();
    $('managersTab').hidden = !master;
    $('mgrSwitch').hidden = !master || !data.managers.length;

    if (master) {
      $('mgrSelect').innerHTML = data.managers.map(m =>
        '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>').join('');
      if (data.manager) $('mgrSelect').value = data.manager.id;
      renderManagers();
    }

    // ยังไม่มีผู้จัดการเลย (รหัสหลัก ครั้งแรก)
    const hasMgr = !!data.manager;
    document.querySelectorAll('.tabs [data-tab]').forEach(b => {
      if (b.dataset.tab !== 'managers') b.hidden = !hasMgr;
    });
    if (!hasMgr) {
      $('mgrHead').innerHTML = '';
      showTab('managers');
      return;
    }
    currentMgr = data.manager.id;
    sessionStorage.setItem(MGR_KEY, currentMgr);

    const m = data.manager;
    $('mgrHead').innerHTML = ui.avatar(m, 'md') + '<div><h1>' + esc(m.name) + '</h1>' +
      (m.title ? '<p>' + esc(m.title) + '</p>' : '') + '</div>';

    // เตือนให้เปลี่ยนรหัสผ่านเริ่มต้น (เฉพาะผู้จัดการที่เข้าระบบเอง)
    $('defaultPwBanner').hidden = master || !m.defaultPassword;

    renderAvailability();
    renderBookings();
    renderTeam();
    renderProfile();

    document.querySelector('[data-tab=bookings]').textContent = 'การจอง (' + data.bookings.length + ')';
    document.querySelector('[data-tab=team]').textContent = 'ทีม (' + data.team.length + ')';
  }

  /* ---------- Availability ---------- */
  function bookingsIn(a) {
    const s = toMin(a.start), e = toMin(a.end);
    return data.bookings.filter(b => b.date === a.date && toMin(b.start) >= s && toMin(b.start) < e);
  }

  function renderAvailability() {
    $('availList').innerHTML = data.availability.length
      ? '<table><thead><tr><th>วันที่</th><th>ช่วงเวลา</th><th>จองแล้ว</th><th></th></tr></thead><tbody>' +
        data.availability.map(a => {
          const total = (toMin(a.end) - toMin(a.start)) / 30;
          return '<tr><td>' + esc(shortDate(a.date)) + '</td><td class="num">' + esc(a.start) + '–' + esc(a.end) + '</td>' +
            '<td class="num">' + bookingsIn(a).length + ' / ' + total + ' ช่อง</td>' +
            '<td class="act"><button class="btn danger sm" data-del-avail="' + esc(a.id) + '">ลบ</button></td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="empty">ยังไม่มีเวลาว่าง เพิ่มด้านบนได้เลย</p>';
  }

  // ตัวเลือกเวลาเป็นช่วงละครึ่งชั่วโมง
  const times = [];
  for (let t = 6 * 60; t <= 22 * 60; t += 30) times.push(pad(Math.floor(t / 60)) + ':' + pad(t % 60));
  $('aStart').innerHTML = times.slice(0, -1).map(t => '<option>' + t + '</option>').join('');
  $('aEnd').innerHTML = times.slice(1).map(t => '<option>' + t + '</option>').join('');
  $('aStart').value = '13:00';
  $('aEnd').value = '16:00';

  function updatePreview() {
    const n = (toMin($('aEnd').value) - toMin($('aStart').value)) / 30;
    $('availPreview').textContent = n > 0 ? 'จะได้ ' + n + ' ช่อง ช่องละ 30 นาที' : 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม';
  }
  $('aStart').addEventListener('change', () => {
    if (toMin($('aEnd').value) <= toMin($('aStart').value)) {
      const i = times.indexOf($('aStart').value);
      $('aEnd').value = times[Math.min(i + 2, times.length - 1)];
    }
    updatePreview();
  });
  $('aEnd').addEventListener('change', updatePreview);
  const t = new Date(); t.setDate(t.getDate() + 1);
  $('aDate').value = t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  updatePreview();

  $('availForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await mcall('addAvailability', { date: $('aDate').value, start: $('aStart').value, end: $('aEnd').value });
      ui.toast('เพิ่มเวลาว่างแล้ว');
      refresh();
    } catch (err) { ui.toast(err.message, 'error'); }
  });

  $('availList').addEventListener('click', async e => {
    const id = e.target.dataset.delAvail;
    if (!id) return;
    const a = data.availability.find(x => x.id === id);
    if (!(await ui.confirm('ลบเวลาว่างนี้?', esc(ui.thaiDate(a.date)) + '<br>' + esc(a.start + '–' + a.end), 'ลบ'))) return;
    try { await mcall('removeAvailability', { id }); ui.toast('ลบแล้ว'); refresh(); }
    catch (err) { ui.toast(err.message, 'error'); }
  });

  /* ---------- Bookings ---------- */
  function renderBookings() {
    $('bookingList').innerHTML = data.bookings.length
      ? '<table><thead><tr><th>วันที่</th><th>เวลา</th><th>ชื่อ</th><th></th></tr></thead><tbody>' +
        data.bookings.map((b, i) =>
          '<tr><td>' + esc(shortDate(b.date)) + '</td><td class="num">' + esc(b.start) + '–' + esc(b.end) + '</td>' +
          '<td>' + esc(b.name) + '</td>' +
          '<td class="act"><button class="btn danger sm" data-cancel="' + i + '">ยกเลิก</button></td></tr>'
        ).join('') + '</tbody></table>'
      : '<p class="empty">ยังไม่มีการจอง</p>';
  }

  $('bookingList').addEventListener('click', async e => {
    const i = e.target.dataset.cancel;
    if (i === undefined) return;
    const b = data.bookings[+i];
    if (!(await ui.confirm('ยกเลิกการจองของ ' + b.name + '?', esc(ui.thaiDate(b.date)) + ' ' + esc(b.start + '–' + b.end), 'ยกเลิกการจอง'))) return;
    try { await mcall('adminCancel', { name: b.name, date: b.date, start: b.start }); ui.toast('ยกเลิกแล้ว'); refresh(); }
    catch (err) { ui.toast(err.message, 'error'); }
  });

  /* ---------- Team ---------- */
  function renderTeam() {
    $('memberList').innerHTML = data.members.length
      ? '<table><thead><tr><th>ชื่อ</th><th>อีเมล</th><th></th></tr></thead><tbody>' +
        data.members.map(m =>
          '<tr><td>' + esc(m.name) + '</td>' +
          '<td><input type="email" class="member-email" data-name="' + esc(m.name) + '" value="' + esc(m.email) + '"' +
          ' placeholder="ไม่มีอีเมล" aria-label="อีเมลของ ' + esc(m.name) + '"></td>' +
          '<td class="act"><button class="btn danger sm" type="button" data-del-member="' + esc(m.name) + '">ลบ</button></td></tr>'
        ).join('') + '</tbody></table>'
      : '<p class="empty" style="padding:8px 0">ยังไม่มีรายชื่อ ลูกทีมจะจองไม่ได้จนกว่าจะเพิ่มชื่อ</p>';
  }

  $('memberForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await mcall('addMember', { name: $('mName').value, email: $('mEmail').value });
      $('memberForm').reset();
      $('mName').focus();
      refresh();
    } catch (err) { ui.toast(err.message, 'error'); }
  });

  // แก้อีเมลในตาราง: บันทึกอัตโนมัติเมื่อออกจากช่อง หรือกด Enter
  $('memberList').addEventListener('change', async e => {
    const input = e.target.closest('.member-email');
    if (!input) return;
    try {
      await mcall('updateMember', { name: input.dataset.name, email: input.value });
      const m = data.members.find(x => x.name === input.dataset.name);
      if (m) m.email = input.value.trim();
      ui.toast(input.value.trim() ? 'บันทึกอีเมลของ ' + input.dataset.name + ' แล้ว' : 'ลบอีเมลของ ' + input.dataset.name + ' แล้ว');
    } catch (err) {
      ui.toast(err.message, 'error');
      input.focus();
    }
  });
  $('memberList').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest('.member-email')) e.target.blur();
  });

  $('memberList').addEventListener('click', async e => {
    const name = e.target.dataset.delMember;
    if (!name) return;
    if (!(await ui.confirm('ลบ ' + name + ' ออกจากทีม?', 'การจองที่มีอยู่แล้วจะยังคงอยู่', 'ลบ'))) return;
    try { await mcall('removeMember', { name }); refresh(); }
    catch (err) { ui.toast(err.message, 'error'); }
  });

  /* ---------- Profile ---------- */
  function renderProfile() {
    const m = data.manager;
    photo = m.photo || '';
    $('pName').value = m.name;
    $('pTitle').value = m.title || '';
    $('pEmail').value = m.email || '';
    $('pPw').value = '';
    $('pPw2').value = '';
    $('pUser').value = m.username || '';
    $('pEmpHint').textContent = m.empId ? 'รหัสพนักงาน: ' + m.empId : '';
    renderPhoto();
  }

  function renderPhoto() {
    $('photoPreview').innerHTML = ui.avatar({ name: $('pName').value, photo: photo }, 'lg');
    $('photoRemove').hidden = !photo;
  }

  // ย่อรูปเป็น 240x240 (crop กลางภาพ) เพื่อให้เก็บใน Google Sheets ได้
  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const size = 240;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const s = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(img.src);
        let q = 0.85, out = c.toDataURL('image/jpeg', q);
        while (out.length > 40000 && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'));
      img.src = URL.createObjectURL(file);
    });
  }

  $('photoFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { photo = await resizeImage(f); renderPhoto(); ui.toast('กด "บันทึก" เพื่อใช้รูปนี้'); }
    catch (err) { ui.toast(err.message, 'error'); }
  });
  $('photoRemove').addEventListener('click', () => { photo = ''; renderPhoto(); });
  $('pName').addEventListener('input', () => { if (!photo) renderPhoto(); });

  $('profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    const newPassword = $('pPw').value;
    const username = $('pUser').value.trim();
    if (newPassword !== $('pPw2').value) { ui.toast('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน', 'error'); $('pPw2').focus(); return; }
    if (newPassword && data.manager.empId && newPassword === data.manager.empId) {
      ui.toast('กรุณาตั้งรหัสผ่านที่ไม่ใช่รหัสพนักงาน', 'error'); $('pPw').focus(); return;
    }
    try {
      await call('saveManager', {
        id: data.manager.id, name: $('pName').value, title: $('pTitle').value, email: $('pEmail').value,
        photo, newPassword, newUsername: username,
      });
      // ถ้าผู้จัดการเปลี่ยนชื่อผู้ใช้/รหัสของตัวเอง ใช้ค่าใหม่ต่อเลย ไม่ต้องเข้าระบบใหม่
      if (!isMaster()) {
        if (username) { user = username; sessionStorage.setItem(USER_KEY, user); }
        if (newPassword) { pw = newPassword; sessionStorage.setItem(PW_KEY, pw); }
      }
      ui.toast(newPassword ? 'บันทึกโปรไฟล์และรหัสผ่านใหม่แล้ว' : 'บันทึกโปรไฟล์แล้ว');
      refresh();
    } catch (err) { ui.toast(err.message, 'error'); }
  });

  /* ---------- Managers (master) ---------- */
  function renderManagers() {
    $('mgrList').innerHTML = data.managers.length
      ? '<table><tbody>' + data.managers.map(m =>
          '<tr><td><div class="mgr-row">' + ui.avatar(m, 'sm') + '<div><div>' + esc(m.name) + '</div>' +
          (m.title ? '<div class="hint" style="margin:0">' + esc(m.title) + '</div>' : '') + '</div></div></td>' +
          '<td><div class="hint" style="margin:0">ผู้ใช้: ' + esc(m.username || '-') + '</div>' +
          (m.defaultPassword ? '<span class="tag warn">ยังใช้รหัสผ่านเริ่มต้น</span> ' : '') +
          (m.hasEmail ? '' : '<span class="tag">ไม่มีอีเมลแจ้งเตือน</span>') + '</td>' +
          '<td class="act"><button class="btn ghost sm" data-open="' + esc(m.id) + '">จัดการ</button> ' +
          (m.empId ? '<button class="btn ghost sm" data-reset="' + esc(m.id) + '">รีเซ็ตรหัสผ่าน</button> ' : '') +
          '<button class="btn danger sm" data-del-mgr="' + esc(m.id) + '">ลบ</button></td></tr>'
        ).join('') + '</tbody></table>'
      : '<p class="empty">ยังไม่มีผู้จัดการ เพิ่มด้านบนได้เลย</p>';
  }

  $('mgrSelect').addEventListener('change', () => { currentMgr = $('mgrSelect').value; refresh(); });

  $('newMgrForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      currentMgr = await call('saveManager', {
        name: $('nName').value, title: $('nTitle').value, email: $('nEmail').value, empId: $('nEmp').value,
      });
      $('newMgrForm').reset();
      ui.toast('เพิ่มผู้จัดการแล้ว');
      await refresh();
      showTab('profile');
    } catch (err) { ui.toast(err.message, 'error'); }
  });

  $('mgrList').addEventListener('click', async e => {
    const open = e.target.dataset.open, del = e.target.dataset.delMgr, reset = e.target.dataset.reset;
    if (reset) {
      const m = data.managers.find(x => x.id === reset);
      if (!(await ui.confirm('รีเซ็ตรหัสผ่านของ ' + m.name + '?', 'รหัสผ่านจะกลับเป็นรหัสพนักงาน <strong>' + esc(m.empId) + '</strong>', 'รีเซ็ต'))) return;
      try { await call('resetPassword', { id: reset }); ui.toast('รีเซ็ตแล้ว'); refresh(); }
      catch (err) { ui.toast(err.message, 'error'); }
    }
    if (open) { currentMgr = open; await refresh(); showTab('avail'); }
    if (del) {
      const m = data.managers.find(x => x.id === del);
      if (!(await ui.confirm('ลบ ' + m.name + '?', 'เวลาว่าง รายชื่อทีม และประวัติการจองของผู้จัดการท่านนี้จะถูกลบทั้งหมด', 'ลบ'))) return;
      try {
        await call('removeManager', { id: del });
        if (currentMgr === del) currentMgr = '';
        ui.toast('ลบแล้ว');
        refresh();
      } catch (err) { ui.toast(err.message, 'error'); }
    }
  });

  $('goChangePw').addEventListener('click', () => { showTab('profile'); $('pPw').focus(); });

  if (pw && user) start();
})();
