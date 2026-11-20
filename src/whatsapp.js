import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import { saveSession, loadSession, getConfig } from './db.js';
import { handleMessage } from './moderation.js';

let sock;
let qrRequestPending = false;
let pairRequestInFlight = false;
let qrRequestInFlight = false;
let lastQRRequest = 0;
const QR_COOLDOWN = 30_000;

export async function initializeWhatsApp(telegramBot, ownerChatId, silent = false) {
  const savedCreds = await loadSession();
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  if (savedCreds) state.creds = savedCreds;

  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    await saveSession(sock.authState);
  });

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;

    // ONE-SHOT QR: only send if user asked
    if (qr && qrRequestPending) {
      qrRequestPending = false; // consume — no flood
      try {
        const buffer = await QRCode.toBuffer(qr, { scale: 8 });
        await telegramBot.sendPhoto(ownerChatId, buffer, {
          caption: '📸 *Scan this QR code*\n\n⏱ Valid ~60s.\n_If it expires, send /qr again._',
          parse_mode: 'Markdown',
        });
      } catch (e) {
        await telegramBot.sendMessage(ownerChatId, `❌ QR send failed: ${e.message}`);
      }
    }

    if (connection === 'open') {
      qrRequestPending = false;
      await telegramBot.sendMessage(ownerChatId, '✅ *WhatsApp connected successfully.*', { parse_mode: 'Markdown' });
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => initializeWhatsApp(telegramBot, ownerChatId, true), 5000);
      }
    }
  });

  // Message handler
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const config = (await getConfig()) || (await import('./config.js')).defaultConfig;
    for (const msg of messages) {
      await handleMessage(sock, msg, config);
    }
  });

  // Welcome / Goodbye
  sock.ev.on('group-participants.update', async (update) => {
    const config = (await getConfig()) || (await import('./config.js')).defaultConfig;
    const { id: groupJid, participants, action } = update;

    for (const userJid of participants) {
      const tag = `@${userJid.split('@')[0]}`;
      if (action === 'add' && config.toggles.welcome) {
        const text = config.welcomeMessage.replace('{tag}', tag);
        await sock.sendMessage(groupJid, { text, mentions: [userJid] });
      }
      if (action === 'remove' && config.toggles.goodbye) {
        const text = config.goodbyeMessage.replace('{tag}', tag);
        await sock.sendMessage(groupJid, { text, mentions: [userJid] });
      }
    }
  });

  return sock;
}

export function getSock() { return sock; }

export async function requestQR(telegramBot, ownerChatId) {
  const now = Date.now();
  if (now - lastQRRequest < QR_COOLDOWN) {
    await telegramBot.sendMessage(ownerChatId, `⏳ Wait ${Math.ceil((QR_COOLDOWN - (now - lastQRRequest)) / 1000)}s.`);
    return;
  }
  if (qrRequestInFlight) {
    await telegramBot.sendMessage(ownerChatId, '⏳ Generating QR…');
    return;
  }
  qrRequestInFlight = true;
  lastQRRequest = now;
  try {
    await telegramBot.sendMessage(ownerChatId, '🔄 Generating fresh QR…');
    qrRequestPending = true;
    setTimeout(() => { qrRequestPending = false; }, 30_000); // auto-reset
    if (!sock) {
      await initializeWhatsApp(telegramBot, ownerChatId, true);
    } else {
      await sock.logout().catch(() => {});
      await initializeWhatsApp(telegramBot, ownerChatId, true);
    }
  } finally {
    qrRequestInFlight = false;
  }
}

export async function requestPairCode(telegramBot, ownerChatId, phoneNumber) {
  if (pairRequestInFlight) {
    await telegramBot.sendMessage(ownerChatId, '⏳ Pair request already running.');
    return;
  }
  pairRequestInFlight = true;
  try {
    if (!sock) await initializeWhatsApp(telegramBot, ownerChatId, true);
    const code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ''));
    await telegramBot.sendMessage(
      ownerChatId,
      `🔑 *Your Pair Code*\n\n\`${code.slice(0, 4)}-${code.slice(4)}\`\n\n⏱ Valid ~60s.\nWhatsApp → Linked Devices → Link with Phone Number.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    await telegramBot.sendMessage(ownerChatId, `❌ Pair failed: ${e.message}`);
  } finally {
    pairRequestInFlight = false;
  }
             }
