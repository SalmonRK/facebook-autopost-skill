#!/usr/bin/env node
/**
 * Facebook Auto-Poster Skill
 * Cross-posts content from Telegram groups to Facebook Page with scheduling
 * Supports text and image (downloaded from Telegram)
 * 
 * Features:
 * - DRY_RUN mode for testing
 * - Duplicate content guard
 * - Rate limiting
 * - Input validation
 * - Health check endpoint
 * - Separate error logging
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const QUEUE_PATH = path.join(__dirname, 'queue.json');
const LOG_PATH = path.join(__dirname, 'posts.log');
const ERROR_LOG_PATH = path.join(__dirname, 'logs', 'error.log');
const TEMP_DIR = path.join(__dirname, 'temp');
const LOGS_DIR = path.join(__dirname, 'logs');

// Rate limiting state
const rateLimiter = {
  lastPostTime: 0,
  minInterval: 60000 // 60 seconds between posts
};

// Ensure directories exist
[LOGS_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Load configuration with environment variable support
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      throw new Error('config.json not found. Please copy config.template.json to config.json');
    }
    
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    
    // Replace environment variable placeholders
    function replaceEnvVars(obj) {
      for (const key in obj) {
        if (typeof obj[key] === 'string' && obj[key].startsWith('${') && obj[key].endsWith('}')) {
          const envVar = obj[key].slice(2, -1);
          obj[key] = process.env[envVar] || obj[key];
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          replaceEnvVars(obj[key]);
        }
      }
    }
    
    replaceEnvVars(config);
    
    // Override with direct environment variables if available
    if (process.env.FACEBOOK_PAGE_ID) {
      config.settings.facebook.page_id = process.env.FACEBOOK_PAGE_ID;
    }
    if (process.env.FACEBOOK_ACCESS_TOKEN) {
      config.settings.facebook.access_token = process.env.FACEBOOK_ACCESS_TOKEN;
    }
    if (process.env.TELEGRAM_BOT_TOKEN) {
      config.settings.telegram.bot_token = process.env.TELEGRAM_BOT_TOKEN;
    }
    if (process.env.DRY_RUN) {
      config.settings.dry_run = process.env.DRY_RUN === 'true';
    }
    
    return config;
  } catch (e) {
    console.error('Failed to load config:', e.message);
    console.error('Please copy config.template.json to config.json and fill in your credentials');
    console.error('Or set environment variables: FACEBOOK_PAGE_ID, FACEBOOK_ACCESS_TOKEN, TELEGRAM_BOT_TOKEN');
    process.exit(1);
  }
}

// Load or initialize queue
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load queue:', e.message);
  }
  return { pending: [], posted: [], lastPostTime: null, postedHashes: [] };
}

// Save queue
function saveQueue(queue) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

// Log activity
function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
  fs.appendFileSync(LOG_PATH, entry);
  console.log(entry.trim());
}

// Log error separately
function logError(message, error) {
  const timestamp = new Date().toISOString();
  const errorEntry = `[${timestamp}] ERROR: ${message}\n`;
  const stackEntry = error ? `[${timestamp}] STACK: ${error.stack || error}\n` : '';
  
  fs.appendFileSync(ERROR_LOG_PATH, errorEntry + stackEntry);
  console.error(errorEntry.trim());
}

// Generate content hash for duplicate detection
function generateContentHash(text, mediaType = 'text') {
  const content = `${text}:${mediaType}`;
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

// Check for duplicate content
function isDuplicateContent(queue, hash) {
  if (!queue.postedHashes) {
    queue.postedHashes = [];
  }
  return queue.postedHashes.includes(hash);
}

// Validate input
function validateInput(item) {
  const errors = [];
  
  // Validate text content
  if (!item.text || typeof item.text !== 'string') {
    errors.push('Text content is required and must be a string');
  } else if (item.text.length > 2200) {
    errors.push('Text exceeds Facebook limit of 2200 characters');
  }
  
  // Validate media type
  const validMediaTypes = ['text', 'image'];
  if (item.mediaType && !validMediaTypes.includes(item.mediaType)) {
    errors.push(`Invalid media type. Must be one of: ${validMediaTypes.join(', ')}`);
  }
  
  // Validate image URL if provided
  if (item.mediaUrl && item.mediaType === 'image') {
    const urlPattern = /^(https?:\/\/|file:\/\/|\/).+\.(jpg|jpeg|png|gif|webp)$/i;
    if (!urlPattern.test(item.mediaUrl) && !item.telegramFileId) {
      errors.push('Invalid image URL format or unsupported image type');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// Validate configuration
function validateConfig(config) {
  const errors = [];
  const fb = config?.settings?.facebook;
  const tg = config?.settings?.telegram;
  
  if (!fb?.page_id || fb.page_id === '${FACEBOOK_PAGE_ID}' || fb.page_id === 'YOUR_PAGE_ID') {
    errors.push('Facebook Page ID is required');
  }
  
  if (!fb?.access_token || fb.access_token.includes('YOUR_')) {
    errors.push('Facebook Access Token is required');
  }
  
  if (!tg?.bot_token || tg.bot_token.includes('YOUR_')) {
    errors.push('Telegram Bot Token is required for image downloads');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// Check rate limit
function checkRateLimit() {
  const now = Date.now();
  const timeSinceLastPost = now - rateLimiter.lastPostTime;
  
  if (timeSinceLastPost < rateLimiter.minInterval) {
    const waitTime = Math.ceil((rateLimiter.minInterval - timeSinceLastPost) / 1000);
    return {
      allowed: false,
      waitTime,
      message: `Rate limit exceeded. Please wait ${waitTime} seconds before next post.`
    };
  }
  
  return { allowed: true };
}

// Update rate limit
function updateRateLimit() {
  rateLimiter.lastPostTime = Date.now();
}

// Download file from Telegram
async function downloadTelegramFile(fileId, botToken) {
  try {
    // Step 1: Get file path from Telegram
    const fileInfoResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );
    const fileInfo = await fileInfoResponse.json();
    
    if (!fileInfo.ok || !fileInfo.result) {
      throw new Error('Failed to get file info from Telegram');
    }
    
    const filePath = fileInfo.result.file_path;
    const fileName = path.basename(filePath);
    const localPath = path.join(TEMP_DIR, `${Date.now()}_${fileName}`);
    
    // Step 2: Download the file
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const fileResponse = await fetch(fileUrl);
    
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file: ${fileResponse.status}`);
    }
    
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    fs.writeFileSync(localPath, buffer);
    
    log(`Downloaded Telegram file: ${fileName} (${buffer.length} bytes)`);
    
    return localPath;
  } catch (error) {
    throw new Error(`Telegram download failed: ${error.message}`);
  }
}

// Clean up temp file
function cleanupTempFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log(`Cleaned up temp file: ${filePath}`);
    }
  } catch (error) {
    logError('Failed to cleanup temp file', error);
  }
}

// Add content to queue (called when new Telegram message arrives)
function addToQueue(content) {
  // Validate input first
  const validation = validateInput(content);
  if (!validation.valid) {
    log(`Validation failed: ${validation.errors.join(', ')}`, 'warn');
    return { success: false, errors: validation.errors };
  }
  
  const queue = loadQueue();
  
  // Generate content hash for duplicate detection
  const contentHash = generateContentHash(content.text, content.mediaType);
  
  // Check for duplicates
  if (isDuplicateContent(queue, contentHash)) {
    log(`Duplicate content detected, skipping: ${content.text.substring(0, 50)}...`, 'warn');
    return { success: false, reason: 'duplicate' };
  }
  
  const item = {
    id: Date.now().toString(),
    source: content.source,
    text: content.text,
    mediaUrl: content.mediaUrl || null,
    mediaType: content.mediaType || 'text',
    telegramFileId: content.telegramFileId || null,
    contentHash: contentHash,
    addedAt: new Date().toISOString(),
    scheduledFor: null,
    status: 'pending'
  };
  
  queue.pending.push(item);
  saveQueue(queue);
  
  log(`Added to queue: ${item.id} (${item.mediaType}) [hash: ${contentHash}]`);
  
  // Schedule next posts
  schedulePosts();
  
  return { success: true, item };
}

// Calculate next schedule time
function getNextScheduleTime(config) {
  const now = new Date();
  const times = config.settings.schedule.post_times;
  const timezone = config.settings.schedule.timezone || 'Asia/Bangkok';
  
  // Convert current time to target timezone
  const tzNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const currentHour = tzNow.getHours();
  const currentMinute = tzNow.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;
  
  // Find next available slot
  for (const timeStr of times) {
    const [hour, minute] = timeStr.split(':').map(Number);
    const slotTime = hour * 60 + minute;
    
    if (slotTime > currentTime) {
      // This slot is today
      const scheduled = new Date(tzNow);
      scheduled.setHours(hour, minute, 0, 0);
      return scheduled.toISOString();
    }
  }
  
  // All slots passed, use first slot tomorrow
  const [firstHour, firstMinute] = times[0].split(':').map(Number);
  const tomorrow = new Date(tzNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(firstHour, firstMinute, 0, 0);
  
  return tomorrow.toISOString();
}

// Schedule pending posts
function schedulePosts() {
  const config = loadConfig();
  const queue = loadQueue();
  
  // Get unscheduled items
  const unscheduled = queue.pending.filter(item => !item.scheduledFor);
  
  if (unscheduled.length === 0) return;
  
  // Schedule up to posts_per_day
  const postsPerDay = config.settings.schedule.posts_per_day || 2;
  const toSchedule = unscheduled.slice(0, postsPerDay);
  
  for (const item of toSchedule) {
    item.scheduledFor = getNextScheduleTime(config);
    log(`Scheduled ${item.id} for ${item.scheduledFor}`);
  }
  
  saveQueue(queue);
}

// Create multipart form data for Facebook upload
function createMultipartFormData(fields, filePath, fileFieldName) {
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const chunks = [];
  
  // Add form fields
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
    chunks.push(Buffer.from(`${value}\r\n`));
  }
  
  // Add file
  if (filePath && fs.existsSync(filePath)) {
    const fileName = path.basename(filePath);
    const fileData = fs.readFileSync(filePath);
    const mimeType = 'image/jpeg'; // Default, can be improved
    
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"\r\n`));
    chunks.push(Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`));
    chunks.push(fileData);
    chunks.push(Buffer.from(`\r\n`));
  }
  
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  
  return {
    body: Buffer.concat(chunks),
    boundary: boundary
  };
}

// Post to Facebook
async function postToFacebook(item, config) {
  // Check if DRY_RUN mode
  const isDryRun = config.settings.dry_run === true;
  
  // Validate config
  const configValidation = validateConfig(config);
  if (!configValidation.valid) {
    throw new Error(`Configuration error: ${configValidation.errors.join(', ')}`);
  }
  
  // Check rate limit
  const rateLimitCheck = checkRateLimit();
  if (!rateLimitCheck.allowed) {
    throw new Error(rateLimitCheck.message);
  }
  
  const { page_id, access_token, api_version } = config.settings.facebook;
  const botToken = config.settings.telegram?.bot_token;
  
  const baseUrl = `https://graph.facebook.com/${api_version}`;
  let tempFilePath = null;
  
  try {
    if (isDryRun) {
      log(`[DRY RUN] Would post: ${item.text.substring(0, 100)}...`, 'dryrun');
      return { id: 'dry-run-' + Date.now(), dryRun: true };
    }
    
    let response;
    
    if (item.mediaType === 'image') {
      // Handle image upload
      let imagePath = item.mediaUrl;
      
      // If it's a Telegram file_id, download it first
      if (item.telegramFileId && botToken) {
        imagePath = await downloadTelegramFile(item.telegramFileId, botToken);
        tempFilePath = imagePath;
      }
      
      // Check if it's a local file path (downloaded from Telegram)
      if (imagePath && fs.existsSync(imagePath)) {
        // Upload via multipart form-data
        const formData = createMultipartFormData({
          caption: item.text || '',
          published: 'true',
          access_token: access_token
        }, imagePath, 'file');
        
        response = await fetch(`${baseUrl}/${page_id}/photos`, {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${formData.boundary}`
          },
          body: formData.body
        });
      } else if (imagePath) {
        // Use URL-based upload for public URLs
        const photoData = new URLSearchParams({
          url: imagePath,
          caption: item.text || '',
          published: 'true',
          access_token: access_token
        });
        
        response = await fetch(`${baseUrl}/${page_id}/photos`, {
          method: 'POST',
          body: photoData
        });
      } else {
        throw new Error('No image source provided');
      }
    } else {
      // Post text only
      const postData = new URLSearchParams({
        message: item.text,
        access_token: access_token
      });
      
      response = await fetch(`${baseUrl}/${page_id}/feed`, {
        method: 'POST',
        body: postData
      });
    }
    
    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error.message);
    }
    
    // Update rate limit on success
    updateRateLimit();
    
    return result;
  } catch (error) {
    logError(`Failed to post item ${item.id}`, error);
    throw error;
  } finally {
    // Cleanup temp file if downloaded from Telegram
    if (tempFilePath) {
      cleanupTempFile(tempFilePath);
    }
  }
}

// Process scheduled posts
async function processScheduledPosts() {
  const config = loadConfig();
  const queue = loadQueue();
  
  const now = new Date().toISOString();
  const duePosts = queue.pending.filter(item => 
    item.scheduledFor && item.scheduledFor <= now
  );
  
  for (const item of duePosts) {
    try {
      log(`Posting to Facebook: ${item.id}`);
      const result = await postToFacebook(item, config);
      
      // Move to posted
      item.postedAt = now;
      item.facebookPostId = result.id;
      item.status = 'posted';
      
      queue.posted.push(item);
      queue.pending = queue.pending.filter(p => p.id !== item.id);
      queue.lastPostTime = now;
      
      // Add content hash to prevent duplicates
      if (item.contentHash && !queue.postedHashes.includes(item.contentHash)) {
        queue.postedHashes.push(item.contentHash);
        // Keep only last 1000 hashes to prevent memory issues
        if (queue.postedHashes.length > 1000) {
          queue.postedHashes = queue.postedHashes.slice(-1000);
        }
      }
      
      log(`Successfully posted: ${result.id}${result.dryRun ? ' [DRY RUN]' : ''}`);
    } catch (error) {
      log(`Failed to post ${item.id}: ${error.message}`, 'error');
      item.status = 'failed';
      item.error = error.message;
    }
  }
  
  saveQueue(queue);
}

// Check queue status
function getQueueStatus() {
  const queue = loadQueue();
  return {
    pending: queue.pending.length,
    scheduled: queue.pending.filter(i => i.scheduledFor).length,
    posted: queue.posted.length,
    lastPostTime: queue.lastPostTime,
    dryRun: loadConfig().settings.dry_run === true
  };
}

// Health check endpoint
function startHealthCheckServer(port = 3000) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      const config = loadConfig();
      const queue = loadQueue();
      const configValidation = validateConfig(config);
      
      const health = {
        status: configValidation.valid ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        checks: {
          config: configValidation.valid,
          configErrors: configValidation.errors,
          queue: {
            pending: queue.pending.length,
            scheduled: queue.pending.filter(i => i.scheduledFor).length,
            posted: queue.posted.length
          },
          dryRun: config.settings.dry_run === true
        }
      };
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
  
  server.listen(port, () => {
    log(`Health check server running on http://localhost:${port}/health`);
  });
  
  return server;
}

// CLI interface
const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case 'add':
    // Add content from command line (for testing)
    const content = JSON.parse(arg);
    const result = addToQueue(content);
    console.log(result.success ? 'Added:' : 'Failed:', result);
    break;
    
  case 'process':
    // Process scheduled posts
    processScheduledPosts().then(() => {
      console.log('Processing complete');
    }).catch(err => {
      console.error('Processing failed:', err);
      process.exit(1);
    });
    break;
    
  case 'status':
    console.log(getQueueStatus());
    break;
    
  case 'schedule':
    schedulePosts();
    console.log('Scheduling complete');
    break;
    
  case 'health':
    startHealthCheckServer(parseInt(arg) || 3000);
    break;
    
  case 'validate':
    const config = loadConfig();
    const validation = validateConfig(config);
    console.log('Config validation:', validation.valid ? '✅ Valid' : '❌ Invalid');
    if (!validation.valid) {
      console.log('Errors:', validation.errors);
    }
    break;
    
  default:
    console.log(`
Facebook Auto-Poster

Usage:
  node index.js add '<json>'          Add content to queue
  node index.js process               Process scheduled posts
  node index.js schedule              Schedule pending posts
  node index.js status                Show queue status
  node index.js health [port]         Start health check server
  node index.js validate              Validate configuration

Environment Variables:
  FACEBOOK_PAGE_ID        Facebook Page ID
  FACEBOOK_ACCESS_TOKEN   Facebook Access Token
  TELEGRAM_BOT_TOKEN      Telegram Bot Token
  DRY_RUN                 Set to 'true' for dry run mode (no actual posting)

Features:
  ✅ DRY_RUN mode - Test without actually posting
  ✅ Duplicate detection - Hash-based content guard
  ✅ Rate limiting - 1 post per 60 seconds minimum
  ✅ Input validation - Validates content, URLs, tokens
  ✅ Health check endpoint - /health for monitoring
  ✅ Separate error logging - logs/error.log
    `);
}

module.exports = { 
  addToQueue, 
  processScheduledPosts, 
  getQueueStatus,
  downloadTelegramFile,
  startHealthCheckServer,
  validateConfig,
  validateInput
};
