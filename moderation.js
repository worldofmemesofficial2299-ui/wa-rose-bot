import { incrementWarn, resetWarn } from './db.js';
import { isNSFW } from './nsfw.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const LINK_REGEX = /https?:\/\/|wa\.me\/|chat\.whatsapp\.com\//i;

export async function handleMessage(sock, msg, config) {
  if (!msg.message || msg.key.fromMe) return;

  const groupJid = msg.key.remoteJid;
  if (!groupJid?.endsWith('@g.us')) return; // only groups

  const sender = msg.key.participant;
  const isAdmin = await checkAdmin(sock, groupJid, sender);
  if (isAdmin) return; // never punish admins

  const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    '';

  // 1. Anti-link
  if (config.toggles.antilink && LINK_REGEX.test(text)) {
    return punish(sock, groupJid, sender, msg, 'Links are not allowed', config);
  }

  // 2. Anti-forward
  if (config.toggles.antForward && msg.message.extendedTextMessage?.contextInfo?.isForwarded) {
    return punish(sock, groupJid, sender, msg, 'Forwarded messages are not allowed', config);
  }

  // 3. NSFW ("sex dictator")
  if (config.toggles.antinsfw && (msg.message.imageMessage || msg.message.videoMessage)) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const mime = msg.message.imageMessage?.mimetype || msg.message.videoMessage?.mimetype;
      const flagged = await isNSFW(buffer, mime);
      if (flagged) {
        return punish(sock, groupJid, sender, msg, 'NSFW content is not allowed', config);
      }
    } catch (e) {
      console.error('NSFW media download failed:', e.message);
    }
  }

  // 4. Rules keyword check (if you set rules like "No links")
  for (const rule of config.rules) {
    const keyword = rule.replace(/^No\s+/i, '').trim();
    if (keyword && new RegExp(`\\b${keyword}\\b`, 'i').test(text)) {
      return punish(sock, groupJid, sender, msg, `Violation: ${rule}`, config);
    }
  }
}

async function punish(sock, groupJid, userJid, msg, reason, config) {
  // Delete the offending message
  await sock.sendMessage(groupJid, { delete: msg.key }).catch(() => {});

  // Increment warning count
  const count = await incrementWarn(groupJid, userJid);
  const tag = `@${userJid.split('@')[0]}`;

  await sock.sendMessage(groupJid, {
    text: `⚠️ *Warning ${count}/${config.warnLimit}* for ${tag}\nReason: ${reason}`,
    mentions: [userJid],
  });

  // Auto-kick on limit
  if (count >= config.warnLimit) {
    await sock.groupParticipantsUpdate(groupJid, [userJid], 'remove');
    await resetWarn(groupJid, userJid);
    await sock.sendMessage(groupJid, {
      text: `🚫 ${tag} has been removed after ${config.warnLimit} warnings.`,
      mentions: [userJid],
    });
  }
}

async function checkAdmin(sock, groupJid, userJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const participant = metadata.participants.find((p) => p.id === userJid);
    return participant?.admin === 'admin' || participant?.admin === 'superadmin';
  } catch {
    return false;
  }
}
