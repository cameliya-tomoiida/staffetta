/**
 * 受発注ハブ: FAX転送スクリプト（Google Apps Script）
 * fax-inbox@example.com のラベル「FAX受信」に届いたFAX（PDF添付）を、ハブの受け口 /api/fax/inbound に送る。
 *
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）に入れるもの:
 *   HUB_URL   … ハブの公開URL（例: https://xxxx.trycloudflare.com）。末尾の / は不要
 *   HUB_TOKEN … ハブの .env.local にある FAX_INBOUND_TOKEN と同じ値
 *
 * 初回だけ setup を実行する（1分おきのトリガーを作り、これより前のメールは送らない）。
 * メールの既読・ラベル・削除には一切さわらない。送ったメールのIDはプロパティに記録して二重に送らない。
 */
const LABEL_NAME = 'FAX受信';
const MAX_SENT_IDS = 500;

function setup() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('START_AT', String(Date.now()));
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'forwardFaxes')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('forwardFaxes').timeBased().everyMinutes(1).create();
  Logger.log('設定しました。これから届くFAXをハブに送ります。');
}

function forwardFaxes() {
  const props = PropertiesService.getScriptProperties();
  const hubUrl = (props.getProperty('HUB_URL') || '').replace(/\/$/, '');
  const token = props.getProperty('HUB_TOKEN') || '';
  if (!hubUrl || !token) throw new Error('スクリプトプロパティ HUB_URL と HUB_TOKEN を入れてください');
  const startAt = Number(props.getProperty('START_AT') || Date.now());
  const sent = JSON.parse(props.getProperty('SENT_IDS') || '[]');

  const label = GmailApp.getUserLabelByName(LABEL_NAME);
  if (!label) throw new Error('ラベル「' + LABEL_NAME + '」が見つかりません');

  label.getThreads(0, 20).forEach((thread) => {
    thread.getMessages().forEach((msg) => {
      const id = msg.getId();
      if (sent.indexOf(id) >= 0 || msg.getDate().getTime() < startAt) return;
      const pdfs = msg.getAttachments().filter((a) => /pdf$/i.test(a.getContentType()) || /\.pdf$/i.test(a.getName()));
      if (!pdfs.length) return;
      const res = UrlFetchApp.fetch(hubUrl + '/api/fax/inbound', {
        method: 'post',
        contentType: 'application/json',
        headers: { 'X-Hub-Token': token },
        muteHttpExceptions: true,
        payload: JSON.stringify({
          messageId: id,
          receivedAt: msg.getDate().toISOString(),
          subject: msg.getSubject(),
          from: msg.getFrom(),
          via: 'gmail',
          attachments: pdfs.map((a) => ({ name: a.getName(), base64: Utilities.base64Encode(a.getBytes()) })),
        }),
      });
      if (res.getResponseCode() === 200) {
        sent.push(id);
      } else {
        Logger.log('送れませんでした ' + id + ' ' + res.getResponseCode() + ' ' + res.getContentText());
      }
    });
  });
  props.setProperty('SENT_IDS', JSON.stringify(sent.slice(-MAX_SENT_IDS)));
}
