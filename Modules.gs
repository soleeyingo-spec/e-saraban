/**
 * Modules.gs — Business logic ของทั้ง 9 โมดูล
 */
const URGENCY = ['ปกติ', 'ด่วน', 'ด่วนมาก', 'ด่วนที่สุด'];
const SECRECY = ['ปกติ', 'ลับ', 'ลับมาก', 'ลับที่สุด'];
const ST_WAIT = 'รอเกษียน', ST_ENDORSED = 'เกษียนแล้ว', ST_DOING = 'กำลังดำเนินการ', ST_DONE = 'เสร็จสิ้น';
const TK_WAIT = 'รอดำเนินการ', TK_UNREAD = 'ยังไม่อ่าน', TK_READ = 'อ่านแล้ว';
const OUT_GENERAL = 'หนังสือส่งทั่วไป', OUT_CIRCULAR = 'หนังสือเวียน';
const VIS_ALL = 'ทุกคน', VIS_RESTRICTED = 'เฉพาะผู้เกี่ยวข้อง';
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/* ========================= Utils ========================= */
function todayISO_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd'); }
function timeHM_() { return Utilities.formatDate(new Date(), APP.TZ, 'HH:mm'); }
function nowStamp_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd HH:mm:ss'); }
function thaiYear_(v) { return (typeof v === 'string' ? parseInt(v.slice(0, 4), 10) : parseInt(Utilities.formatDate(v || new Date(), APP.TZ, 'yyyy'), 10)) + 543; }
function thaiDate_(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (parseInt(m[3], 10) + ' ' + TH_MONTHS[parseInt(m[2], 10) - 1] + ' ' + (parseInt(m[1], 10) + 543)) : '';
}
function newId_(p) { return p + '-' + Utilities.formatDate(new Date(), APP.TZ, 'yyMMddHHmmss') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(); }
function daysBetween_(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
function parseJson_(s, def) { try { const v = JSON.parse(s); return v == null ? def : v; } catch (e) { return def; } }
function isStaff_(u) { return u.role !== ROLES.TEACHER; }

function str_(v, max, label, required) {
  const s = String(v == null ? '' : v).trim();
  if (required && !s) throw new AppError('กรุณากรอก' + label);
  if (s.length > (max || 200)) throw new AppError(label + ' ยาวเกินกำหนด');
  return s;
}
function isoDate_(v, label, required) {
  const s = String(v || '').trim();
  if (!s) { if (required) throw new AppError('กรุณาระบุ' + label); return ''; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw new AppError(label + ' ไม่ถูกต้อง');
  return s;
}
function enum_(v, list, label) { if (list.indexOf(v) < 0) throw new AppError(label + ' ไม่ถูกต้อง'); return v; }

function userMap_() { const m = {}; Db.all('Users').forEach(u => m[u.user_id] = u); return m; }

function dueState_(due, taskStatus) {
  if (taskStatus === ST_DONE) return 'done';
  if (!due) return 'normal';
  const d = daysBetween_(todayISO_(), due);
  return d < 0 ? 'overdue' : (d <= 2 ? 'near' : 'normal');
}

function refreshDocStatus_(docId) {
  const doc = Db.findOne('IncomingDocs', d => d.doc_id === docId);
  if (!doc || doc.status === ST_WAIT) return;
  const tasks = Db.where('TaskTracking', t => t.doc_id === docId);
  if (!tasks.length) return;
  let st = ST_ENDORSED;
  if (tasks.every(t => t.task_status === ST_DONE)) st = ST_DONE;
  else if (tasks.some(t => t.read_status === TK_READ || t.task_status !== TK_WAIT)) st = ST_DOING;
  if (st !== doc.status) Db.update('IncomingDocs', doc._row, { status: st });
}

/* ========================= 1) Dashboard ========================= */
function dashboardStats_(ctx) {
  const u = ctx.user, staff = isStaff_(u), today = todayISO_();
  const docs = Db.all('IncomingDocs'), outs = Db.all('OutgoingDocs');
  const tasks = Db.all('TaskTracking'), ends = Db.all('Endorsements');
  const dueByEnd = {}; ends.forEach(e => dueByEnd[e.endorse_id] = e.due_date);
  const mine = tasks.filter(t => t.user_id === u.user_id);
  const scope = staff ? tasks : mine;
  const overdue = scope.filter(t => dueState_(dueByEnd[t.endorse_id], t.task_status) === 'overdue').length;

  const year = parseInt(today.slice(0, 4), 10);
  const inM = new Array(12).fill(0), outM = new Array(12).fill(0);
  docs.forEach(d => { if (String(d.received_date).slice(0, 4) == year) inM[parseInt(d.received_date.slice(5, 7), 10) - 1]++; });
  outs.forEach(d => { if (String(d.doc_date).slice(0, 4) == year) outM[parseInt(d.doc_date.slice(5, 7), 10) - 1]++; });

  const myDocIds = {}; mine.forEach(t => myDocIds[t.doc_id] = true);
  const urgent = docs
    .filter(d => d.urgency !== 'ปกติ' && d.status !== ST_DONE && (staff || myDocIds[d.doc_id]))
    .sort((a, b) => a.created_at < b.created_at ? 1 : -1).slice(0, 8)
    .map(d => ({ doc_id: d.doc_id, reg_no: d.reg_no, subject: d.subject, urgency: d.urgency, from_org: d.from_org, status: d.status, received_date: d.received_date }));

  return {
    cards: {
      incomingToday: docs.filter(d => d.received_date === today).length,
      pendingEndorse: staff ? docs.filter(d => d.status === ST_WAIT).length : 0,
      myTasks: mine.filter(t => t.task_status !== ST_DONE).length,
      overdue: overdue
    },
    chart: { year: year + 543, labels: TH_MONTHS, incoming: inM, outgoing: outM },
    urgent: urgent
  };
}

/* ========================= 2) Incoming ========================= */
function incomingList_(ctx, p) {
  return Db.all('IncomingDocs').sort((a, b) => a.created_at < b.created_at ? 1 : -1).slice(0, 3000).map(d => ({
    doc_id: d.doc_id, reg_no: d.reg_no, doc_no: d.doc_no, doc_date: d.doc_date, received_date: d.received_date,
    received_time: d.received_time, from_org: d.from_org, subject: d.subject, urgency: d.urgency, secrecy: d.secrecy,
    status: d.status, has_stamped: !!d.stamped_file_url
  }));
}

function incomingCreate_(ctx, p) {
  const s = getSettings_();
  const rec = {
    doc_no: str_(p.doc_no, 100, 'เลขที่หนังสือ', true),
    doc_date: isoDate_(p.doc_date, 'วันที่หนังสือ', true),
    from_org: str_(p.from_org, 200, 'จากหน่วยงาน', true),
    subject: str_(p.subject, 500, 'เรื่อง', true),
    urgency: enum_(p.urgency || 'ปกติ', URGENCY, 'ชั้นความเร็ว'),
    secrecy: enum_(p.secrecy || 'ปกติ', SECRECY, 'ชั้นความลับ')
  };
  const yearBE = thaiYear_(new Date()), docId = newId_('IN');
  const receivedDate = todayISO_(), receivedTime = timeHM_();
  const saved = saveFile_(p.file, { yearBE: yearBE, type: FOLDER.IN, name: docId + '_ต้นฉบับ', kinds: ['pdf'] });
  let reg;
  try {
    Db.withLock(() => {
      const n = nextRunNo_('incoming', yearBE);
      reg = formatRunNo_(s.incoming_reg_format, n, yearBE, s.doc_code);
      Db.insert('IncomingDocs', Object.assign({
        doc_id: docId, reg_no: reg, received_date: receivedDate, received_time: receivedTime,
        original_file_url: saved.url, stamped_file_url: '', status: ST_WAIT,
        created_by: ctx.user.user_id, created_at: nowStamp_()
      }, rec));
    });
  } catch (e) { trashFile_(saved.id); throw e; }
  renameFile_(saved.id, 'รับ-' + reg + '_ต้นฉบับ');
  audit_(docId, ctx.user.user_id, 'ลงรับหนังสือ', 'เลขรับ ' + reg + ' | ' + rec.subject);
  return {
    doc_id: docId, reg_no: reg, received_date: receivedDate, received_time: receivedTime,
    stamp: { text: s.stamp_text_in, org: s.org_name, position: s.stamp_position, color: s.stamp_color }
  };
}

function incomingSaveStamped_(ctx, p) {
  const doc = Db.findOne('IncomingDocs', d => d.doc_id === p.doc_id);
  if (!doc) throw new AppError('ไม่พบหนังสือ');
  if (doc.status !== ST_WAIT) throw new AppError('หนังสือนี้ผ่านขั้นตอนเกษียนแล้ว ไม่สามารถแทนที่ไฟล์ได้');
  const saved = saveFile_(p.file, { yearBE: thaiYear_(doc.received_date), type: FOLDER.IN, name: 'รับ-' + doc.reg_no + '_ประทับตรา', kinds: ['pdf'] });
  Db.update('IncomingDocs', doc._row, { stamped_file_url: saved.url });
  audit_(doc.doc_id, ctx.user.user_id, 'ประทับตราเลขรับ', 'เลขรับ ' + doc.reg_no);
  return true;
}

/* ========================= 3) Endorsement ========================= */
function endorsePending_(ctx) {
  return Db.where('IncomingDocs', d => d.status === ST_WAIT)
    .sort((a, b) => a.created_at < b.created_at ? -1 : 1)
    .map(d => ({ doc_id: d.doc_id, reg_no: d.reg_no, doc_no: d.doc_no, from_org: d.from_org, subject: d.subject, urgency: d.urgency, secrecy: d.secrecy, received_date: d.received_date, received_time: d.received_time }));
}

function usersDirectory_() {
  return Db.where('Users', u => u.status === USER_ACTIVE)
    .map(u => ({ user_id: u.user_id, full_name: u.full_name, position: u.position, department: u.department, role: u.role }))
    .sort((a, b) => (a.department + a.full_name).localeCompare(b.department + b.full_name, 'th'));
}

function usersMySignature_(ctx) {
  if (!ctx.user.signature_url) return null;
  const f = readFileBase64_(ctx.user.signature_url);
  return { base64: f.base64, mime: f.mime };
}

function endorseSubmit_(ctx, p) {
  const u = ctx.user;
  const comment = str_(p.comment, 1000, 'คำเกษียน', true);
  const due = isoDate_(p.due_date, 'กำหนดแล้วเสร็จ', true);
  if (due < todayISO_()) throw new AppError('กำหนดแล้วเสร็จต้องไม่น้อยกว่าวันนี้');
  const users = userMap_();
  const assigned = (Array.isArray(p.assigned_to) ? p.assigned_to : []).filter((id, i, a) => a.indexOf(id) === i);
  if (!assigned.length) throw new AppError('กรุณาเลือกผู้รับผิดชอบอย่างน้อย 1 คน');
  assigned.forEach(id => { if (!users[id] || users[id].status !== USER_ACTIVE) throw new AppError('พบผู้รับผิดชอบที่ไม่มีในระบบหรือถูกระงับสิทธิ์'); });

  const doc0 = Db.findOne('IncomingDocs', d => d.doc_id === p.doc_id);
  if (!doc0) throw new AppError('ไม่พบหนังสือ');
  if (doc0.status !== ST_WAIT) throw new AppError('หนังสือนี้ถูกเกษียนไปแล้ว');

  const saved = saveFile_(p.file, { yearBE: thaiYear_(doc0.received_date), type: FOLDER.IN, name: 'รับ-' + doc0.reg_no + '_เกษียนแล้ว', kinds: ['pdf'] });
  const endorseId = newId_('EN');
  try {
    Db.withLock(() => {
      const doc = Db.findOne('IncomingDocs', d => d.doc_id === p.doc_id);          // ตรวจซ้ำใน lock
      if (!doc || doc.status !== ST_WAIT) throw new AppError('หนังสือนี้ถูกเกษียนไปแล้ว');
      Db.insert('Endorsements', {
        endorse_id: endorseId, doc_id: doc.doc_id, director_id: u.user_id, comment: comment,
        assigned_to: JSON.stringify(assigned), due_date: due, endorsed_file_url: saved.url, endorsed_at: nowStamp_()
      });
      assigned.forEach(uid => Db.insert('TaskTracking', {
        task_id: newId_('TK'), doc_id: doc.doc_id, endorse_id: endorseId, user_id: uid,
        read_status: TK_UNREAD, read_at: '', task_status: TK_WAIT, action_note: '', completed_at: '', evidence_url: ''
      }));
      Db.update('IncomingDocs', doc._row, { status: ST_ENDORSED });
    });
  } catch (e) { trashFile_(saved.id); throw e; }

  audit_(doc0.doc_id, u.user_id, 'ผู้บริหารเกษียนหนังสือ', comment + ' | มอบ: ' + assigned.map(id => users[id].full_name).join(', ') + ' | กำหนด ' + thaiDate_(due));
  const sent = notifyUsers_(assigned, 'มีหนังสือมอบหมายใหม่', [
    'เลขรับ: ' + doc0.reg_no, 'เรื่อง: ' + doc0.subject, 'คำเกษียน: ' + comment, 'กำหนดแล้วเสร็จ: ' + thaiDate_(due), 'ผู้เกษียน: ' + u.full_name
  ]);
  return { endorse_id: endorseId, notified: sent };
}

/* ========================= 4) Tasks ========================= */
function tasksMy_(ctx) {
  const docs = {}; Db.all('IncomingDocs').forEach(d => docs[d.doc_id] = d);
  const ends = {}; Db.all('Endorsements').forEach(e => ends[e.endorse_id] = e);
  return Db.where('TaskTracking', t => t.user_id === ctx.user.user_id).map(t => {
    const d = docs[t.doc_id] || {}, e = ends[t.endorse_id] || {};
    return {
      task_id: t.task_id, doc_id: t.doc_id, reg_no: d.reg_no, subject: d.subject, from_org: d.from_org, urgency: d.urgency,
      comment: e.comment, due_date: e.due_date, endorsed_at: e.endorsed_at,
      read_status: t.read_status, read_at: t.read_at, task_status: t.task_status,
      action_note: t.action_note, completed_at: t.completed_at, has_evidence: !!t.evidence_url,
      due_state: dueState_(e.due_date, t.task_status)
    };
  }).sort((a, b) => (a.due_date || '9') < (b.due_date || '9') ? -1 : 1);
}

/** เปิดอ่าน: บันทึกเวลาอ่านครั้งแรก + คืนไฟล์ที่เกษียนแล้ว */
function tasksOpen_(ctx, p) {
  const t = Db.findOne('TaskTracking', x => x.task_id === p.task_id && x.user_id === ctx.user.user_id);
  if (!t) throw new AppError('ไม่พบงานที่ได้รับมอบหมาย', 'FORBIDDEN');
  const patch = {};
  if (t.read_status !== TK_READ) { patch.read_status = TK_READ; patch.read_at = nowStamp_(); }
  if (t.task_status === TK_WAIT) patch.task_status = ST_DOING;
  if (Object.keys(patch).length) {
    Db.update('TaskTracking', t._row, patch);
    if (patch.read_status) audit_(t.doc_id, ctx.user.user_id, 'เปิดอ่านหนังสือ', ctx.user.full_name);
    refreshDocStatus_(t.doc_id);
  }
  const e = Db.findOne('Endorsements', x => x.endorse_id === t.endorse_id);
  return readFileBase64_(e.endorsed_file_url);
}

function tasksComplete_(ctx, p) {
  const t = Db.findOne('TaskTracking', x => x.task_id === p.task_id && x.user_id === ctx.user.user_id);
  if (!t) throw new AppError('ไม่พบงานที่ได้รับมอบหมาย', 'FORBIDDEN');
  if (t.task_status === ST_DONE) throw new AppError('งานนี้ปิดแล้ว');
  const note = str_(p.action_note, 2000, 'ผลการปฏิบัติงาน', true);
  const patch = { action_note: note, task_status: ST_DONE, completed_at: nowStamp_() };
  if (t.read_status !== TK_READ) { patch.read_status = TK_READ; patch.read_at = nowStamp_(); }
  if (p.file) {
    const doc = Db.findOne('IncomingDocs', d => d.doc_id === t.doc_id);
    const saved = saveFile_(p.file, { yearBE: thaiYear_(new Date()), type: FOLDER.EVIDENCE, name: 'หลักฐาน-' + (doc ? doc.reg_no : t.doc_id) + '-' + ctx.user.full_name, kinds: ['pdf', 'png', 'jpg'] });
    patch.evidence_url = saved.url;
  }
  Db.update('TaskTracking', t._row, patch);
  refreshDocStatus_(t.doc_id);
  audit_(t.doc_id, ctx.user.user_id, 'รายงานผล/ปิดงาน', ctx.user.full_name + ': ' + note);
  const e = Db.findOne('Endorsements', x => x.endorse_id === t.endorse_id);
  const doc = Db.findOne('IncomingDocs', d => d.doc_id === t.doc_id);
  if (e) notifyUsers_([e.director_id], 'มีการรายงานผลการปฏิบัติงาน', ['เรื่อง: ' + (doc ? doc.subject : ''), 'ผู้ดำเนินการ: ' + ctx.user.full_name, 'ผล: ' + note.slice(0, 200)]);
  return true;
}

/* ========================= 5) Outgoing ========================= */
function outgoingList_(ctx) {
  const staff = isStaff_(ctx.user);
  return Db.all('OutgoingDocs').filter(o => staff || o.out_type === OUT_CIRCULAR)
    .sort((a, b) => a.created_at < b.created_at ? 1 : -1).slice(0, 3000)
    .map(o => ({ out_id: o.out_id, reg_no: o.reg_no, out_type: o.out_type, doc_date: o.doc_date, to_org: o.to_org, subject: o.subject, department: o.department, status: o.status }));
}

function outgoingCreate_(ctx, p) {
  const s = getSettings_();
  const type = enum_(p.out_type, [OUT_GENERAL, OUT_CIRCULAR], 'ประเภทหนังสือส่ง');
  const rec = {
    doc_date: isoDate_(p.doc_date, 'วันที่หนังสือ', true),
    to_org: str_(p.to_org, 300, 'ถึง', true),
    subject: str_(p.subject, 500, 'เรื่อง', true),
    department: str_(p.department, 100, 'กลุ่มงานเจ้าของเรื่อง', true)
  };
  const yearBE = thaiYear_(rec.doc_date), outId = newId_('OUT');
  const shared = s.out_circular_shared === 'TRUE';
  const counterKey = (type === OUT_CIRCULAR && !shared) ? 'outgoing_circular' : 'outgoing_general';
  const fmt = (type === OUT_CIRCULAR && !shared) ? s.circular_reg_format : s.outgoing_reg_format;
  const saved = saveFile_(p.file, { yearBE: yearBE, type: FOLDER.OUT, name: outId, kinds: ['pdf'] });
  let reg;
  try {
    Db.withLock(() => {
      const n = nextRunNo_(counterKey, yearBE);
      reg = formatRunNo_(fmt, n, yearBE, s.doc_code);
      Db.insert('OutgoingDocs', Object.assign({
        out_id: outId, reg_no: reg, out_type: type, file_url: saved.url, status: 'ลงทะเบียนแล้ว',
        created_by: ctx.user.user_id, created_at: nowStamp_()
      }, rec));
    });
  } catch (e) { trashFile_(saved.id); throw e; }
  renameFile_(saved.id, 'ส่ง-' + reg);
  audit_(outId, ctx.user.user_id, 'ลงทะเบียนหนังสือส่ง', type + ' เลขที่ ' + reg + ' | ' + rec.subject);
  return { out_id: outId, reg_no: reg };
}

/* ========================= 6) Orders & Announcements ========================= */
function ordersList_(ctx) {
  const u = ctx.user, staff = isStaff_(u);
  return Db.all('OrdersAnnouncements').filter(o => staff || o.visibility === VIS_ALL || parseJson_(o.allowed_users, []).indexOf(u.user_id) >= 0)
    .sort((a, b) => a.created_at < b.created_at ? 1 : -1).slice(0, 3000)
    .map(o => ({ item_id: o.item_id, doc_type: o.doc_type, run_no: o.run_no, doc_date: o.doc_date, subject: o.subject, effective_date: o.effective_date, visibility: o.visibility }));
}

function ordersCreate_(ctx, p) {
  const s = getSettings_();
  const type = enum_(p.doc_type, ['คำสั่ง', 'ประกาศ'], 'ประเภท');
  const vis = enum_(p.visibility || VIS_ALL, [VIS_ALL, VIS_RESTRICTED], 'สิทธิการมองเห็น');
  const rec = {
    doc_date: isoDate_(p.doc_date, 'ลงวันที่', true),
    subject: str_(p.subject, 500, 'เรื่อง', true),
    effective_date: isoDate_(p.effective_date, 'วันที่มีผลบังคับใช้', false)
  };
  let allowed = [];
  if (vis === VIS_RESTRICTED) {
    const users = userMap_();
    allowed = (Array.isArray(p.allowed_users) ? p.allowed_users : []).filter(id => users[id]);
    if (!allowed.length) throw new AppError('กรุณาเลือกผู้ที่มีสิทธิ์ดูอย่างน้อย 1 คน');
  }
  const yearBE = thaiYear_(rec.doc_date), itemId = newId_('OR');
  const isOrder = type === 'คำสั่ง';
  const saved = saveFile_(p.file, { yearBE: yearBE, type: isOrder ? FOLDER.ORDER : FOLDER.ANNOUNCE, name: itemId, kinds: ['pdf'] });
  let run;
  try {
    Db.withLock(() => {
      const n = nextRunNo_(isOrder ? 'order' : 'announce', yearBE);
      run = formatRunNo_(isOrder ? s.order_format : s.announce_format, n, yearBE, s.doc_code);
      Db.insert('OrdersAnnouncements', Object.assign({
        item_id: itemId, doc_type: type, run_no: run, file_url: saved.url, visibility: vis,
        allowed_users: JSON.stringify(allowed), created_by: ctx.user.user_id, created_at: nowStamp_()
      }, rec));
    });
  } catch (e) { trashFile_(saved.id); throw e; }
  renameFile_(saved.id, type + '-' + run);
  audit_(itemId, ctx.user.user_id, 'ออกเลข' + type, run + ' | ' + rec.subject);
  if (vis === VIS_RESTRICTED) notifyUsers_(allowed, 'มี' + type + 'ใหม่', ['เลขที่: ' + run, 'เรื่อง: ' + rec.subject]);
  return { item_id: itemId, run_no: run };
}

/* ========================= 7) Tracking ========================= */
function trackingList_(ctx, p) {
  const includeDone = !!(p && p.include_done);
  const docs = {}; Db.all('IncomingDocs').forEach(d => docs[d.doc_id] = d);
  const ends = {}; Db.all('Endorsements').forEach(e => ends[e.endorse_id] = e);
  const users = userMap_();
  return Db.all('TaskTracking').filter(t => includeDone || t.task_status !== ST_DONE).map(t => {
    const d = docs[t.doc_id] || {}, e = ends[t.endorse_id] || {}, u = users[t.user_id] || {};
    return {
      task_id: t.task_id, doc_id: t.doc_id, reg_no: d.reg_no, subject: d.subject, urgency: d.urgency,
      user_name: u.full_name, department: u.department, due_date: e.due_date,
      read_status: t.read_status, read_at: t.read_at, task_status: t.task_status,
      due_state: dueState_(e.due_date, t.task_status)
    };
  }).sort((a, b) => (a.due_date || '9') < (b.due_date || '9') ? -1 : 1);
}

function trackingTimeline_(ctx, p) {
  const doc = Db.findOne('IncomingDocs', d => d.doc_id === p.doc_id);
  if (!doc) throw new AppError('ไม่พบหนังสือ');
  const users = userMap_();
  const logs = Db.where('AuditLogs', l => l.doc_id === doc.doc_id).sort((a, b) => a.timestamp < b.timestamp ? -1 : 1)
    .map(l => ({ time: l.timestamp, action: l.action_type, by: (users[l.action_by] || {}).full_name || l.action_by, detail: l.detail }));
  const end = Db.findOne('Endorsements', e => e.doc_id === doc.doc_id);
  const tasks = Db.where('TaskTracking', t => t.doc_id === doc.doc_id).map(t => ({
    task_id: t.task_id, user_name: (users[t.user_id] || {}).full_name, read_status: t.read_status, read_at: t.read_at,
    task_status: t.task_status, completed_at: t.completed_at, action_note: t.action_note,
    due_state: dueState_(end ? end.due_date : '', t.task_status)
  }));
  return {
    doc: { reg_no: doc.reg_no, subject: doc.subject, from_org: doc.from_org, status: doc.status, received_date: doc.received_date, received_time: doc.received_time },
    endorsement: end ? { comment: end.comment, due_date: end.due_date, endorsed_at: end.endorsed_at, director: (users[end.director_id] || {}).full_name } : null,
    logs: logs, tasks: tasks
  };
}

function trackingNudge_(ctx, p) {
  const ids = Array.isArray(p.task_ids) ? p.task_ids : [];
  if (!ids.length) throw new AppError('กรุณาเลือกงานที่ต้องการแจ้งเตือน');
  const cache = CacheService.getScriptCache();
  const docs = {}; Db.all('IncomingDocs').forEach(d => docs[d.doc_id] = d);
  const ends = {}; Db.all('Endorsements').forEach(e => ends[e.endorse_id] = e);
  let nudged = 0, skipped = 0;
  Db.where('TaskTracking', t => ids.indexOf(t.task_id) >= 0 && t.task_status !== ST_DONE).forEach(t => {
    const key = 'nudge_' + t.task_id;
    if (cache.get(key)) { skipped++; return; }               // ป้องกันการกดรัว: 1 ครั้ง/ชั่วโมง/งาน
    const d = docs[t.doc_id] || {}, e = ends[t.endorse_id] || {};
    notifyUsers_([t.user_id], 'แจ้งเตือนซ้ำ: งานที่ยังไม่ดำเนินการ', [
      'เลขรับ: ' + d.reg_no, 'เรื่อง: ' + d.subject, 'กำหนดแล้วเสร็จ: ' + thaiDate_(e.due_date),
      t.read_status === TK_READ ? 'สถานะ: เปิดอ่านแล้ว ยังไม่ปิดงาน' : 'สถานะ: ยังไม่เปิดอ่าน'
    ]);
    cache.put(key, '1', 3600);
    audit_(t.doc_id, ctx.user.user_id, 'ส่งแจ้งเตือนซ้ำ', 'ถึง ' + ((userMap_()[t.user_id] || {}).full_name || t.user_id));
    nudged++;
  });
  return { nudged: nudged, skipped: skipped };
}

/* ========================= 8) Reports ========================= */
function reportsQuery_(ctx, p) {
  const type = enum_(p.type, ['incoming', 'outgoing', 'orders'], 'ประเภทรายงาน');
  const from = isoDate_(p.date_from, 'วันที่เริ่มต้น', false), to = isoDate_(p.date_to, 'วันที่สิ้นสุด', false);
  const dept = str_(p.department, 100, 'กลุ่มงาน', false), status = str_(p.status, 50, 'สถานะ', false);
  const kw = str_(p.keyword, 100, 'คำค้น', false).toLowerCase();
  const inRange = d => (!from || d >= from) && (!to || d <= to);
  const hit = (...f) => !kw || f.some(x => String(x || '').toLowerCase().indexOf(kw) >= 0);
  const byAsc = (a, b) => a.created_at < b.created_at ? -1 : 1;

  if (type === 'incoming') {
    const users = userMap_(), tasksBy = {};
    Db.all('TaskTracking').forEach(t => (tasksBy[t.doc_id] = tasksBy[t.doc_id] || []).push(users[t.user_id] || {}));
    const rows = Db.all('IncomingDocs').filter(d => inRange(d.received_date) && (!status || d.status === status) && hit(d.subject, d.from_org, d.doc_no, d.reg_no))
      .filter(d => !dept || (tasksBy[d.doc_id] || []).some(u => u.department === dept)).sort(byAsc)
      .map((d, i) => [i + 1, d.reg_no, thaiDate_(d.received_date), d.received_time, d.doc_no, thaiDate_(d.doc_date), d.from_org, d.subject, d.urgency,
        (tasksBy[d.doc_id] || []).map(u => u.full_name).join(', '), d.status]);
    return { title: 'ทะเบียนหนังสือรับ', columns: ['ที่', 'เลขรับ', 'วันที่รับ', 'เวลา', 'ที่หนังสือ', 'ลงวันที่', 'จาก', 'เรื่อง', 'ชั้นความเร็ว', 'ผู้รับผิดชอบ', 'สถานะ'], rows: rows };
  }
  if (type === 'outgoing') {
    const rows = Db.all('OutgoingDocs').filter(o => inRange(o.doc_date) && (!dept || o.department === dept) && (!status || o.status === status) && hit(o.subject, o.to_org, o.reg_no))
      .sort(byAsc).map((o, i) => [i + 1, o.reg_no, o.out_type, thaiDate_(o.doc_date), o.to_org, o.subject, o.department, o.status]);
    return { title: 'ทะเบียนหนังสือส่ง', columns: ['ที่', 'เลขที่หนังสือส่ง', 'ประเภท', 'ลงวันที่', 'ถึง', 'เรื่อง', 'กลุ่มงาน', 'สถานะ'], rows: rows };
  }
  const rows = Db.all('OrdersAnnouncements').filter(o => inRange(o.doc_date) && (!status || o.doc_type === status) && hit(o.subject, o.run_no))
    .sort(byAsc).map((o, i) => [i + 1, o.doc_type, o.run_no, thaiDate_(o.doc_date), o.subject, thaiDate_(o.effective_date), o.visibility]);
  return { title: 'ทะเบียนคำสั่งและประกาศ', columns: ['ที่', 'ประเภท', 'เลขที่', 'ลงวันที่', 'เรื่อง', 'วันที่มีผลบังคับใช้', 'การเผยแพร่'], rows: rows };
}

/* ========================= Files (ตรวจสิทธิ์ก่อนส่งไฟล์) ========================= */
function fileGet_(ctx, p) {
  const u = ctx.user, staff = isStaff_(u);
  let url = '';
  if (p.kind === 'incoming') {
    const doc = Db.findOne('IncomingDocs', d => d.doc_id === p.id);
    if (!doc) throw new AppError('ไม่พบหนังสือ');
    const end = Db.findOne('Endorsements', e => e.doc_id === doc.doc_id);
    if (!staff) {
      if (!Db.findOne('TaskTracking', t => t.doc_id === doc.doc_id && t.user_id === u.user_id)) throw new AppError('คุณไม่มีสิทธิ์เปิดไฟล์นี้', 'FORBIDDEN');
    }
    const v = staff ? (p.variant || 'latest') : 'latest';
    if (v === 'original') url = doc.original_file_url;
    else if (v === 'stamped') url = doc.stamped_file_url || doc.original_file_url;
    else if (v === 'endorsed') url = end ? end.endorsed_file_url : '';
    else url = (end && end.endorsed_file_url) || doc.stamped_file_url || doc.original_file_url;
  } else if (p.kind === 'outgoing') {
    const o = Db.findOne('OutgoingDocs', x => x.out_id === p.id);
    if (!o || (!staff && o.out_type !== OUT_CIRCULAR)) throw new AppError('คุณไม่มีสิทธิ์เปิดไฟล์นี้', 'FORBIDDEN');
    url = o.file_url;
  } else if (p.kind === 'order') {
    const o = Db.findOne('OrdersAnnouncements', x => x.item_id === p.id);
    if (!o) throw new AppError('ไม่พบเอกสาร');
    if (!staff && o.visibility !== VIS_ALL && parseJson_(o.allowed_users, []).indexOf(u.user_id) < 0) throw new AppError('คุณไม่มีสิทธิ์เปิดไฟล์นี้', 'FORBIDDEN');
    url = o.file_url;
  } else if (p.kind === 'evidence') {
    const t = Db.findOne('TaskTracking', x => x.task_id === p.id);
    if (!t || (!staff && t.user_id !== u.user_id)) throw new AppError('คุณไม่มีสิทธิ์เปิดไฟล์นี้', 'FORBIDDEN');
    url = t.evidence_url;
  } else throw new AppError('ประเภทไฟล์ไม่ถูกต้อง');
  if (!url) throw new AppError('ไม่พบไฟล์');
  return readFileBase64_(url);
}

/* ========================= 9) Users & Settings ========================= */
function usersList_() {
  return Db.all('Users').map(u => ({
    user_id: u.user_id, username: u.username, full_name: u.full_name, position: u.position, department: u.department,
    role: u.role, has_signature: !!u.signature_url, telegram_chat_id: u.telegram_chat_id, email: u.email, status: u.status
  }));
}

function usersSave_(ctx, p) {
  const username = str_(p.username, 50, 'ชื่อผู้ใช้', true).toLowerCase();
  if (!/^[a-z0-9_.-]{3,50}$/.test(username)) throw new AppError('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 _ . - (3-50 ตัว)');
  const rec = {
    username: username,
    full_name: str_(p.full_name, 150, 'ชื่อ-สกุล', true),
    position: str_(p.position, 100, 'ตำแหน่ง', false),
    department: str_(p.department, 100, 'กลุ่มงาน', false),
    role: enum_(p.role, [ROLES.ADMIN, ROLES.SARABAN, ROLES.DIRECTOR, ROLES.TEACHER], 'บทบาท'),
    status: enum_(p.status || USER_ACTIVE, [USER_ACTIVE, USER_SUSPENDED], 'สถานะ'),
    email: str_(p.email, 150, 'อีเมล', false),
    telegram_chat_id: str_(p.telegram_chat_id, 30, 'Telegram Chat ID', false)
  };
  if (rec.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email)) throw new AppError('รูปแบบอีเมลไม่ถูกต้อง');
  if (rec.telegram_chat_id && !/^-?\d{1,20}$/.test(rec.telegram_chat_id)) throw new AppError('Telegram Chat ID ต้องเป็นตัวเลข');

  return Db.withLock(() => {
    const dup = Db.findOne('Users', u => String(u.username).toLowerCase() === username && u.user_id !== p.user_id);
    if (dup) throw new AppError('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
    const userId = String(p.user_id || '').trim();
    if (userId) {
      const cur = Db.findOne('Users', u => u.user_id === userId);
      if (!cur) throw new AppError('ไม่พบผู้ใช้');
      if (cur.user_id === ctx.user.user_id && (rec.role !== ROLES.ADMIN || rec.status !== USER_ACTIVE)) throw new AppError('ไม่สามารถลดสิทธิ์หรือระงับบัญชีของตนเองได้');
      const patch = Object.assign({}, rec);
      if (p.password) {
        if (String(p.password).length < 8) throw new AppError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
        patch.password_hash = hashPassword_(p.password);
      }
      Db.update('Users', cur._row, patch);
      audit_('', ctx.user.user_id, 'แก้ไขผู้ใช้', username);
      return { user_id: cur.user_id };
    }
    if (String(p.password || '').length < 8) throw new AppError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
    const id = newId_('U');
    Db.insert('Users', Object.assign({ user_id: id, password_hash: hashPassword_(p.password), signature_url: '' }, rec));
    audit_('', ctx.user.user_id, 'เพิ่มผู้ใช้', username);
    return { user_id: id };
  });
}

function usersSetStatus_(ctx, p) {
  const st = enum_(p.status, [USER_ACTIVE, USER_SUSPENDED], 'สถานะ');
  if (p.user_id === ctx.user.user_id) throw new AppError('ไม่สามารถระงับบัญชีของตนเองได้');
  const u = Db.findOne('Users', x => x.user_id === p.user_id);
  if (!u) throw new AppError('ไม่พบผู้ใช้');
  Db.update('Users', u._row, { status: st });
  audit_('', ctx.user.user_id, st === USER_ACTIVE ? 'เปิดสิทธิ์ผู้ใช้' : 'ระงับสิทธิ์ผู้ใช้', u.username);
  return true;
}

function usersResetPassword_(ctx, p) {
  const u = Db.findOne('Users', x => x.user_id === p.user_id);
  if (!u) throw new AppError('ไม่พบผู้ใช้');
  if (String(p.new_password || '').length < 8) throw new AppError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  Db.update('Users', u._row, { password_hash: hashPassword_(p.new_password) });
  audit_('', ctx.user.user_id, 'รีเซ็ตรหัสผ่าน', u.username);
  return true;
}

function usersUploadSignature_(ctx, p) {
  const targetId = p.user_id || ctx.user.user_id;
  if (targetId !== ctx.user.user_id && ctx.user.role !== ROLES.ADMIN) throw new AppError('คุณไม่มีสิทธิ์อัปโหลดลายเซ็นของผู้อื่น', 'FORBIDDEN');
  const u = Db.findOne('Users', x => x.user_id === targetId);
  if (!u) throw new AppError('ไม่พบผู้ใช้');
  const f = decodeFile_(p.file, ['png']);
  if (f.bytes.length > 1024 * 1024) throw new AppError('ไฟล์ลายเซ็นต้องไม่เกิน 1 MB');
  const saved = saveFile_(p.file, { yearBE: '_system', type: FOLDER.SIGN, name: 'sign-' + u.user_id, kinds: ['png'] });
  if (u.signature_url) trashFile_(fileIdFromUrl_(u.signature_url));
  Db.update('Users', u._row, { signature_url: saved.url });
  audit_('', ctx.user.user_id, 'อัปโหลดลายเซ็น', u.username);
  return true;
}

function settingsGet_(ctx) {
  if (ctx.user.role !== ROLES.ADMIN) return { public: getPublicSettings_() };
  const s = getSettings_(), out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(k => out[k] = s[k]);
  out.telegram_bot_token = s.telegram_bot_token ? '********' : '';
  const counters = Db.all('Settings').filter(r => r.setting_key.indexOf('counter_') === 0)
    .map(r => ({ key: r.setting_key, value: r.setting_value })).sort((a, b) => a.key < b.key ? 1 : -1);
  return { public: getPublicSettings_(), settings: out, counters: counters };
}

function settingsSave_(ctx, p) {
  const incoming = p.settings || {};
  const allowed = Object.keys(DEFAULT_SETTINGS);
  const checks = {
    stamp_position: v => enum_(v, ['top-right', 'top-left', 'bottom-right', 'bottom-left'], 'ตำแหน่งตราประทับ'),
    stamp_color: v => enum_(v, ['blue', 'red'], 'สีตราประทับ'),
    out_circular_shared: v => enum_(v, ['TRUE', 'FALSE'], 'ตัวเลือกเลขหนังสือเวียน'),
    telegram_enabled: v => enum_(v, ['TRUE', 'FALSE'], 'Telegram'),
    email_enabled: v => enum_(v, ['TRUE', 'FALSE'], 'Email')
  };
  Object.keys(incoming).forEach(k => {
    if (allowed.indexOf(k) < 0) return;
    let v = String(incoming[k] == null ? '' : incoming[k]).trim();
    if (k === 'telegram_bot_token' && v === '********') return;          // ไม่เปลี่ยน
    if (checks[k]) v = checks[k](v);
    if (v.length > 2000) throw new AppError('ค่าตั้งค่า ' + k + ' ยาวเกินกำหนด');
    if (k === 'root_folder_id' && v) { try { DriveApp.getFolderById(v); } catch (e) { throw new AppError('Root Folder ID ไม่ถูกต้องหรือไม่มีสิทธิ์เข้าถึง'); } }
    setSetting_(k, v);
  });
  audit_('', ctx.user.user_id, 'แก้ไขการตั้งค่าระบบ', Object.keys(incoming).join(', '));
  return getPublicSettings_();
}

/** รีเซ็ต/กำหนดเลขรันล่าสุด (เลขถัดไป = value + 1) */
function settingsResetRun_(ctx, p) {
  const type = enum_(p.type, ['incoming', 'outgoing_general', 'outgoing_circular', 'order', 'announce'], 'ประเภทเลขรัน');
  const year = parseInt(p.year, 10), value = parseInt(p.value, 10);
  if (!(year >= 2500 && year <= 2700)) throw new AppError('ปี พ.ศ. ไม่ถูกต้อง');
  if (!(value >= 0 && value <= 999999)) throw new AppError('ค่าเลขรันไม่ถูกต้อง');
  setSetting_('counter_' + type + '_' + year, String(value));
  audit_('', ctx.user.user_id, 'ตั้งค่าเลขรัน', type + ' ปี ' + year + ' = ' + value);
  return true;
}

function settingsTestNotify_(ctx) {
  const n = notifyUsers_([ctx.user.user_id], 'ทดสอบการแจ้งเตือน', ['หากคุณเห็นข้อความนี้ แสดงว่าการเชื่อมต่อสำเร็จ']);
  if (!n) throw new AppError('ส่งไม่สำเร็จ: ตรวจสอบ Bot Token, Chat ID/อีเมลของคุณ และเปิดใช้งานช่องทางแจ้งเตือนในหน้าตั้งค่า');
  return { sent: n };
}
