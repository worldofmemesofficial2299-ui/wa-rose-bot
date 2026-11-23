import 'dotenv/config';
import express from 'express';
import { connectDB } from './db.js';
import { startTelegram } from './telegram.js';
import { initializeWhatsApp } from './whatsapp.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Health endpoint for keep-alive pings
app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/', (req, res) => res.status(200).send('WA Rose Bot is running'));

app.listen(PORT, () => console.log(`🌐 Web server on port ${PORT}`));

async function main() {
  await connectDB(process.env.MONGODB_URI);

  const ownerChatId = parseInt(process.env.TELEGRAM_OWNER_ID);
  const telegramBot = startTelegram(process.env.TELEGRAM_BOT_TOKEN, ownerChatId);

  // Start WhatsApp silently — no QR flood on boot
  initializeWhatsApp(telegramBot, ownerChatId, true);
}

main().catch(console.error);
