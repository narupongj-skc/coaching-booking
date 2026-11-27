// เรียก backend (Apps Script) หรือ mock ในเบราว์เซอร์ถ้ายังไม่ได้ตั้งค่า API_URL
window.api = (function () {
  const url = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
  const isDemo = !url;

  async function call(action, params) {
    const payload = Object.assign({ action: action }, params || {});
    let res;
    if (isDemo) {
      res = window.mockBackend.handle(payload);
      await new Promise(r => setTimeout(r, 150));
    } else {
      // text/plain เพื่อไม่ให้เกิด CORS preflight กับ Apps Script
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ (' + r.status + ')');
      res = await r.json();
    }
    if (!res.ok) throw new Error(res.error || 'เกิดข้อผิดพลาด');
    return res.data;
  }

  return { call: call, isDemo: isDemo };
})();

/* ---------- Shared UI helpers ---------- */
window.ui = {
  thaiDate(dateStr, opts) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('th-TH', opts || { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  },
  esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  toast(msg, kind) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show ' + (kind || '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'toast'; }, 3200);
  },
  confirm(title, body, okLabel) {
    return new Promise(resolve => {
      const dlg = document.getElementById('confirm');
      dlg.querySelector('.dlg-title').textContent = title;
      dlg.querySelector('.dlg-body').innerHTML = body;
      const ok = dlg.querySelector('.dlg-ok');
      ok.textContent = okLabel || 'ยืนยัน';
      const done = v => { dlg.close(); resolve(v); };
      ok.onclick = () => done(true);
      dlg.querySelector('.dlg-cancel').onclick = () => done(false);
      dlg.oncancel = () => resolve(false);
      dlg.showModal();
      ok.focus();
    });
  },
  // รูปผู้จัดการ หรือวงกลมตัวอักษรย่อถ้ายังไม่มีรูป
  avatar(m, cls) {
    const c = 'avatar ' + (cls || '');
    if (m.photo) return '<img class="' + c + '" src="' + ui.esc(m.photo) + '" alt="">';
    const initial = String(m.name || '?').replace(/^(คุณ|นาย|นางสาว|นาง)\s*/, '').trim().charAt(0) || '?';
    return '<span class="' + c + ' initials" aria-hidden="true">' + ui.esc(initial) + '</span>';
  },
  demoBanner() {
    if (!window.api.isDemo) return;
    const b = document.createElement('div');
    b.className = 'demo-banner';
    b.innerHTML = '<strong>โหมดทดลอง</strong> — ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น ใส่ <code>API_URL</code> ใน config.js เพื่อใช้งานจริง' +
      ' · <a href="#" id="demoReset">ล้างข้อมูลทดลอง</a>';
    b.querySelector('#demoReset').onclick = e => { e.preventDefault(); window.mockBackend.reset(); location.reload(); };
    document.body.prepend(b);
  },
};
