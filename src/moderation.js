import { incrementWarn, resetWarn } from './db.js';
import { isNSFW } from './nsfw.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const LINK_REGEX = /https?:\/\/|wa\.me\/|chat\.whatsapp\.com\//i;
const STATUS_REGEX = /\bstatus\b/i;

export async function handleMessage(sock, msg, config) {
  if (!msg.message || msg.key.fromMe) return;

  const groupJid = msg.key.remoteJid;
  if (!groupJid?.endsWith('@g.us')) return;

  const sender = msg.key.participant;
  const isAdmin = await checkAdmin(sock, groupJid, sender);
  if (isAdmin) return; // Admins are exempt

  const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    '';

  // --- 1. ANTI-LINK ---
  if (config.toggles.antilink && LINK_REGEX.test(text)) {
    return punish(sock, groupJid, sender, msg, 'links are not allowed in this group', config);
  }

  // --- 2. ANTI-FORWARD ---
  if (config.toggles.antForward && msg.message.extendedTextMessage?.contextInfo?.isForwarded) {
    return punish(sock, groupJid, sender, msg, 'forwarded messages are not allowed here', config);
  }

  // --- 3. ANTI-STATUS ---
  const context = msg.message.extendedTextMessage?.contextInfo || msg.message.imageMessage?.contextInfo || msg.message.videoMessage?.contextInfo || {};
  if (context.isGroupStatus || context.isGroupStatusMention || context.isStatusMention || STATUS_REGEX.test(text)) {
    return punish(sock, groupJid, sender, msg, 'you cannot post or mention statuses here', config);
  }

  // --- 4. BAD WORDS FILTER (NEW) ---
  if (config.badWords && config.badWords.length > 0) {
    // Create a regex that matches any bad word (case insensitive, whole words only)
    const badWordRegex = new RegExp(`\\b(${config.badWords.join('|')})\\b`, 'i');
    if (badWordRegex.test(text)) {
      return punish(sock, groupJid, sender, msg, 'you used inappropriate language (bad words)', config);
    }
  }

  // --- 5. NSFW ("SEX DICTATOR") ---
  if (config.toggles.antinsfw && (msg.message.imageMessage || msg.message.videoMessage)) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const mime = msg.message.imageMessage?.mimetype || msg.message.videoMessage?.mimetype;
      const flagged = await isNSFW(buffer, mime);
      if (flagged) {
        return punish(sock, groupJid, sender, msg, 'NSFW or sexual content is strictly forbidden', config);
      }
    } catch (e) {
      console.error('NSFW media download failed:', e.message);
    }
  }
}

// --- HUMAN-LIKE PUNISHMENT SYSTEM ---
async function punish(sock, groupJid, userJid, msg, reason, config) {
  // Delete the offending message
  await sock.sendMessage(groupJid, { delete: msg.key }).catch(() => {});

  const count = await incrementWarn(groupJid, userJid);
  const tag = `@${userJid.split('@')[0]}`;

  // If the user has reached the limit (4), kick them
  if (count >= config.warnLimit) {
    await sock.groupParticipantsUpdate(groupJid, [userJid], 'remove');
    await resetWarn(groupJid, userJid);
    
    // Human-like removal message
    await sock.sendMessage(groupJid, {
      text: `🚫 *Goodbye ${tag}.*\n\nI had to remove you from the group because you reached ${config.warnLimit} warnings. My last warning was because ${reason}. We have to keep this place safe for everyone. 💔`,
      mentions: [userJid],
    });
    return;
  }

  // Human-like warning message
  await sock.sendMessage(groupJid, {
    text: `⚠️ *Hey ${tag}, I had to delete your message.*\n\n*Why?* Because ${reason}. \n\nThis is your *Warning ${count}/${config.warnLimit}*. Please follow the group rules so I don't have to remove you! 🤖🛡️`,
    mentions: [userJid],
  });
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
