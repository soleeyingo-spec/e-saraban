/**
 * NotifyService.gs — Telegram / Email (ล้มเหลวแล้วไม่ทำให้งานหลักล้ม)
 */
function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function sendTelegram_(token, chatId, title, lines, url) {
  try {
    let text = '<b>' + esc_(title) + '</b>\n' + lines.map(esc_).join('\n');
    if (url) text += '\n<a href="' + url + '">เปิดระบบ e-Saraban</a>';
    const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    if (res.getResponseCode() !== 200) { console.error('Telegram ' + res.getResponseCode() + ': ' + res.getContentText()); return false; }
    return true;
  } catch (e) { console.error('Telegram error: ' + e); return false; }
}

function sendEmail_(to, title, lines, url, orgName) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) return false;
    const html = '<div style="font-family:Sarabun,Arial,sans-serif"><h3>' + esc_(title) + '</h3>' +
      lines.map(l => '<div>' + esc_(l) + '</div>').join('') +
      (url ? '<p><a href="' + url + '">เปิดระบบ e-Saraban</a></p>' : '') + '</div>';
    MailApp.sendEmail({ to: to, subject: '[e-Saraban] ' + title, htmlBody: html, name: orgName || 'e-Saraban' });
    return true;
  } catch (e) { console.error('Email error: ' + e); return false; }
}

/** ส่งแจ้งเตือนหลายคน คืนจำนวนช่องทางที่ส่งสำเร็จ */
function notifyUsers_(userIds, title, lines) {
  const s = getSettings_(), users = userMap_(), url = getAppUrl_();
  const tgOn = s.telegram_enabled === 'TRUE' && s.telegram_bot_token;
  const mailOn = s.email_enabled === 'TRUE';
  let sent = 0;
  const seen = {};
  (userIds || []).forEach(id => {
    if (seen[id]) return; seen[id] = true;
    const u = users[id];
    if (!u || u.status !== USER_ACTIVE) return;
    if (tgOn && u.telegram_chat_id && sendTelegram_(s.telegram_bot_token, u.telegram_chat_id, title, lines, url)) sent++;
    if (mailOn && u.email && sendEmail_(u.email, title, lines, url, s.org_name)) sent++;
  });
  return sent;
}