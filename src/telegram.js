import { Telegraf, Markup } from 'telegraf';
import { getConfig, setConfig } from './db.js';
import { requestQR, requestPairCode, getSock } from './whatsapp.js';
import { defaultConfig } from './config.js';

export function startTelegram(botToken, ownerChatId) {
  const bot = new Telegraf(botToken);

  // Auth guard
  bot.use((ctx, next) => {
    if (ctx.chat?.id !== ownerChatId) {
      return ctx.reply('⛔ Unauthorized. This bot is private.');
    }
    return next();
  });

  // --- MAIN MENU WITH BUTTONS ---
  const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('📱 Pairing', 'menu_pairing'), Markup.button.callback('⚙️ Settings', 'menu_settings')],
    [Markup.button.callback('🛡️ Toggles', 'menu_toggles'), Markup.button.callback('📊 Status', 'menu_status')]
  ]);

  bot.start((ctx) => {
    const welcomeText = `
🌟 <b>Guardian Bot Control Panel</b> 🌟

Welcome to your WhatsApp group manager. 
Use the buttons below to control your bot without typing commands.

👇 <b>Select an option below:</b>
    `;
    ctx.replyWithHTML(welcomeText, mainMenu);
  });

  // --- BUTTON HANDLERS ---
  bot.action('menu_pairing', (ctx) => {
    ctx.editMessageText(
      '📱 <b>Pairing Menu</b>\n\nUse these commands in the chat:\n\n<code>/qr</code> - Generate a QR code\n<code>/pair 2348012345678</code> - Get a Pair Code',
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'main_menu')]]) }
    );
  });

  bot.action('menu_settings', (ctx) => {
    ctx.editMessageText(
      '⚙️ <b>Settings Menu</b>\n\nUpdate your bot via chat:\n\n<code>/setwelcome Your text {tag}</code>\n<code>/setgoodbye Your text {tag}</code>\n<code>/setrules No links, No spam, Be nice</code>',
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'main_menu')]]) }
    );
  });

  bot.action('menu_toggles', async (ctx) => {
    const config = (await getConfig()) || defaultConfig;
    const text = `
🛡️ <b>Feature Toggles</b>

Current status of your bot features.
Use <code>/toggle feature_name</code> in chat to flip them.

Anti-Link: ${config.toggles.antilink ? '✅' : '❌'}
Anti-Forward: ${config.toggles.antForward ? '✅' : '❌'}
Anti-NSFW: ${config.toggles.antinsfw ? '✅' : '❌'}
Anti-Spam: ${config.toggles.antispam ? '✅' : '❌'}
Welcome: ${config.toggles.welcome ? '✅' : '❌'}
Goodbye: ${config.toggles.goodbye ? '✅' : '❌'}
    `;
    ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'main_menu')]]) });
  });

  bot.action('menu_status', (ctx) => {
    const s = getSock();
    const connected = s?.user ? `✅ Connected as ${s.user.id.split(':')[0]}` : '❌ Not connected';
    ctx.editMessageText(`📊 <b>Bot Status</b>\n\nWhatsApp: ${connected}`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'main_menu')]]) });
  });

  bot.action('main_menu', (ctx) => {
    ctx.deleteMessage();
    bot.telegram.sendMessage(ctx.chat.id, '🌟 <b>Main Menu</b>\nSelect an option:', { parse_mode: 'HTML', ...mainMenu });
  });


  // --- TEXT COMMANDS ---
  bot.command('qr', (ctx) => requestQR(bot, ownerChatId));
  bot.command('pair', (ctx) => {
    const phone = ctx.message.text.split(' ')[1];
    if (!phone) return ctx.reply('Usage: /pair 2348012345678');
    return requestPairCode(bot, ownerChatId, phone);
  });

  bot.command('toggle', async (ctx) => {
    const feature = ctx.message.text.split(' ')[1];
    const config = (await getConfig()) || defaultConfig;
    if (config.toggles[feature] === undefined) return ctx.reply('Unknown feature.');
    config.toggles[feature] = !config.toggles[feature];
    await setConfig(config);
    ctx.reply(`✅ ${feature} is now ${config.toggles[feature] ? 'ON' : 'OFF'}`);
  });

  bot.command('setwelcome', async (ctx) => {
    const text = ctx.message.text.replace('/setwelcome ', '');
    if (!text) return ctx.reply('Provide text with {tag} placeholder.');
    const config = (await getConfig()) || defaultConfig;
    config.welcomeMessage = text;
    await setConfig(config);
    ctx.reply('✅ Welcome message updated.');
  });

  bot.command('setgoodbye', async (ctx) => {
    const text = ctx.message.text.replace('/setgoodbye ', '');
    if (!text) return ctx.reply('Provide text with {tag} placeholder.');
    const config = (await getConfig()) || defaultConfig;
    config.goodbyeMessage = text;
    await setConfig(config);
    ctx.reply('✅ Goodbye message updated.');
  });

  bot.command('setrules', async (ctx) => {
    const rules = ctx.message.text.replace('/setrules ', '').split(',').map((r) => r.trim());
    if (!rules.length) return ctx.reply('Provide comma-separated rules.');
    const config = (await getConfig()) || defaultConfig;
    config.rules = rules;
    await setConfig(config);
    ctx.reply(`✅ ${rules.length} rules saved.`);
  });

  bot.command('status', (ctx) => {
    const s = getSock();
    const connected = s?.user ? `✅ Connected as ${s.user.id.split(':')[0]}` : '❌ Not connected';
    ctx.reply(`<b>Bot Status</b>\n\nWhatsApp: ${connected}`, { parse_mode: 'HTML' });
  });

  bot.launch();
  return bot;
                        }
