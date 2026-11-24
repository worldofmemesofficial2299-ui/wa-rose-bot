import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import { saveSession, loadSession, getConfig } from './db.js';
import { handleMessage } from './moderation.js';
import { defaultConfig } from './config.js';

// 🔥 CRITICAL FIX: Monkey-patch to fix the Baileys 6.x Platform ID bug
// This stops WhatsApp from rejecting the pair code with "Couldn't link device"
import * as generics from '@whiskeysockets/baileys/lib/Utils/generics.js';
generics.getPlatformId = (browser) => {
  const platformType = proto.DeviceProps.PlatformType[browser.toUpperCase()];
  return platformType ? platformType.toString() : '1';
};

let sock;
let qrRequestPending = false;
let pairRequestInFlight = false;
let qrRequestInFlight = false;
let lastQRRequest = 0;
let isReady = false; 
let pairingReady = false; // Tracks if server is ready for pair code
const QR_COOLDOWN = 30_000;

export async function initializeWhatsApp(telegramBot, ownerChatId, silent = false) {
  isReady = false; 
  pairingReady = false;
  
  const savedCreds = await loadSession();
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  if (savedCreds) state.creds = savedCreds;

  const { version } = await fetchLatestBaileysVersion();
  
  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // Silent to prevent log spam
    printQRInTerminal: false,
    // 🔥 Use a trusted, canonical browser signature
    browser: ['Mac OS', 'Chrome', '121.0.0'], 
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    await saveSession(sock.authState);
  });

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      isReady = true; 
      // Some versions of Baileys fire pairing ready when QR is generated
      if (!pairingReady && sock.authState.creds.registered === false) {
          pairingReady = true;
      }
    }

    if (connection === 'connecting') {
      pairingReady = true;
    }

    if (qr && qrRequestPending) {
      qrRequestPending = false;
      try {
        const buffer = await QRCode.toBuffer(qr, { scale: 8 });
        await telegramBot.telegram.sendPhoto(ownerChatId, buffer, {
          caption: '📸 *Scan this QR code*\n\n⏱ Valid ~60s.\n_If it expires, send /qr again._',
          parse_mode: 'Markdown',
        });
      } catch (e) {
        await telegramBot.telegram.sendMessage(ownerChatId, `❌ QR send failed: ${e.message}`);
      }
    }

    if (connection === 'open') {
      isReady = true;
      pairingReady = true;
      qrRequestPending = false;
      await telegramBot.telegram.sendMessage(ownerChatId, '✅ *WhatsApp connected successfully.*', { parse_mode: 'Markdown' });
    }

    if (connection === 'close') {
      isReady = false;
      pairingReady = false;
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      
      if (code === DisconnectReason.loggedOut) {
        await telegramBot.telegram.sendMessage(ownerChatId, '⚠️ *Logged out.* Send /qr to generate a fresh login.');
      }
      
      setTimeout(() => initializeWhatsApp(telegramBot, ownerChatId, true), 5000);
    }
  });

  // Internal listener for pair-device readiness (strict mode)
  sock.ev.on('connection.update', (update) => {
      if (update.isNewLogin) {
          pairingReady = true;
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
  if (now - lastQRRequest < QR_COOLDOWN) return telegramBot.telegram.sendMessage(ownerChatId, '⏳ Please wait before requesting again.');
  if (qrRequestInFlight) return telegramBot.telegram.sendMessage(ownerChatId, '⏳ Generating QR…');
  
  qrRequestInFlight = true;
  lastQRRequest = now;
  
  try {
    await telegramBot.telegram.sendMessage(ownerChatId, '🔄 Generating fresh QR...');
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
  if (pairRequestInFlight) return telegramBot.telegram.sendMessage(ownerChatId, '⏳ Pair request already running.');
  pairRequestInFlight = true;
  
  try {
    if (!sock) await initializeWhatsApp(telegramBot, ownerChatId, true);
    await telegramBot.telegram.sendMessage(ownerChatId, '🔄 Booting WhatsApp socket... waiting for server readiness.');

    // 🔥 STRICT READY GATE: Wait for the server to signal it's ready before requesting
    await new Promise((resolve, reject) => {
      let isResolved = false;
      const timeout = setTimeout(() => {
          if (!isResolved) reject(new Error('Connection timed out. Try /qr instead.'));
      }, 30000);
      
      const check = () => {
          if (pairingReady || (sock.ws && sock.ws.isOpen && !sock.authState.creds.registered)) {
              clearTimeout(timeout);
              isResolved = true;
              resolve();
          }
      };
      
      const interval = setInterval(check, 1000);
      
      // Cleanup on timeout or resolve
      setTimeout(() => clearInterval(interval), 30000);
    });

    await new Promise(r => setTimeout(r, 1500));

    const cleanNumber = phoneNumber.replace(/\D/g, '');
    const code = await sock.requestPairingCode(cleanNumber);
    
    await telegramBot.telegram.sendMessage(
      ownerChatId,
      `🔑 *Your Pair Code*\n\n\`${code.slice(0, 4)}-${code.slice(4)}\`\n\n⏱ Valid ~60s.\n📱 WhatsApp → Linked Devices → Link with Phone Number.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    await telegramBot.telegram.sendMessage(ownerChatId, `❌ Pair failed: ${e.message}`);
  } finally {
    pairRequestInFlight = false;
  }
                                                                                 }
