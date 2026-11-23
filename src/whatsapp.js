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
let isReady = false; 
const QR_COOLDOWN = 30_000;

export async function initializeWhatsApp(telegramBot, ownerChatId, silent = false) {
  isReady = false; 
  const savedCreds = await loadSession();
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  if (savedCreds) state.creds = savedCreds;

  const { version } = await fetchLatestBaileysVersion();
  
  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'debug' }), 
    printQRInTerminal: false,
    // 🔥 MANDATORY for pair codes to work. Do not change this.
    browser: ['Chrome', 'Windows', '10.0.0'], 
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    await saveSession(sock.authState);
  });

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) isReady = true; 

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
      isReady = true;
      qrRequestPending = false;
      await telegramBot.sendMessage(ownerChatId, '✅ *WhatsApp connected successfully.*', { parse_mode: 'Markdown' });
    }

    if (connection === 'close') {
      isReady = false;
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      
      if (code === DisconnectReason.loggedOut) {
        await telegramBot.sendMessage(ownerChatId, '⚠️ *Logged out.* Send /qr to generate a fresh login.');
      }
      
      setTimeout(() => initializeWhatsApp(telegramBot, ownerChatId, true), 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const config = (await getConfig()) || defaultConfig;
    for (const msg of messages) {
      if (!msg.key.fromMe) await handleMessage(sock, msg, config).catch(console.error);
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    const config = (await getConfig()) || defaultConfig;
    const { id: groupJid, participants, action } = update;
    for (const userJid of participants) {
      const tag = `@${userJid.split('@')[0]}`;
      if (action === 'add' && config.toggles.welcome) {
        await sock.sendMessage(groupJid, { text: config.welcomeMessage.replace('{tag}', tag), mentions: [userJid] });
      }
      if (action === 'remove' && config.toggles.goodbye) {
        await sock.sendMessage(groupJid, { text: config.goodbyeMessage.replace('{tag}', tag), mentions: [userJid] });
      }
    }
  });

  return sock;
}

export function getSock() { return sock; }

export async function requestQR(telegramBot, ownerChatId) {
  const now = Date.now();
  if (now - lastQRRequest < QR_COOLDOWN) return telegramBot.sendMessage(ownerChatId, '⏳ Please wait before requesting again.');
  
  if (qrRequestInFlight) return telegramBot.sendMessage(ownerChatId, '⏳ Generating QR…');
  
  qrRequestInFlight = true;
  lastQRRequest = now;
  
  try {
    await telegramBot.sendMessage(ownerChatId, '🔄 Generating fresh QR...');
    qrRequestPending = true;
    setTimeout(() => { qrRequestPending = false; }, 30_000);
    
    if (!sock) await initializeWhatsApp(telegramBot, ownerChatId, true);
    else {
      await sock.logout().catch(() => {});
      await initializeWhatsApp(telegramBot, ownerChatId, true);
    }
  } finally {
    qrRequestInFlight = false;
  }
}

export async function requestPairCode(telegramBot, ownerChatId, phoneNumber) {
  if (pairRequestInFlight) {
    return telegramBot.sendMessage(ownerChatId, '⏳ Pair request already running.');
  }
  pairRequestInFlight = true;
  
  try {
    if (!sock) {
      await initializeWhatsApp(telegramBot, ownerChatId, true);
    }

    await telegramBot.sendMessage(ownerChatId, '🔄 Booting WhatsApp socket... waiting for ready state.');

    await new Promise((resolve, reject) => {
      let isResolved = false;

      const checkState = () => {
        if (isResolved) return;
        if (sock.ws && sock.ws.isOpen && !sock.authState.creds.registered) {
          isResolved = true;
          return resolve();
        }
      };

      const interval = setInterval(checkState, 1000);

      const timeout = setTimeout(() => {
        clearInterval(interval);
        if (!isResolved) {
          isResolved = true;
          reject(new Error('WhatsApp took too long to respond. Render might be asleep. Try /reset then /pair again.'));
        }
      }, 25000);

      sock.ev.once('connection.update', (update) => {
        if (update.qr || update.connection === 'connecting') {
          clearInterval(interval);
          clearTimeout(timeout);
          if (!isResolved) {
            isResolved = true;
            resolve();
          }
        }
      });
    });

    await new Promise(r => setTimeout(r, 2000));

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
