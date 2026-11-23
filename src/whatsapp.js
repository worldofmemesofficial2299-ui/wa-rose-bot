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
import { defaultConfig } from './config.js';

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
    // 🔥 CHANGED: Use 'debug' to see exactly why it's failing in Render logs
    logger: pino({ level: 'debug' }), 
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    await saveSession(sock.authState);
  });

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;

    // Log the update so we can see it in Render logs
    console.log('Connection Update:', connection);

    if (qr && qrRequestPending) {
      qrRequestPending = false;
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
      
      // 🔥 FIX: If logged out, delete the session so a new QR can be generated
      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out. Clearing session...');
        await telegramBot.sendMessage(ownerChatId, '⚠️ *Logged out.* Send /qr to generate a fresh login.');
        // Force a restart of the socket
        setTimeout(() => initializeWhatsApp(telegramBot, ownerChatId, true), 2000);
      } else {
        console.log('Connection closed, reconnecting...');
        setTimeout(() => initializeWhatsApp(telegramBot, ownerChatId, true), 5000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const config = (await getConfig()) || defaultConfig;
    for (const msg of messages) {
      if (!msg.key.fromMe) {
        await handleMessage(sock, msg, config).catch(console.error);
      }
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    const config = (await getConfig()) || defaultConfig;
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
    const wait = Math.ceil((QR_COOLDOWN - (now - lastQRRequest)) / 1000);
    await telegramBot.sendMessage(ownerChatId, `⏳ Wait ${wait}s before requesting another QR.`);
    return;
  }
  if (qrRequestInFlight) {
    await telegramBot.sendMessage(ownerChatId, '⏳ Generating QR…');
    return;
  }
  
  qrRequestInFlight = true;
  lastQRRequest = now;
  
  try {
    await telegramBot.sendMessage(ownerChatId, '🔄 Generating fresh QR...');
    qrRequestPending = true;
    
    // Auto-reset the flag after 30s if nothing happens
    setTimeout(() => { qrRequestPending = false; }, 30_000);
    
    if (!sock) {
      await initializeWhatsApp(telegramBot, ownerChatId, true);
    } else {
      // Force close and restart to get a fresh QR
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
    if (!sock) {
      await initializeWhatsApp(telegramBot, ownerChatId, true);
    }

    await telegramBot.sendMessage(ownerChatId, '🔄 Waiting for WhatsApp connection...');
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timed out. Please try /qr instead.')), 20000);
      
      // Check if already ready
      if (sock.authState.creds.registered || (sock.ws && sock.ws.isOpen)) {
        clearTimeout(timeout);
        return resolve();
      }
      
      // 🔥 FIX: Wait for "connecting" or "open"
      sock.ev.once('connection.update', (update) => {
        if (update.connection === 'open' || update.connection === 'connecting' || update.qr) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const cleanNumber = phoneNumber.replace(/\D/g, '');
    const code = await sock.requestPairingCode(cleanNumber);
    
    await telegramBot.sendMessage(
      ownerChatId,
      `🔑 *Your Pair Code*\n\n\`${code.slice(0, 4)}-${code.slice(4)}\`\n\n⏱ Valid ~60s.\n📱 WhatsApp → Linked Devices → Link with Phone Number.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    await telegramBot.sendMessage(ownerChatId, `❌ Pair failed: ${e.message}`);
  } finally {
    pairRequestInFlight = false;
  }
}
