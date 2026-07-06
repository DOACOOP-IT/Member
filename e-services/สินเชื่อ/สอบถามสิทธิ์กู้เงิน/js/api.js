// api.js — เรียก GAS JSON API
const Api = {
  async call(params) {
    const qs = new URLSearchParams(params).toString();
    const resp = await fetch(CONFIG.API_URL + '?' + qs, { method: 'GET' });
    if (!resp.ok) throw new Error('เชื่อมต่อระบบไม่สำเร็จ (' + resp.status + ')');
    return resp.json();
  },

  // POST — ใช้กับข้อมูลอ่อนไหว (เลขบัตร) ส่งใน body ไม่ใช่ query string
  // content-type text/plain เพื่อเลี่ยง CORS preflight ของ GAS
  async post(payload) {
    const resp = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error('เชื่อมต่อระบบไม่สำเร็จ (' + resp.status + ')');
    return resp.json();
  },

  ping() { return this.call({ action: 'ping' }); },
  loantypes() { return this.call({ action: 'loantypes' }); },
  member(memberNo) { return this.call({ action: 'member', member_no: memberNo }); },

  calc(memberNo, loantypeCode, extra) {
    const p = Object.assign({ action: 'calc', member_no: memberNo, loantype_code: loantypeCode }, extra || {});
    return this.call(p);
  }
};
