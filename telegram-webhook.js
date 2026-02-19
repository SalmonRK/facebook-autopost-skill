#!/usr/bin/env node
/**
 * Telegram Webhook Handler for Facebook Auto-Post
 * Receives messages from Telegram and queues them for Facebook
 */

const { addToQueue } = require('./index.js');
const config = require('./config.json').settings;

// Process incoming webhook from Telegram
function processTelegramWebhook(update) {
  console.log('Received Telegram update:', JSON.stringify(update, null, 2));
  
  // Check if it's a message
  if (!update.message) {
    console.log('No message in update');
    return { ok: false, reason: 'no_message' };
  }
  
  const message = update.message;
  const chatId = message.chat.id.toString();
  const chatTitle = message.chat.title || message.chat.username || chatId;
  
  // Check if this chat is in allowed sources
  const allowedSources = config.telegram_sources || [];
  const isAllowed = allowedSources.some(source => 
    chatId === source || 
    chatTitle === source ||
    message.chat.username === source
  );
  
  if (!isAllowed) {
    console.log(`Chat ${chatTitle} (${chatId}) not in allowed list`);
    return { ok: false, reason: 'not_allowed', chat: chatTitle };
  }
  
  // Extract content
  const text = message.text || message.caption || '';
  
  // Check for skip patterns
  const skipPatterns = ['#skip', '#draft', '#ignore'];
  if (skipPatterns.some(pattern => text.toLowerCase().includes(pattern))) {
    console.log('Skipping: Contains skip pattern');
    return { ok: false, reason: 'skipped' };
  }
  
  // Determine media type and get file_id
  let mediaUrl = null;
  let mediaType = 'text';
  let telegramFileId = null;
  
  if (message.photo && message.photo.length > 0) {
    // Get the largest photo (last one in array)
    const largestPhoto = message.photo[message.photo.length - 1];
    telegramFileId = largestPhoto.file_id;
    mediaType = 'image';
    console.log(`Found image with file_id: ${telegramFileId}`);
  }
  
  // Add to queue
  const item = addToQueue({
    source: chatTitle,
    text: text,
    mediaUrl: telegramFileId, // Store file_id as reference
    mediaType: mediaType,
    telegramFileId: telegramFileId
  });
  
  console.log(`Queued item ${item.id} from ${chatTitle}`);
  
  return { 
    ok: true, 
    itemId: item.id,
    mediaType: mediaType,
    scheduledFor: item.scheduledFor
  };
}

// CLI for testing
const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case 'test':
    // Test with sample data
    const testUpdate = {
      message: {
        chat: {
          id: -1003720605580,
          title: 'AI-Media'
        },
        text: 'Test message'
      }
    };
    const result = processTelegramWebhook(testUpdate);
    console.log('Result:', result);
    break;
    
  case 'process':
    // Process actual webhook data
    try {
      const update = JSON.parse(arg);
      const result = processTelegramWebhook(update);
      console.log(JSON.stringify(result));
    } catch (e) {
      console.error('Error:', e.message);
      process.exit(1);
    }
    break;
    
  default:
    console.log(`
Telegram Webhook Handler

Usage:
  node telegram-webhook.js test              Test with sample data
  node telegram-webhook.js process '<json>'  Process webhook JSON

To set up webhook:
  curl -F "url=https://YOUR_SERVER/webhook" \
    https://api.telegram.org/bot<TOKEN>/setWebhook
    `);
}

module.exports = { processTelegramWebhook };
