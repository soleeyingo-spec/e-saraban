/**
 * Database.gs — Google Sheets CRUD, LockService, Run numbers, Settings, Audit, setupDatabase()
 */
const SCHEMA = {
  Users: ['user_id','username','password_hash','full_name','position','department','role','signature_url','telegram_chat_id','email','status'],
  IncomingDocs: ['doc_id','reg_no','doc_no','doc_date','received_date','received_time','from_org','subject','urgency','secrecy','original_file_url','stamped_file_url','status','created_by','created_at'],
  Endorsements: ['endorse_id','doc_id','director_id','comment','assigned_to','due_date','endorsed_file_url','endorsed_at'],
  TaskTracking: ['task_id','doc_id','endorse_id','user_id','read_status','read_at','task_status','action_note','completed_at','evidence_url'],
  OutgoingDocs: ['out_id','reg_no','out_type','doc_date','to_org','subject','department','file_url','status','created_by','created_at'],
  OrdersAnnouncements: ['item_id','doc_type','run_no','doc_date','subject','effective_date','file_url','created_by','created_at','visibility','allowed_users'],
  Settings: ['setting_key','setting_value'],
  AuditLogs: ['log_id','doc_id','action_by','action_type','detail','timestamp']
};

const DEFAULT_SETTINGS = {
  org_name: 'โรงเรียนตัวอย่างวิทยา',
  doc_code: 'ศธ 04xxx/',
  incoming_reg_format: '{n}/{yyyy}',        // {n} {n:3}=เติมศูนย์ {yyyy}=พ.ศ. {yy} {code}
  outgoing_reg_format: '{code}{n}',
  circular_reg_format: '{code}{n}',
  order_format: '{n}/{yyyy}',
  announce_format: '{n}/{yyyy}',
  out_circular_shared: 'TRUE',               // TRUE = หนังสือเวียนใช้เลขชุดเดียวกับหนังสือส่งทั่วไป
  stamp_text_in: 'ทะเบียนรับ',
  stamp_position: 'top-right',               // top-right | top-left | bottom-right | bottom-left
  stamp_color: 'blue',                       // blue | red
  endorse_templates: 'มอบกลุ่มงานวิชาการดำเนินการ\nเพื่อทราบและถือปฏิบัติ\nมอบกลุ่มงานบริหารทั่วไปดำเนินการ\nเสนอเพื่อโปรดพิจารณา',
  telegram_enabled: 'FALSE',
  telegram_bot_token: '',
  email_enabled: 'FALSE',
  root_folder_id: ''
};

/* ========================= Db layer ========================= */
const Db = {
  _ss: null, _settings: null, _lockDepth: 0,

  ss() {
    if (Db._ss) return Db._ss;
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('DB_ID');
    let s;
    if (id) s = SpreadsheetApp.openById(id);
    else {
      s = SpreadsheetApp.getActiveSpreadsheet();
      if (!s) throw new AppError('ไม่พบ Spreadsheet: กรุณาสร้าง Script จากเมนู Extensions ของ Google Sheet');
      props.setProperty('DB_ID', s.getId());
    }
    Db._ss = s;
    return s;
  },

  sheet(name) {
    const sh = Db.ss().getSheetByName(name);
    if (!sh) throw new AppError('ยังไม่ได้ตั้งค่าฐานข้อมูล กรุณารัน setupDatabase() ก่อน');
    return sh;
  },

  all(name) {
    const sh = Db.sheet(name);
    const v = sh.getDataRange().getValues();
    if (v.length < 2) return [];
    const h = v[0];
    const out = [];
    for (let i = 1; i < v.length; i++) {
      if (v[i].join('') === '') continue;
      const o = { _row: i + 1 };
      for (let j = 0; j < h.length; j++) {
        let c = v[i][j];
        if (c instanceof Date) c = Utilities.formatDate(c, APP.TZ, 'yyyy-MM-dd');
        o[h[j]] = (c === null || c === undefined) ? '' : c;
      }
      out.push(o);
    }
    return out;
  },

  where(name, pred) { return Db.all(name).filter(pred); },
  findOne(name, pred) { const r = Db.all(name); for (let i = 0; i < r.length; i++) if (pred(r[i])) return r[i]; return null; },

  insert(name, obj) {
    return Db.withLock(() => {
      const sh = Db.sheet(name);
      const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      const row = headers.map(h => (obj[h] === undefined || obj[h] === null) ? '' : obj[h]);
      const r = sh.getLastRow() + 1;
      if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
      sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
      return r;
    });
  },

  update(name, row, patch) {
    return Db.withLock(() => {
      const sh = Db.sheet(name);
      const lastCol = sh.getLastColumn();
      const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
      const rng = sh.getRange(row, 1, 1, lastCol);
      const cur = rng.getValues()[0];
      Object.keys(patch).forEach(k => {
        const i = headers.indexOf(k);
        if (i < 0) throw new AppError('ไม่พบคอลัมน์ ' + k);
        cur[i] = (patch[k] === null || patch[k] === undefined) ? '' : patch[k];
      });
      rng.setNumberFormat('@').setValues([cur]);
    });
  },

  /** LockService แบบ re-entrant (ซ้อนกันได้ใน execution เดียว) */
  withLock(fn) {
    if (Db._lockDepth > 0) return fn();
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new AppError('ระบบกำลังประมวลผลคำขออื่นอยู่ กรุณาลองใหม่อีกครั้ง', 'BUSY');
    Db._lockDepth = 1;
    try { return fn(); }
    finally { SpreadsheetApp.flush(); Db._lockDepth = 0; lock.releaseLock(); }
  }
};

