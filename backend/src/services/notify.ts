import nodemailer from 'nodemailer'
import { query } from '../config/db.js'
import { env } from '../config/env.js'

// ── types ─────────────────────────────────────────────────────────────────────

interface NotifRow {
  id: string
  type: 'NEW_POST' | 'NEW_COMMENT' | 'LIKE'
  post_id: string
  user_id: string
  emailed_at: string | null
  chat_webhook_sent_at: string | null
  email: string
  full_name: string
  email_notifications: boolean
  chat_webhook_url: string | null
  // per-type prefs
  notif_new_post_email: boolean
  notif_new_post_chat: boolean
  notif_comment_email: boolean
  notif_comment_chat: boolean
  notif_like_email: boolean
  notif_like_chat: boolean
  post_title: string
  actor_name: string | null
}

// ── email transport (lazy-init) ───────────────────────────────────────────────

let _transport: nodemailer.Transporter | null = null

function getTransport(): nodemailer.Transporter | null {
  if (!env.gmailUser || !env.gmailAppPassword) return null
  if (_transport) return _transport
  _transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: env.gmailUser, pass: env.gmailAppPassword },
  })
  return _transport
}

// ── per-type preference helpers ───────────────────────────────────────────────

function wantsEmail(row: NotifRow): boolean {
  if (!row.email_notifications) return false
  if (row.type === 'NEW_POST')    return row.notif_new_post_email
  if (row.type === 'NEW_COMMENT') return row.notif_comment_email
  if (row.type === 'LIKE')        return row.notif_like_email
  return false
}

function wantsChat(row: NotifRow): boolean {
  if (!row.chat_webhook_url) return false
  if (row.type === 'NEW_POST')    return row.notif_new_post_chat
  if (row.type === 'NEW_COMMENT') return row.notif_comment_chat
  if (row.type === 'LIKE')        return row.notif_like_chat
  return false
}

// ── message builders ──────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; emoji: string; subject: string; accentColor: string; icon: string }> = {
  NEW_POST: {
    label:       '新しい投稿が届きました',
    emoji:       '📝',
    subject:     '【JMC Board】新しい投稿が届きました',
    accentColor: '#1E5FA8',
    icon:        '📋',
  },
  NEW_COMMENT: {
    label:       'あなたの投稿にコメントしました',
    emoji:       '💬',
    subject:     '【JMC Board】投稿にコメントが届きました',
    accentColor: '#1A7A48',
    icon:        '💬',
  },
  LIKE: {
    label:       'あなたの投稿にいいねしました',
    emoji:       '❤️',
    subject:     '【JMC Board】投稿にいいねが届きました',
    accentColor: '#E8732A',
    icon:        '❤️',
  },
}

function postUrl(postId: string) {
  return `${env.appBaseUrl}/posts/${postId}`
}

function buildEmailHtml(row: NotifRow): string {
  const actor  = row.actor_name ?? '誰か'
  const meta   = TYPE_META[row.type] ?? TYPE_META.NEW_POST
  const url    = postUrl(row.post_id)
  const accent = meta.accentColor

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${meta.subject}</title>
</head>
<body style="margin:0;padding:0;background:#F4EDDA;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Hiragino Kaku Gothic ProN',Meiryo,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4EDDA;padding:32px 16px">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(58,42,26,0.12)">

      <!-- Header bar -->
      <tr>
        <td style="background:${accent};padding:0">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:20px 28px">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background:rgba(255,255,255,0.2);border-radius:8px;padding:6px 12px">
                      <span style="color:#fff;font-weight:900;font-size:13px;letter-spacing:-0.3px">JMC Board</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px">
                <div style="font-size:28px;line-height:1;margin-bottom:8px">${meta.icon}</div>
                <div style="color:#fff;font-weight:900;font-size:18px;line-height:1.3;letter-spacing:-0.4px">${meta.label}</div>
                <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px">${actor}さんから</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="background:#FFFDF7;padding:24px 28px">

          <!-- Post card -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;overflow:hidden;border:1.5px solid #E4D4B8;margin-bottom:20px">
            <tr>
              <td style="background:#F9F4EC;padding:4px 16px;border-bottom:1px solid #E4D4B8">
                <span style="font-size:10px;font-weight:700;color:#A8906E;text-transform:uppercase;letter-spacing:0.8px">投稿</span>
              </td>
            </tr>
            <tr>
              <td style="background:#FFFDF7;padding:14px 16px">
                <div style="font-weight:800;font-size:15px;color:#3A2A1A;line-height:1.4;letter-spacing:-0.3px">${row.post_title}</div>
              </td>
            </tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center">
                <a href="${url}"
                   style="display:inline-block;background:${accent};color:#fff;font-weight:800;font-size:14px;padding:12px 28px;border-radius:50px;text-decoration:none;letter-spacing:-0.2px">
                  投稿を確認する &rarr;
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#F4EDDA;padding:16px 28px;border-top:1px solid #E4D4B8">
          <p style="margin:0;font-size:11px;color:#A8906E;text-align:center">
            JMC Board &bull; <a href="${env.appBaseUrl}" style="color:#A8906E">通知設定はプロフィールから変更できます</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}

