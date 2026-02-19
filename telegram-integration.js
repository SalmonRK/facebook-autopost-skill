#!/usr/bin/env node
/**
 * Telegram to Facebook Auto-Poster Integration
 * Monitors Telegram groups and queues content for Facebook posting
 */

const { addToQueue } = require('./index.js');

/**
 * Process incoming Telegram message and add to queue
 * @param {Object} message - Telegram message object
 * @param {string} sourceChat - Source chat ID or name
 */
function processTelegramMessage(message, sourceChat) {
  // Skip if no content
  if (!message.text && !message.caption && !message.photo) {
    console.log('Skipping: No content');
    return null;
  }
  
  // Extract content
  const text = message.text || message.caption || '';
  
  // Check for skip patterns
  const skipPatterns = ['#skip', '#draft', '#ignore'];
  if (skipPatterns.some(pattern => text.toLowerCase().includes(pattern))) {
    console.log('Skipping: Contains skip pattern');
    return null;
  }
  
  // Determine media type
  let mediaUrl = null;
  let mediaType = 'text';
  let telegramFileId = null;
  
  if (message.photo && message.photo.length > 0) {
    // Get the largest photo
    const largestPhoto = message.photo[message.photo.length - 1];
    telegramFileId = largestPhoto.file_id;
    mediaUrl = largestPhoto.file_id; // Store file_id for reference
    mediaType = 'image';
  }
  
  // Add to queue
  const item = addToQueue({
    source: sourceChat,
    text: text,
    mediaUrl: mediaUrl,
    mediaType: mediaType,
    telegramFileId: telegramFileId
  });
  
  console.log(`Queued: ${item.id} (${mediaType})`);
  return item;
}

/**
 * Test Facebook connection
 */
async function testFacebookConnection() {
  const config = require('./config.json').settings;
  const { page_id, access_token, api_version } = config.facebook;
  
  try {
    const response = await fetch(`https://graph.facebook.com/${api_version}/${page_id}?access_token=${access_token}&fields=name,id`);
    const data = await response.json();
    
    if (data.error) {
      console.error('Facebook API Error:', data.error.message);
      return false;
    }
    
    console.log('✅ Facebook connection successful');
    console.log(`   Page: ${data.name} (${data.id})`);
    return true;
  } catch (error) {
    console.error('❌ Facebook connection failed:', error.message);
    return false;
  }
}

// CLI
const command = process.argv[2];

switch (command) {
  case 'test':
    testFacebookConnection().then(success => {
      process.exit(success ? 0 : 1);
    });
    break;
    
  case 'process-message':
    const messageJson = process.argv[3];
    const sourceChat = process.argv[4] || 'unknown';
    const message = JSON.parse(messageJson);
    processTelegramMessage(message, sourceChat);
    break;
    
  default:
    console.log(`
Telegram-Facebook Integration

Usage:
  node telegram-integration.js test                    Test Facebook connection
  node telegram-integration.js process-message '<json>' <source>  Process Telegram message
    `);
}

module.exports = { processTelegramMessage, testFacebookConnection };
