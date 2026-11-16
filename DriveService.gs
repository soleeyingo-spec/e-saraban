/**
 * DriveService.gs — โฟลเดอร์ (ปี พ.ศ. / ประเภท), ตรวจและบันทึกไฟล์, อ่านไฟล์เป็น base64
 */
const FOLDER = { IN: 'หนังสือรับ', OUT: 'หนังสือส่ง', ORDER: 'คำสั่ง', ANNOUNCE: 'ประกาศ', EVIDENCE: 'ผลการปฏิบัติงาน', SIGN: 'ลายเซ็น' };

function driveRoot_() {
  const id = getSettings_().root_folder_id;
  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { throw new AppError('Root Folder ID ไม่ถูกต้องหรือไม่มีสิทธิ์เข้าถึง'); }
  }
  const f = DriveApp.createFolder('e-Saraban Files');
  setSetting_('root_folder_id', f.getId());
  return f;
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Root / {ปี พ.ศ.} / {ประเภท} สร้างอัตโนมัติ */
function driveFolder_(yearBE, type) {
  const cache = CacheService.getScriptCache();
  const key = 'fld_' + yearBE + '_' + type;
  const cached = cache.get(key);
  if (cached) { try { return DriveApp.getFolderById(cached); } catch (e) { /* stale */ } }
  return Db.withLock(() => {
    const y = getOrCreateFolder_(driveRoot_(), String(yearBE));
    const f = type ? getOrCreateFolder_(y, type) : y;
    cache.put(key, f.getId(), 21600);
    return f;
  });
}

function safeName_(s) { return String(s || 'file').replace(/[\\\/:*?"<>|\r\n]/g, '-').trim().slice(0, 120); }

function detectType_(bytes) {
  const b = i => bytes[i] & 0xff;
  if (bytes.length > 4 && b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return { ext: 'pdf', mime: 'application/pdf' };
  if (bytes.length > 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return { ext: 'png', mime: 'image/png' };
  if (bytes.length > 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  return null;
}

function decodeFile_(b64, kinds) {
  if (!b64 || typeof b64 !== 'string') throw new AppError('ไม่พบไฟล์ที่อัปโหลด');
  const clean = b64.replace(/^data:[^;]+;base64,/, '');
  if (clean.length > APP.MAX_FILE_MB * 1024 * 1024 * 1.37) throw new AppError('ไฟล์ใหญ่เกิน ' + APP.MAX_FILE_MB + ' MB');
  let bytes;
  try { bytes = Utilities.base64Decode(clean); } catch (e) { throw new AppError('ข้อมูลไฟล์ไม่ถูกต้อง'); }
  const t = detectType_(bytes);
  if (!t || kinds.indexOf(t.ext) < 0) throw new AppError('ชนิดไฟล์ไม่ได้รับอนุญาต (รองรับ: ' + kinds.join(', ').toUpperCase() + ')');
  return { bytes: bytes, mime: t.mime, ext: t.ext };
}

/** opt: { yearBE, type, name, kinds:['pdf'] } → { url, id } */
function saveFile_(b64, opt) {
  const f = decodeFile_(b64, opt.kinds || ['pdf']);
  const folder = driveFolder_(opt.yearBE, opt.type);
  const blob = Utilities.newBlob(f.bytes, f.mime, safeName_(opt.name) + '.' + f.ext);
  const file = folder.createFile(blob);
  return { url: file.getUrl(), id: file.getId() };
}

function fileIdFromUrl_(url) {
  const m = String(url || '').match(/\/d\/([-\w]{20,})/) || String(url || '').match(/[?&]id=([-\w]{20,})/);
  return m ? m[1] : null;
}

function trashFile_(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* ignore */ } }

function renameFile_(id, name) {
  try { const f = DriveApp.getFileById(id); const ext = f.getName().split('.').pop(); f.setName(safeName_(name) + '.' + ext); } catch (e) { /* ignore */ }
}

function readFileBase64_(url) {
  const id = fileIdFromUrl_(url);
  if (!id) throw new AppError('ไม่พบไฟล์');
  let file;
  try { file = DriveApp.getFileById(id); } catch (e) { throw new AppError('ไม่พบไฟล์ใน Google Drive (อาจถูกลบ)'); }
  const blob = file.getBlob();
  return { name: file.getName(), mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}