function buildGoogleChatPayload(row: NotifRow): object {
  const actor = row.actor_name ?? '誰か'
  const meta  = TYPE_META[row.type] ?? TYPE_META.NEW_POST
  const url   = postUrl(row.post_id)
  return {
    cardsV2: [{
      cardId: `notif-${row.id}`,
      card: {
        header: {
          title: 'JMC Board',
          subtitle: `${meta.emoji} ${actor}さんが${meta.label}`,
        },
        sections: [{
          widgets: [{
            decoratedText: {
              text: `<b>${row.post_title}</b>`,
              bottomLabel: actor,
              button: {
                text: '投稿を確認する',
                onClick: { openLink: { url } },
              },
            },
          }],
        }],
      },
    }],
  }
}

// ── senders ───────────────────────────────────────────────────────────────────

async function sendEmail(row: NotifRow): Promise<void> {
  const transport = getTransport()
  if (!transport) return

  const meta = TYPE_META[row.type] ?? TYPE_META.NEW_POST
  await transport.sendMail({
    from: `"JMC Board" <${env.gmailSenderEmail ?? env.gmailUser}>`,
    to: row.email,
    subject: meta.subject,
    html: buildEmailHtml(row),
  })
}

async function sendGoogleChat(row: NotifRow): Promise<void> {
  if (!row.chat_webhook_url) return
  const payload = buildGoogleChatPayload(row)
  const res = await fetch(row.chat_webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google Chat webhook ${res.status}: ${text.slice(0, 200)}`)
  }
}

// ── background worker ─────────────────────────────────────────────────────────

async function processUnsentNotifications(): Promise<void> {
  const { rows } = await query<NotifRow>(`
    SELECT n.id, n.type, n.post_id, n.user_id, n.emailed_at, n.chat_webhook_sent_at,
           u.email, u.full_name, u.email_notifications,
           u.chat_webhook_url,
           u.notif_new_post_email, u.notif_new_post_chat,
           u.notif_comment_email,  u.notif_comment_chat,
           u.notif_like_email,     u.notif_like_chat,
           p.title AS post_title,
           a.full_name AS actor_name
    FROM notifications n
    JOIN users u  ON u.id = n.user_id
    JOIN posts p  ON p.id = n.post_id AND p.deleted_at IS NULL
    LEFT JOIN users a ON a.id = n.actor_id
    WHERE (n.emailed_at IS NULL AND u.email_notifications = TRUE)
       OR (n.chat_webhook_sent_at IS NULL AND u.chat_webhook_url IS NOT NULL)
    ORDER BY n.created_at ASC
    LIMIT 100
  `)

  for (const row of rows) {
    if (!row.emailed_at && wantsEmail(row)) {
      try {
        await sendEmail(row)
        await query('UPDATE notifications SET emailed_at = now() WHERE id = $1', [row.id])
      } catch (err) {
        console.error(`[notify] email failed notif ${row.id}:`, err)
      }
    } else if (!row.emailed_at) {
      // User doesn't want this type by email — mark sent so we don't retry forever
      await query('UPDATE notifications SET emailed_at = now() WHERE id = $1', [row.id]).catch(() => {})
    }

    if (!row.chat_webhook_sent_at && wantsChat(row)) {
      try {
        await sendGoogleChat(row)
        await query('UPDATE notifications SET chat_webhook_sent_at = now() WHERE id = $1', [row.id])
      } catch (err) {
        console.error(`[notify] google chat failed notif ${row.id}:`, err)
      }
    } else if (!row.chat_webhook_sent_at && row.chat_webhook_url) {
      // Has webhook but type opted out — mark done
      await query('UPDATE notifications SET chat_webhook_sent_at = now() WHERE id = $1', [row.id]).catch(() => {})
    }
  }
}

export function startNotificationWorker(): void {
  const emailReady = !!(env.gmailUser && env.gmailAppPassword)
  console.log(`[notify] worker started — email: ${emailReady ? 'enabled' : 'disabled (set GMAIL_USER + GMAIL_APP_PASSWORD)'}`)
  processUnsentNotifications().catch(err => console.error('[notify] initial pass error:', err))
  setInterval(() => {
    processUnsentNotifications().catch(err => console.error('[notify] worker error:', err))
  }, 30_000)
}
