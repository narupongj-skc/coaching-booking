(function () {
  const cfg = window.APP_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = ui.esc;

  let managerId = null;
  let state = null;
  let busy = false;

  document.title = cfg.TITLE || document.title;
  $('title').textContent = cfg.TITLE || 'จองเวลา Coaching';
  $('subtitle').textContent = cfg.SUBTITLE || '';
  ui.demoBanner();

  // ชื่อที่ใช้แสดงแถบ "การจองของ…" ตั้งค่าเฉพาะเมื่อกด "การจองของฉัน" แล้วเลือกชื่อ
  // เก็บไว้ในหน่วยความจำเท่านั้น หายเมื่อเปลี่ยนผู้จัดการหรือรีเฟรชหน้า (กันชื่อค้างเมื่อใช้เครื่องร่วมกัน)
  let viewer = '';

  // ล้างชื่อที่เวอร์ชันก่อนเคยจำไว้ในเครื่อง
  Object.keys(localStorage).filter(k => k.indexOf('coaching-name:') === 0).forEach(k => localStorage.removeItem(k));
  const whenText = b => ui.thaiDate(b.date) + ' เวลา ' + b.start + '–' + b.end + ' น.';

  /* ================= Routing ================= */
  function route() {
    const m = /^#\/m\/(.+)$/.exec(location.hash);
    managerId = m ? decodeURIComponent(m[1]) : null;
    $('viewManagers').hidden = !!managerId;
    $('viewSlots').hidden = !managerId;
    window.scrollTo(0, 0);
    viewer = '';
    if (managerId) {
      $('mgrHead').innerHTML = '';
      $('mine').innerHTML = '';
      $('days').innerHTML = '<div class="loading">กำลังโหลด…</div>';
      loadSlots();
    } else {
      loadManagers();
    }
  }
  window.addEventListener('hashchange', route);
  document.querySelector('.back').addEventListener('click', e => { e.preventDefault(); location.hash = ''; });

  /* ================= Step 1: managers ================= */
  async function loadManagers() {
    try {
      const list = await api.call('managers');
      $('managerGrid').innerHTML = list.length
        ? list.map(m =>
            '<a class="manager-card" href="#/m/' + encodeURIComponent(m.id) + '">' +
            ui.avatar(m, 'lg') +
            '<span class="mc-name">' + esc(m.name) + '</span>' +
            (m.title ? '<span class="mc-title">' + esc(m.title) + '</span>' : '') +
            '<span class="mc-free ' + (m.freeSlots ? '' : 'none') + '">' +
            (m.freeSlots ? 'ว่าง ' + m.freeSlots + ' ช่อง' : 'ยังไม่มีเวลาว่าง') + '</span></a>'
          ).join('')
        : '<div class="card empty">ยังไม่มีรายชื่อผู้จัดการ</div>';
    } catch (err) {
      $('managerGrid').innerHTML = '<div class="card empty">โหลดข้อมูลไม่สำเร็จ: ' + esc(err.message) + '</div>';
    }
  }

  /* ================= Step 2: slots ================= */
  async function loadSlots() {
    const mid = managerId;
    try {
      const s = await api.call('state', { managerId: mid, name: viewer });
      if (mid !== managerId) return; // ผู้ใช้เปลี่ยนหน้าไปแล้ว
      state = s;
      renderSlots();
    } catch (err) {
      $('days').innerHTML = '<div class="card empty">โหลดข้อมูลไม่สำเร็จ: ' + esc(err.message) +
        '<br><br><a href="#">กลับไปเลือกผู้จัดการ</a></div>';
    }
  }

  function renderSlots() {
    const m = state.manager;
    $('mgrHead').innerHTML = ui.avatar(m, 'md') +
      '<div><div class="mh-label">Coaching กับ</div><h1>' + esc(m.name) + '</h1>' +
      (m.title ? '<p>' + esc(m.title) + '</p>' : '') + '</div>';

    const mine = viewer ? state.myBooking : null;
    const who = viewer;
    $('mine').innerHTML = mine
      ? '<div class="mine-banner"><div><div class="label">การจองของ ' + esc(who) + '</div>' +
        '<div class="when">' + esc(whenText(mine)) + '</div></div>' +
        '<div class="toolbar-actions">' +
        '<button class="btn sm" type="button" id="cancelMine">ยกเลิกการจอง</button>' +
        '<button class="btn sm" type="button" id="hideMine" aria-label="ซ่อนแถบนี้">ซ่อน</button></div></div>'
      : '';
    if (mine) {
      $('cancelMine').onclick = () => cancel(mine, who);
      $('hideMine').onclick = () => { viewer = ''; loadSlots(); };
    }

    if (!state.slots.length) {
      $('days').innerHTML = '<div class="card empty">ผู้จัดการท่านนี้ยังไม่มีเวลาว่างในขณะนี้</div>';
      return;
    }

    const byDate = {};
    state.slots.forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });

    $('days').innerHTML = Object.keys(byDate).sort().map(date => {
      const slots = byDate[date];
      const free = slots.filter(s => s.status === 'free').length;
      return '<section class="card day"><div class="day-head"><h3>' + esc(ui.thaiDate(date)) + '</h3>' +
        '<span class="count">ว่าง ' + free + ' จาก ' + slots.length + ' ช่อง</span></div>' +
        '<div class="slots">' + slots.map(s => {
          const sub = s.status === 'free' ? 'ว่าง' : s.status === 'mine' ? 'ของคุณ' : 'จองแล้ว';
          return '<button type="button" class="slot ' + s.status + '" data-date="' + esc(s.date) + '" data-start="' + esc(s.start) + '"' +
            (s.status === 'free' ? '' : ' aria-disabled="true"') +
            ' aria-label="' + esc(s.start + ' ถึง ' + s.end + ' ' + sub) + '">' +
            esc(s.start) + '–' + esc(s.end) + '<small>' + sub + '</small></button>';
        }).join('') + '</div></section>';
    }).join('');
  }

  /* ================= Step 3: name pop-up ================= */
  // mode: 'book' (มี slot) หรือ 'lookup' (ดูการจองของฉัน)
  function pickName(slot) {
    return new Promise(resolve => {
      const dlg = $('pick');
      const team = state.team;
      // ไม่เลือกชื่อไว้ล่วงหน้า ให้ผู้ใช้กดเลือกเองทุกครั้ง (กันจองผิดชื่อเมื่อใช้เครื่องร่วมกัน)
      let chosen = '';

      $('pickTitle').textContent = 'คุณคือใคร?';
      $('pickSlot').innerHTML = slot
        ? '<span>' + esc(state.manager.name) + '</span><strong>' + esc(whenText(slot)) + '</strong>'
        : '<span>ดูการจองของคุณกับ</span><strong>' + esc(state.manager.name) + '</strong>';
      $('pickHint').textContent = slot ? 'ถ้าคุณมีนัดกับผู้จัดการท่านนี้อยู่แล้ว ระบบจะย้ายนัดเดิมมาเป็นเวลานี้' : '';
      $('pickOk').textContent = slot ? 'ยืนยันการจอง' : 'ดูการจอง';

      $('nameList').innerHTML = team.length
        ? team.map(n => '<button type="button" role="radio" class="name-opt" aria-checked="' + (n === chosen) + '" data-name="' + esc(n) + '">' +
            '<span class="dot"></span>' + esc(n) + '</button>').join('')
        : '<p class="empty" style="padding:12px">ยังไม่มีรายชื่อทีม กรุณาติดต่อผู้จัดการ</p>';
      $('pickOk').disabled = !chosen;

      $('nameList').onclick = e => {
        const b = e.target.closest('.name-opt');
        if (!b) return;
        chosen = b.dataset.name;
        $('nameList').querySelectorAll('.name-opt').forEach(x => x.setAttribute('aria-checked', x === b));
        $('pickOk').disabled = false;
      };
      $('nameList').ondblclick = e => { if (e.target.closest('.name-opt')) $('pickForm').requestSubmit(); };

      const close = v => { dlg.close(); resolve(v); };
      $('pickCancel').onclick = () => close(null);
      $('pickForm').onsubmit = e => { e.preventDefault(); if (chosen) close(chosen); };
      dlg.oncancel = () => resolve(null);
      dlg.showModal();
      const sel = $('nameList').querySelector('[aria-checked=true]') || $('nameList').querySelector('.name-opt');
      if (sel) sel.focus();
    });
  }

  async function book(slot) {
    if (busy) return;
    const name = await pickName(slot);
    if (!name) return;
    busy = true;
    try {
      const res = await api.call('book', { managerId, name, date: slot.date, start: slot.start });
      ui.toast(res.moved
        ? 'ย้ายนัดจาก ' + res.moved.start + ' (' + ui.thaiDate(res.moved.date, { day: 'numeric', month: 'short' }) + ') มาเป็นเวลานี้แล้ว'
        : 'จองเรียบร้อย');
    } catch (err) {
      ui.toast(err.message, 'error');
    } finally {
      busy = false;
      loadSlots();
    }
  }

  async function cancel(b, name) {
    const ok = await ui.confirm('ยกเลิกการจอง?', '<strong>' + esc(name) + '</strong><br>' + esc(whenText(b)), 'ยกเลิกการจอง');
    if (!ok) return;
    try {
      await api.call('cancel', { managerId, name, date: b.date, start: b.start });
      ui.toast('ยกเลิกการจองแล้ว');
    } catch (err) {
      ui.toast(err.message, 'error');
    }
    loadSlots();
  }

  $('days').addEventListener('click', e => {
    const btn = e.target.closest('.slot');
    if (!btn || !btn.classList.contains('free')) return;
    const slot = state.slots.find(s => s.date === btn.dataset.date && s.start === btn.dataset.start);
    if (slot) book(slot);
  });

  $('lookup').addEventListener('click', async () => {
    const name = await pickName(null);
    if (!name) return;
    viewer = name;
    await loadSlots();
    if (!state.myBooking) ui.toast(name + ' ยังไม่มีการจองกับผู้จัดการท่านนี้');
  });

  $('refresh').addEventListener('click', () => (managerId ? loadSlots() : loadManagers()));
  setInterval(() => {
    if (document.hidden || busy || $('pick').open || $('confirm').open) return;
    managerId ? loadSlots() : loadManagers();
  }, 60000);

  route();
})();
