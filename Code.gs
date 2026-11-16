/**
 * Code.gs — Routing, Config, Auth, Permission
 * e-Saraban : ระบบงานสารบรรณอิเล็กทรอนิกส์
 */
const APP = {
  NAME: 'e-Saraban',
  TZ: 'Asia/Bangkok',
  TOKEN_TTL_HOURS: 12,
  TOKEN_TTL_REMEMBER_DAYS: 30,
  MAX_FILE_MB: 20,
  LOGIN_MAX_FAIL: 5,
  LOGIN_LOCK_SEC: 600
};

const ROLES = { ADMIN: 'Admin', SARABAN: 'Saraban', DIRECTOR: 'Director', TEACHER: 'Teacher' };
const USER_ACTIVE = 'ใช้งาน';
const USER_SUSPENDED = 'ระงับ';

class AppError extends Error {
  constructor(message, code) { super(message); this.name = 'AppError'; this.code = code || 'ERROR'; }
}

/* ========================= Web App Entry ========================= */
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.appUrl = ScriptApp.getService().getUrl();
  return t.evaluate()
    .setTitle('ระบบงานสารบรรณอิเล็กทรอนิกส์ (e-Saraban)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getAppUrl_() {
  try { return ScriptApp.getService().getUrl(); } catch (e) { return ''; }
}

/* ========================= Router ========================= */
function getRoutes_() {
  const A = ROLES.ADMIN, S = ROLES.SARABAN, D = ROLES.DIRECTOR, T = ROLES.TEACHER;
  const ALL = [A, S, D, T], STAFF = [A, S, D], REG = [A, S];
  return {
    // Auth
    'auth.login':          { public: true, fn: (c, p) => authLogin_(p) },
    'auth.me':             { roles: ALL, fn: (c) => ({ user: publicUser_(c.user), settings: getPublicSettings_() }) },
    'auth.changePassword': { roles: ALL, fn: (c, p) => authChangePassword_(c, p) },
    // Dashboard
    'dashboard.stats':     { roles: ALL, fn: (c) => dashboardStats_(c) },
    // Incoming
    'incoming.list':        { roles: STAFF, fn: (c, p) => incomingList_(c, p) },
    'incoming.create':      { roles: REG, fn: (c, p) => incomingCreate_(c, p) },
    'incoming.saveStamped': { roles: REG, fn: (c, p) => incomingSaveStamped_(c, p) },
    // Endorsement
    'endorse.pending':     { roles: [D], fn: (c) => endorsePending_(c) },
    'endorse.submit':      { roles: [D], fn: (c, p) => endorseSubmit_(c, p) },
    'users.directory':     { roles: ALL, fn: () => usersDirectory_() },
    'users.mySignature':   { roles: [D, A, S], fn: (c) => usersMySignature_(c) },
    // Tasks
    'tasks.my':            { roles: ALL, fn: (c) => tasksMy_(c) },
    'tasks.open':          { roles: ALL, fn: (c, p) => tasksOpen_(c, p) },
    'tasks.complete':      { roles: ALL, fn: (c, p) => tasksComplete_(c, p) },
    // Outgoing
    'outgoing.list':       { roles: ALL, fn: (c) => outgoingList_(c) },
    'outgoing.create':     { roles: ALL, fn: (c, p) => outgoingCreate_(c, p) },
    // Orders
    'orders.list':         { roles: ALL, fn: (c) => ordersList_(c) },
    'orders.create':       { roles: ALL, fn: (c, p) => ordersCreate_(c, p) },
    // Tracking
    'tracking.list':       { roles: STAFF, fn: (c, p) => trackingList_(c, p) },
    'tracking.timeline':   { roles: STAFF, fn: (c, p) => trackingTimeline_(c, p) },
    'tracking.nudge':      { roles: STAFF, fn: (c, p) => trackingNudge_(c, p) },
    // Reports
    'reports.query':       { roles: STAFF, fn: (c, p) => reportsQuery_(c, p) },
    // Users & Settings
    'users.list':          { roles: [A], fn: () => usersList_() },
    'users.save':          { roles: [A], fn: (c, p) => usersSave_(c, p) },
    'users.setStatus':     { roles: [A], fn: (c, p) => usersSetStatus_(c, p) },
    'users.resetPassword': { roles: [A], fn: (c, p) => usersResetPassword_(c, p) },
    'users.uploadSignature': { roles: ALL, fn: (c, p) => usersUploadSignature_(c, p) },
    'settings.get':        { roles: ALL, fn: (c) => settingsGet_(c) },
    'settings.save':       { roles: [A], fn: (c, p) => settingsSave_(c, p) },
    'settings.resetRun':   { roles: [A], fn: (c, p) => settingsResetRun_(c, p) },
    'settings.testNotify': { roles: [A], fn: (c) => settingsTestNotify_(c) },
    // Files
    'file.get':            { roles: ALL, fn: (c, p) => fileGet_(c, p) }
  };
}

