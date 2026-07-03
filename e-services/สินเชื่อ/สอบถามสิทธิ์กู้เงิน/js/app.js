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
      const [memRes, ltRes] = await Promise.all([Api.member(memNo), getLoantypes()]);
      if (!memRes.ok) return showLoginError(memRes.error || 'ไม่พบข้อมูลสมาชิก');
      state.memberNo = memNo;
      state.member = memRes.member;
      state.loans = memRes.loans || [];
      localStorage.setItem('loancalc_memno', memNo);
      renderMember();
      renderLoantypes(ltRes);
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

  async function getLoantypes() {
    if (state.loantypes.length) return state.loantypes;
    const res = await Api.loantypes();
    state.loantypes = (res.ok && res.loantypes) || [];
    return state.loantypes;
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
    const q = $('inp-search').value.trim().toLowerCase();
    const ul = $('loantype-list');
    ul.innerHTML = '';
    list
      .filter((t) => !q || t.loantype_desc.toLowerCase().includes(q) || t.loantype_code.includes(q))
      .forEach((t) => {
        const li = document.createElement('li');
        li.innerHTML =
          '<div><div class="lt-name">' + t.loantype_desc + '</div>' +
          '<div class="lt-code">รหัส ' + t.loantype_code +
          (t.max_periods ? ' • สูงสุด ' + t.max_periods + ' งวด' : '') + '</div></div>' +
          '<div class="lt-max">เพดาน ' + fmt(t.maxloan_amt) + '</div>';
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
      alert('คำนวณไม่สำเร็จ กรุณาลองใหม่');
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
      $('res-payment').textContent = '';
      $('res-steps').innerHTML = '';
      $('res-detail').innerHTML = '';
      addBox(boxes, 'danger-box', res.error || 'ไม่สามารถคำนวณได้');
      (res.warnings || []).forEach((w) => addBox(boxes, 'warning-box', w));
      return;
    }

    const r = res.result;
    $('res-loantype').textContent = res.loantype.loantype_desc + ' (ดอกเบี้ย ' + res.loantype.int_rate + '%)';
    $('res-permiss').textContent = fmt(r.loanrequest_amt);
    $('res-payment').textContent =
      'ผ่อน ' + r.periods + ' งวด งวดละ ' + fmtBaht(r.period_payment) +
      (res.loantype.loanpayment_type === 1 ? ' (ไม่รวมดอกเบี้ยรายเดือน)' : '');

    // เตือนกรณียอดกู้ใหม่น้อยกว่ายอดหักกลบ
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
    (res.warnings || []).forEach((w) => addBox(boxes, 'warning-box', w));

    // ขั้นตอนการคำนวณ
    const ol = $('res-steps');
    ol.innerHTML = '';
    (res.steps || []).forEach((s) => {
      const li = document.createElement('li');
      li.innerHTML = s.name + ': <span class="step-amount">' + fmt(s.amount) + '</span>' +
        '<div class="step-detail">' + (s.detail || '') + '</div>';
      ol.appendChild(li);
    });

    // รายละเอียดประกอบ
    $('res-detail').innerHTML =
      'เงินเดือนสุทธิหลังหักภาระ: ' + fmtBaht(r.salary_net) + '<br>' +
      'ยอดหักสหกรณ์ต่อเดือน (หุ้น+หนี้เดิม): ' + fmtBaht(r.paymonth_coop) + '<br>' +
      'หนี้เดิมคงเหลือ (ไม่รวมที่หักกลบ): ' + fmtBaht(r.old_loan_balance) +
      (r.cleared_contracts.length ? '<br>สัญญาที่หักกลบ: ' + r.cleared_contracts.join(', ') : '') +
      '<br>ดอกเบี้ยเดือนแรกโดยประมาณ: ' + fmtBaht(r.interest_first_month) +
      '<br><span style="font-size:11.5px">ที่มาอัตราดอกเบี้ย: ' + res.loantype.int_rate_source + '</span>';

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
  $('inp-search').addEventListener('input', () => renderLoantypes(state.loantypes));
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
