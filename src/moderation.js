// Inside src/moderation.js
// ... (keep existing imports and top-level constants)

export async function handleMessage(sock, msg, config) {
  if (!msg.message || msg.key.fromMe) return;

  const groupJid = msg.key.remoteJid;
  if (!groupJid?.endsWith('@g.us')) return;

  const sender = msg.key.participant;
  const isAdmin = await checkAdmin(sock, groupJid, sender);
  if (isAdmin) return;

  const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    '';

  // --- 1. ANTI-LINK ---
  if (config.toggles.antilink && LINK_REGEX.test(text)) {
    return punish(sock, groupJid, sender, msg, 'Links are not allowed', config);
  }

  // --- 2. ANTI-FORWARD ---
  if (config.toggles.antForward && msg.message.extendedTextMessage?.contextInfo?.isForwarded) {
    return punish(sock, groupJid, sender, msg, 'Forwarded messages are not allowed', config);
  }

  // --- 3. ANTI-STATUS (NEW) ---
  // Checks for group status posts and status mentions
  const context = msg.message.extendedTextMessage?.contextInfo ||
                  msg.message.imageMessage?.contextInfo ||
                  msg.message.videoMessage?.contextInfo ||
                  msg.message.audioMessage?.contextInfo ||
                  {};

  if (context.isGroupStatus || context.isGroupStatusMention || context.isStatusMention) {
    return punish(sock, groupJid, sender, msg, 'Posting or mentioning statuses is not allowed', config);
  }

  // --- 4. NSFW ("SEX DICTATOR") ---
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

  // --- 5. RULES KEYWORD CHECK ---
  for (const rule of config.rules) {
    const keyword = rule.replace(/^No\s+/i, '').trim();
    if (keyword && new RegExp(`\\b${keyword}\\b`, 'i').test(text)) {
      return punish(sock, groupJid, sender, msg, `Violation: ${rule}`, config);
    }
  }
}

// ... (keep punish() and checkAdmin() exactly as before)
