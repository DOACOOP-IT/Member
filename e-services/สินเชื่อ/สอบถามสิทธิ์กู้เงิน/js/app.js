// app.js — flow: (LIFF) ยืนยันตัวตน/จำได้ → เลือกประเภทเงินกู้ → แสดงสิทธิ์
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    memberNo: '',
    member: null,
    loans: [],
    loantypes: [],
    loantypesNote: '',
    currentType: null,
    lineUserId: '',
    lineName: ''
  };

  const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const fmtBaht = (n) => fmt(n) + ' บาท';

  const SCREENS = ['screen-login', 'screen-verify', 'screen-select', 'screen-result'];
  function show(screenId) {
    SCREENS.forEach((s) => { const el = $(s); if (el) el.classList.add('hidden'); });
    $(screenId).classList.remove('hidden');
    window.scrollTo(0, 0);
  }
  function loading(on) { $('loading').classList.toggle('hidden', !on); }

  // ---------- LIFF ----------
  async function initLiff() {
    if (!CONFIG.LIFF_ID || typeof liff === 'undefined') return;
    try {
      await liff.init({ liffId: CONFIG.LIFF_ID });
      if (!liff.isLoggedIn()) { if (liff.isInClient()) liff.login(); return; }
      const prof = await liff.getProfile();
      state.lineUserId = prof.userId;
      state.lineName = prof.displayName || '';
    } catch (e) {
      console.warn('LIFF init ไม่สำเร็จ:', e);
    }
  }

  // ---------- โหลดข้อมูลสมาชิก + แสดงหน้าเลือกเงินกู้ ----------
  async function loadMember(memNo) {
    loading(true);
    try {
      const [memRes, ltRes] = await Promise.all([
        Api.member(memNo),
        Api.call({ action: 'loantypes', member_no: memNo })
      ]);
      if (!memRes.ok) { loading(false); return { ok: false, error: memRes.error || 'ไม่พบข้อมูลสมาชิก' }; }
      state.memberNo = memNo;
      state.member = memRes.member;
      state.loans = memRes.loans || [];
      state.loantypes = (ltRes.ok && ltRes.loantypes) || [];
      state.loantypesNote = ltRes.note || '';
      renderMember();
      renderLoantypes(state.loantypes);
      show('screen-select');
      return { ok: true };
    } catch (e) {
      console.error(e);
      return { ok: false, error: 'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่' };
    } finally {
      loading(false);
    }
  }

  // ---------- เข้าสู่ระบบด้วยเลขทะเบียน (เบราว์เซอร์ / เจ้าหน้าที่) ----------
  async function login() {
    const raw = $('inp-memno').value.trim();
    if (!/^\d{1,8}$/.test(raw)) return setErr('login-error', 'กรุณาป้อนเลขทะเบียนสมาชิกเป็นตัวเลข');
    setErr('login-error', '');
    const memNo = raw.padStart(8, '0');
    const r = await loadMember(memNo);
    if (!r.ok) setErr('login-error', r.error);
    else localStorage.setItem('loancalc_memno', memNo);
  }

  // ---------- ยืนยันตัวตน (LIFF ครั้งแรก) ----------
  async function verify() {
    const raw = $('vf-memno').value.trim();
    const citizen = $('vf-citizen').value.replace(/\D/g, '');
    if (!/^\d{1,8}$/.test(raw)) return setErr('verify-error', 'กรุณาป้อนเลขทะเบียนสมาชิกเป็นตัวเลข');
    if (citizen.length !== 13) return setErr('verify-error', 'กรุณากรอกเลขบัตรประชาชนให้ครบ 13 หลัก');
    setErr('verify-error', '');
    loading(true);
    try {
      const res = await Api.post({
        action: 'lineVerify',
        userId: state.lineUserId,
        member_no: raw.padStart(8, '0'),
        citizen_id: citizen,
        display_name: state.lineName
      });
      if (!res.ok) { loading(false); return setErr('verify-error', res.error || 'ยืนยันตัวตนไม่สำเร็จ'); }
      await loadMember(res.member_no);
    } catch (e) {
      console.error(e);
      loading(false);
      setErr('verify-error', 'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่');
    }
  }

  function setErr(id, msg) {
    const el = $(id);
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  }

  // ---------- หน้าเลือกประเภท ----------
  function renderMember() {
    const m = state.member;
    $('mem-name').textContent = m.member_name;
    $('mem-meta').textContent = 'ทะเบียน ' + m.member_no + ' • ' + m.membtype_desc;
    $('mem-salary').textContent = fmt(m.salary_amount);
    $('mem-share').textContent = fmt(m.share_value);
    $('mem-loans').textContent = state.loans.length + ' สัญญา';
  }

  function renderLoantypes(list) {
    const ul = $('loantype-list');
    ul.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.style.cursor = 'default';
      li.innerHTML = '<div class="lt-name" style="color:var(--danger)">' +
        (state.loantypesNote || 'ไม่มีประเภทเงินกู้ที่ท่านมีสิทธิ์กู้ในขณะนี้') + '</div>';
      ul.appendChild(li);
      return;
    }
    list.forEach((t, idx) => {
      const li = document.createElement('li');
      li.style.animationDelay = (idx * 50) + 'ms';
      li.innerHTML =
        '<div><div class="lt-name">' + t.loantype_desc + '</div>' +
        '<div class="lt-code">' + (t.note || '') + '</div></div>';
      li.addEventListener('click', () => selectType(t));
      ul.appendChild(li);
    });
  }

  // ---------- หน้าผลลัพธ์ ----------
  async function selectType(t) {
    state.currentType = t;
    $('inp-amt').value = '';
    $('inp-periods').value = '';
    await runCalc({});
  }

  async function runCalc(extra) {
    loading(true);
    try {
      const res = await Api.calc(state.memberNo, state.currentType.loantype_code, extra);
      renderResult(res);
      show('screen-result');
    } catch (e) {
      console.error(e);
      if (typeof Swal !== 'undefined') {
        Swal.fire({ icon: 'error', title: 'คำนวณไม่สำเร็จ', text: 'กรุณาลองใหม่อีกครั้ง',
          confirmButtonText: 'ตกลง', confirmButtonColor: '#0ea5e9' });
      } else { alert('คำนวณไม่สำเร็จ กรุณาลองใหม่'); }
    } finally {
      loading(false);
    }
  }

  function renderResult(res) {
    const boxes = $('res-warnings');
    boxes.innerHTML = '';

    if (!res.ok) {
      $('res-loantype').textContent = state.currentType.loantype_desc;
      $('res-permiss').textContent = 'กู้ไม่ได้';
      $('res-pay').textContent = '-';
      $('res-periods').textContent = '-';
      $('res-salary-remain').textContent = '-';
      $('res-rate').textContent = '-';
      addBox(boxes, 'danger-box', res.error || 'ไม่สามารถคำนวณได้');
      return;
    }

    const r = res.result;
    $('res-loantype').textContent = res.loantype.loantype_desc;
    $('res-permiss').textContent = fmt(r.loanrequest_amt);
    $('res-pay').textContent = fmt(r.period_payment);
    $('res-periods').textContent = r.periods + ' งวด';
    $('res-salary-remain').textContent = fmt(r.salary_remain);
    $('res-rate').textContent = res.loantype.int_rate;

    const clearedTotal = (r.cleared_contracts || []).length
      ? state.loans.filter((l) => r.cleared_contracts.includes(l.loancontract_no))
          .reduce((s, l) => s + l.principal_balance, 0)
      : 0;
    if (clearedTotal > 0 && r.loanrequest_amt < clearedTotal) {
      addBox(boxes, 'danger-box',
        'ยอดกู้ใหม่ (' + fmt(r.loanrequest_amt) + ') น้อยกว่ายอดหนี้เดิมที่ต้องหักกลบ (' +
        fmt(clearedTotal) + ') — ในทางปฏิบัติอาจไม่สามารถกู้ประเภทนี้เพิ่มได้');
    }

    if ((res.warnings || []).length && typeof Swal !== 'undefined') {
      Swal.fire({
        toast: true, position: 'top', icon: 'info',
        html: '<div style="text-align:left;font-size:13px;line-height:1.6">' +
              res.warnings.map((w) => '• ' + w).join('<br>') + '</div>',
        showConfirmButton: false, timer: 8000, timerProgressBar: true
      });
    }

    $('inp-amt').placeholder = 'สูงสุด ' + fmt(r.loanpermiss_amt);
    $('inp-periods').placeholder = 'สูงสุด ' + (res.loantype.max_periods || r.periods);
  }

  function addBox(parent, cls, text) {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    parent.appendChild(div);
  }

  // ---------- events ----------
  $('btn-login').addEventListener('click', login);
  $('inp-memno').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('btn-verify').addEventListener('click', verify);
  $('btn-logout').addEventListener('click', () => {
    // ในโหมด LIFF กลับไปหน้ายืนยันตัวตน / ในเบราว์เซอร์กลับไปหน้า login
    if (state.lineUserId) show('screen-verify');
    else { localStorage.removeItem('loancalc_memno'); $('inp-memno').value = ''; show('screen-login'); }
  });
  $('btn-back').addEventListener('click', () => show('screen-select'));
  $('btn-recalc').addEventListener('click', () => {
    const extra = {};
    if ($('inp-amt').value.trim()) extra.req_amt = $('inp-amt').value.replace(/,/g, '').trim();
    if ($('inp-periods').value.trim()) extra.periods = $('inp-periods').value.trim();
    runCalc(extra);
  });

  // ---------- boot ----------
  (async function boot() {
    await initLiff();

    if (state.lineUserId) {
      // โหมด LINE: เช็คว่าเคยผูกทะเบียนไว้แล้วหรือยัง
      loading(true);
      try {
        const who = await Api.call({ action: 'lineWhoAmI', userId: state.lineUserId });
        loading(false);
        if (who.bound) { await loadMember(who.member_no); return; }
      } catch (e) { loading(false); console.error(e); }
      show('screen-verify');
      return;
    }

    // โหมดเบราว์เซอร์ (เจ้าหน้าที่/ทดสอบ)
    const saved = localStorage.getItem('loancalc_memno');
    if (saved) $('inp-memno').value = saved;
    show('screen-login');
  })();
})();