/** จุดเข้าเดียวของ google.script.run  →  google.script.run.api(token, action, payload) */
function api(token, action, payload) {
  try {
    const route = getRoutes_()[action];
    if (!route) throw new AppError('ไม่พบคำสั่ง: ' + action, 'NOT_FOUND');
    const ctx = { user: null, token: token };
    if (!route.public) {
      ctx.user = authenticate_(token);
      if (route.roles.indexOf(ctx.user.role) < 0) {
        throw new AppError('คุณไม่มีสิทธิ์ใช้งานฟังก์ชันนี้', 'FORBIDDEN');
      }
    }
    return { ok: true, data: route.fn(ctx, payload || {}) };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, code: e.code };
    console.error(action + ' : ' + (e && e.stack ? e.stack : e));
    return { ok: false, error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่หรือแจ้งผู้ดูแล', code: 'INTERNAL' };
  }
}

/* ========================= Auth ========================= */
function getSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('TOKEN_SECRET', s); }
  return s;
}

function toHex_(bytes) { return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join(''); }

function hashPassword_(password, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g, '');
  const h = toHex_(Utilities.computeHmacSha256Signature(String(password), salt));
  return salt + ':' + h;
}

function verifyPassword_(password, stored) {
  const parts = String(stored || '').split(':');
  // รองรับข้อมูลเดิมที่อาจถูกบันทึกเป็น plain text เพื่อให้ย้ายระบบได้
  // บัญชีที่ Login สำเร็จด้วยรูปแบบนี้จะถูกแปลงเป็น salt:hash ใน authLogin_ ทันที
  if (parts.length !== 2) return String(password) === String(stored || '');
  return safeEqual_(hashPassword_(password, parts[0]), stored);
}

function isLegacyPlainPassword_(stored) {
  return String(stored || '').indexOf(':') < 0;
}

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function signToken_(userId, remember) {
  const exp = Date.now() + (remember ? APP.TOKEN_TTL_REMEMBER_DAYS * 864e5 : APP.TOKEN_TTL_HOURS * 36e5);
  const body = Utilities.base64EncodeWebSafe(JSON.stringify({ u: userId, e: exp }));
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, getSecret_()));
  return { token: body + '.' + sig, expires: exp };
}

function verifyToken_(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const expect = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, getSecret_()));
  if (!safeEqual_(sig, expect)) return null;
  try {
    const p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(body)).getDataAsString());
    if (!p.u || p.e < Date.now()) return null;
    return p;
  } catch (e) { return null; }
}

function authenticate_(token) {
  const payload = verifyToken_(token);
  if (!payload) throw new AppError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'UNAUTHORIZED');
  const user = Db.findOne('Users', u => u.user_id === payload.u);
  if (!user || user.status !== USER_ACTIVE) throw new AppError('บัญชีนี้ไม่สามารถใช้งานได้', 'UNAUTHORIZED');
  return user;
}

function publicUser_(u) {
  return {
    user_id: u.user_id, username: u.username, full_name: u.full_name, position: u.position,
    department: u.department, role: u.role, has_signature: !!u.signature_url,
    telegram_chat_id: u.telegram_chat_id, email: u.email
  };
}

function authLogin_(p) {
  const username = String(p.username || '').trim().toLowerCase();
  const password = String(p.password || '');
  if (!username || !password) throw new AppError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

  const cache = CacheService.getScriptCache();
  const key = 'fail_' + encodeURIComponent(username).slice(0, 200);
  const fails = parseInt(cache.get(key) || '0', 10);
  if (fails >= APP.LOGIN_MAX_FAIL) {
    throw new AppError('ลองเข้าสู่ระบบผิดหลายครั้ง กรุณารอ ' + Math.round(APP.LOGIN_LOCK_SEC / 60) + ' นาที', 'LOCKED');
  }
  const user = Db.findOne('Users', u => String(u.username).toLowerCase() === username);
  const ok = user ? verifyPassword_(password, user.password_hash) : (hashPassword_(password, 'dummy'), false);
  if (!ok || user.status !== USER_ACTIVE) {
    cache.put(key, String(fails + 1), APP.LOGIN_LOCK_SEC);
    audit_('', user ? user.user_id : username, 'เข้าสู่ระบบไม่สำเร็จ', '');
    throw new AppError(ok ? 'บัญชีนี้ถูกระงับสิทธิ์' : 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  cache.remove(key);
  if (isLegacyPlainPassword_(user.password_hash)) {
    Db.update('Users', user._row, { password_hash: hashPassword_(password) });
  }
  const t = signToken_(user.user_id, !!p.remember);
  audit_('', user.user_id, 'เข้าสู่ระบบ', '');
  return { token: t.token, expires: t.expires, user: publicUser_(user), settings: getPublicSettings_() };
}

function authChangePassword_(ctx, p) {
  const nw = String(p.new_password || '');
  if (nw.length < 8) throw new AppError('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
  if (!verifyPassword_(String(p.old_password || ''), ctx.user.password_hash)) throw new AppError('รหัสผ่านเดิมไม่ถูกต้อง');
  Db.update('Users', ctx.user._row, { password_hash: hashPassword_(nw) });
  audit_('', ctx.user.user_id, 'เปลี่ยนรหัสผ่าน', '');
  return true;
}
