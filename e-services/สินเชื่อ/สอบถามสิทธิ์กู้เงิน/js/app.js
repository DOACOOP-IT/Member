// app.js — flow หลัก: เข้าสู่ระบบ → เลือกประเภทเงินกู้ → แสดงสิทธิ์กู้สูงสุด
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    memberNo: '',
    member: null,
    loans: [],
    loantypes: [],
    currentType: null,
    lineProfile: null
  };

  const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const fmtBaht = (n) => fmt(n) + ' บาท';

  function show(screenId) {
    ['screen-login', 'screen-select', 'screen-result'].forEach((s) => $(s).classList.add('hidden'));
    $(screenId).classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function loading(on) {
    $('loading').classList.toggle('hidden', !on);
  }

  // ---------- LIFF ----------
  async function initLiff() {
    if (!CONFIG.LIFF_ID || typeof liff === 'undefined') return;
    try {
      await liff.init({ liffId: CONFIG.LIFF_ID });
      if (!liff.isLoggedIn() && liff.isInClient()) liff.login();
      if (liff.isLoggedIn()) state.lineProfile = await liff.getProfile();
      // TODO: เมื่อออกแบบระบบยืนยันตัวตนแล้ว จะใช้ lineProfile.userId ผูกกับเลขทะเบียนสมาชิก
    } catch (e) {
      console.warn('LIFF init ไม่สำเร็จ:', e);
    }
  }

  // ---------- หน้า 1: เข้าสู่ระบบ ----------
  async function login() {
    const memNo = $('inp-memno').value.trim().padStart(8, '0');
    if (!/^\d{1,8}$/.test($('inp-memno').value.trim())) {
      return showLoginError('กรุณาป้อนเลขทะเบียนสมาชิกเป็นตัวเลข');
    }
    showLoginError('');
    loading(true);
    try {
      // ขอรายการประเภทเงินกู้แบบกรองตามสิทธิ์ของสมาชิกคนนี้ (ประเภทที่กู้ไม่ได้จะถูกซ่อน)
      const [memRes, ltRes] = await Promise.all([
        Api.member(memNo),
        Api.call({ action: 'loantypes', member_no: memNo })
      ]);
      if (!memRes.ok) return showLoginError(memRes.error || 'ไม่พบข้อมูลสมาชิก');
      state.loantypes = (ltRes.ok && ltRes.loantypes) || [];
      state.loantypesNote = ltRes.note || '';
      state.memberNo = memNo;
      state.member = memRes.member;
      state.loans = memRes.loans || [];
      localStorage.setItem('loancalc_memno', memNo);
      renderMember();
      renderLoantypes(state.loantypes);
      show('screen-select');
    } catch (e) {
      showLoginError('เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่');
      console.error(e);
    } finally {
      loading(false);
    }
  }

  function showLoginError(msg) {
    const el = $('login-error');
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  }

  // ---------- หน้า 2: ข้อมูลสมาชิก + เลือกประเภท ----------
  function renderMember() {
    const m = state.member;
    $('mem-name').textContent = m.member_name;
    $('mem-meta').textContent = 'ทะเบียน ' + m.member_no + ' • ' + m.membtype_desc;
    $('mem-salary').textContent = fmt(m.salary_amount);
    $('mem-share').textContent = fmt(m.share_value);
    $('mem-loans').textContent = state.loans.length + ' สัญญา';
  }

  function renderLoantypes(list) {
    const q = $('inp-search') ? $('inp-search').value.trim().toLowerCase() : '';
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
    list
      .filter((t) => !q || t.loantype_desc.toLowerCase().includes(q) || t.loantype_code.includes(q))
      .forEach((t, idx) => {
        const li = document.createElement('li');
        li.style.animationDelay = (idx * 50) + 'ms'; // staggered fade-in
        li.innerHTML =
          '<div><div class="lt-name">' + t.loantype_desc + '</div>' +
          '<div class="lt-code">' + (t.note || '') + '</div></div>';
        li.addEventListener('click', () => selectType(t));
        ul.appendChild(li);
      });
  }

  // ---------- หน้า 3: ผลการคำนวณ ----------
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
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          icon: 'error',
          title: 'คำนวณไม่สำเร็จ',
          text: 'กรุณาลองใหม่อีกครั้ง',
          confirmButtonText: 'ตกลง',
          confirmButtonColor: '#0ea5e9'
        });
      } else {
        alert('คำนวณไม่สำเร็จ กรุณาลองใหม่');
      }
      console.error(e);
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

    // เตือนกรณียอดกู้ใหม่น้อยกว่ายอดหักกลบ (สำคัญ — แสดงเป็นกล่องค้างไว้)
    const clearedTotal = (r.cleared_contracts || []).length
      ? state.loans
          .filter((l) => r.cleared_contracts.includes(l.loancontract_no))
          .reduce((s, l) => s + l.principal_balance, 0)
      : 0;
    if (clearedTotal > 0 && r.loanrequest_amt < clearedTotal) {
      addBox(boxes, 'danger-box',
        'ยอดกู้ใหม่ (' + fmt(r.loanrequest_amt) + ') น้อยกว่ายอดหนี้เดิมที่ต้องหักกลบ (' +
        fmt(clearedTotal) + ') — ในทางปฏิบัติอาจไม่สามารถกู้ประเภทนี้เพิ่มได้');
    }

    // ข้อสังเกตอื่นๆ แจ้งเป็น popup แล้วปิดอัตโนมัติ
    if ((res.warnings || []).length && typeof Swal !== 'undefined') {
      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'info',
        html: '<div style="text-align:left;font-size:13px;line-height:1.6">' +
              res.warnings.map((w) => '• ' + w).join('<br>') + '</div>',
        showConfirmButton: false,
        timer: 8000,
        timerProgressBar: true
      });
    }

    // เติมค่า placeholder ให้ช่อง what-if
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
  $('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('loancalc_memno');
    $('inp-memno').value = '';
    show('screen-login');
  });
  if ($('inp-search')) $('inp-search').addEventListener('input', () => renderLoantypes(state.loantypes));
  $('btn-back').addEventListener('click', () => show('screen-select'));
  $('btn-recalc').addEventListener('click', () => {
    const extra = {};
    if ($('inp-amt').value.trim()) extra.req_amt = $('inp-amt').value.replace(/,/g, '').trim();
    if ($('inp-periods').value.trim()) extra.periods = $('inp-periods').value.trim();
    runCalc(extra);
  });

  // ---------- start ----------
  initLiff();
  const saved = localStorage.getItem('loancalc_memno');
  if (saved) {
    $('inp-memno').value = saved;
  }
})();