/* ========================= Settings ========================= */
function getSettings_() {
  if (Db._settings) return Db._settings;
  const m = Object.assign({}, DEFAULT_SETTINGS);
  Db.all('Settings').forEach(r => { m[r.setting_key] = String(r.setting_value); });
  Db._settings = m;
  return m;
}

function setSetting_(key, val) {
  Db.withLock(() => {
    const rec = Db.findOne('Settings', r => r.setting_key === key);
    if (rec) Db.update('Settings', rec._row, { setting_value: String(val) });
    else Db.insert('Settings', { setting_key: key, setting_value: String(val) });
    Db._settings = null;
  });
}

function getPublicSettings_() {
  const s = getSettings_();
  return {
    org_name: s.org_name, doc_code: s.doc_code, stamp_text_in: s.stamp_text_in,
    stamp_position: s.stamp_position, stamp_color: s.stamp_color,
    endorse_templates: s.endorse_templates.split('\n').map(x => x.trim()).filter(Boolean),
    out_circular_shared: s.out_circular_shared
  };
}

/* ========================= Run number (ใช้ภายใน withLock เสมอ) ========================= */
function nextRunNo_(counterKey, yearBE) {
  return Db.withLock(() => {
    const key = 'counter_' + counterKey + '_' + yearBE;
    const rec = Db.findOne('Settings', r => r.setting_key === key);
    const next = (rec ? parseInt(rec.setting_value, 10) || 0 : 0) + 1;
    if (rec) Db.update('Settings', rec._row, { setting_value: String(next) });
    else Db.insert('Settings', { setting_key: key, setting_value: String(next) });
    Db._settings = null;
    return next;
  });
}

function formatRunNo_(fmt, n, yearBE, code) {
  return String(fmt || '{n}/{yyyy}')
    .replace(/\{n(?::(\d+))?\}/g, (m, pad) => pad ? String(n).padStart(parseInt(pad, 10), '0') : String(n))
    .replace(/\{yyyy\}/g, String(yearBE))
    .replace(/\{yy\}/g, String(yearBE).slice(-2))
    .replace(/\{code\}/g, code || '');
}

/* ========================= Audit ========================= */
function audit_(docId, userId, type, detail) {
  try {
    Db.insert('AuditLogs', {
      log_id: newId_('LG'), doc_id: docId || '', action_by: userId || '',
      action_type: type, detail: String(detail || '').slice(0, 1000), timestamp: nowStamp_()
    });
  } catch (e) { console.error('audit fail: ' + e); }
}

/* ========================= setupDatabase ========================= */
/** รันฟังก์ชันนี้ 1 ครั้งจาก Apps Script Editor (และรันซ้ำได้ปลอดภัยเมื่ออัปเดตเวอร์ชัน) */
function setupDatabase() {
  const ss = Db.ss();
  Object.keys(SCHEMA).forEach(name => {
    const headers = SCHEMA[name];
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      const cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].filter(String);
      const missing = headers.filter(h => cur.indexOf(h) < 0);
      if (missing.length) sh.getRange(1, cur.length + 1, 1, missing.length).setValues([missing]);
    }
    const cols = Math.max(sh.getLastColumn(), headers.length);
    sh.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    if (sh.getMaxRows() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, cols).setNumberFormat('@');
  });
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  // ค่าเริ่มต้น Settings
  const existing = {};
  Db.all('Settings').forEach(r => existing[r.setting_key] = true);
  Object.keys(DEFAULT_SETTINGS).forEach(k => {
    if (!existing[k]) Db.insert('Settings', { setting_key: k, setting_value: DEFAULT_SETTINGS[k] });
  });
  Db._settings = null;

  getSecret_();
  driveRoot_();

  // สร้าง Admin เริ่มต้นหากยังไม่มีผู้ใช้
  let msg = 'setupDatabase เสร็จสมบูรณ์';
  if (Db.all('Users').length === 0) {
    const pwd = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    Db.insert('Users', {
      user_id: newId_('U'), username: 'admin', password_hash: hashPassword_(pwd),
      full_name: 'ผู้ดูแลระบบ', position: 'ผู้ดูแลระบบ', department: 'งานสารบรรณ',
      role: ROLES.ADMIN, signature_url: '', telegram_chat_id: '', email: '', status: USER_ACTIVE
    });
    msg += '\n>>> บัญชีผู้ดูแลระบบ  username: admin   password: ' + pwd + '  (กรุณาเปลี่ยนหลังเข้าสู่ระบบ)';
  }
  Logger.log(msg);
  return msg;
}