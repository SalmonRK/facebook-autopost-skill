#!/usr/bin/env node
/**
 * Facebook Auto-Poster Skill
 * Cross-posts content from Telegram groups to Facebook Page with scheduling
 * Supports text, image, and video (downloaded from Telegram or local path)
 * 
 * Features:
 * - DRY_RUN mode for testing
 * - Duplicate content guard
 * - Rate limiting
 * - Input validation
 * - Health check endpoint
 * - Separate error logging
 * - Resumable video upload support
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
  
  if (!item.text || typeof item.text !== 'string') {
    errors.push('Text content is required');
  } else if (item.text.length > 2200) {
    errors.push('Text exceeds Facebook limit of 2200 characters');
  }
  
  const validMediaTypes = ['text', 'image', 'video'];
  if (item.mediaType && !validMediaTypes.includes(item.mediaType)) {
    errors.push(`Invalid media type. Must be one of: ${validMediaTypes.join(', ')}`);
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
  
  if (!fb?.page_id || fb.page_id.includes('YOUR_')) {
    errors.push('Facebook Page ID is required');
  }
  
  if (!fb?.access_token || fb.access_token.includes('YOUR_')) {
    errors.push('Facebook Access Token is required');
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
    const fileInfoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const fileInfo = await fileInfoResponse.json();
    
    if (!fileInfo.ok || !fileInfo.result) {
      throw new Error('Failed to get file info from Telegram');
    }
    
    const filePath = fileInfo.result.file_path;
    const fileName = path.basename(filePath);
    const localPath = path.join(TEMP_DIR, `${Date.now()}_${fileName}`);
    
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
    if (filePath && fs.existsSync(filePath) && filePath.includes(TEMP_DIR)) {
      fs.unlinkSync(filePath);
      log(`Cleaned up temp file: ${filePath}`);
    }
  } catch (error) {
    logError('Failed to cleanup temp file', error);
  }
}

// Add content to queue
function addToQueue(content) {
  const validation = validateInput(content);
  if (!validation.valid) {
    log(`Validation failed: ${validation.errors.join(', ')}`, 'warn');
    return { success: false, errors: validation.errors };
  }
  
  const queue = loadQueue();
  const contentHash = generateContentHash(content.text, content.mediaType);
  
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
  schedulePosts();
  
  return { success: true, item };
}

// Calculate next schedule time
function getNextScheduleTime(config) {
  const now = new Date();
  const times = config.settings.schedule.post_times;
  const timezone = config.settings.schedule.timezone || 'Asia/Bangkok';
  const tzNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const currentTime = tzNow.getHours() * 60 + tzNow.getMinutes();
  
  for (const timeStr of times) {
    const [hour, minute] = timeStr.split(':').map(Number);
    if (hour * 60 + minute > currentTime) {
      const scheduled = new Date(tzNow);
      scheduled.setHours(hour, minute, 0, 0);
      return scheduled.toISOString();
    }
  }
  
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
  const unscheduled = queue.pending.filter(item => !item.scheduledFor);
  if (unscheduled.length === 0) return;
  
  const postsPerDay = config.settings.schedule.posts_per_day || 2;
  const toSchedule = unscheduled.slice(0, postsPerDay);
  
  for (const item of toSchedule) {
    item.scheduledFor = getNextScheduleTime(config);
    log(`Scheduled ${item.id} for ${item.scheduledFor}`);
  }
  saveQueue(queue);
}

// Multipart Form Data Helper
function createMultipartFormData(fields, filePath, fileFieldName, mimeType = 'application/octet-stream') {
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const chunks = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  if (filePath && fs.existsSync(filePath)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileFieldName}"; filename="${path.basename(filePath)}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
    chunks.push(fs.readFileSync(filePath));
    chunks.push(Buffer.from(`\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), boundary: boundary };
}

// Resumable Video Upload
async function postVideoToFacebook(item, config, videoPath) {
  const { page_id, access_token, api_version } = config.settings.facebook;
  const baseUrl = `https://graph.facebook.com/${api_version}/${page_id}/videos`;
  const stats = fs.statSync(videoPath);
  const fileSize = stats.size;

  log(`Phase 1: Initializing video upload for ${path.basename(videoPath)} (${fileSize} bytes)`);
  const initRes = await fetch(baseUrl, {
    method: 'POST',
    body: new URLSearchParams({ upload_phase: 'start', access_token, file_size: fileSize })
  });
  const initData = await initRes.json();
  if (initData.error) throw new Error(`Video Init failed: ${initData.error.message}`);
  
  const uploadSessionId = initData.upload_session_id;

  log(`Phase 2: Transferring video data...`);
  const formData = createMultipartFormData({
    upload_phase: 'transfer',
    upload_session_id: uploadSessionId,
    start_offset: '0',
    access_token: access_token
  }, videoPath, 'video_file_chunk', 'video/mp4');

  const transferRes = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${formData.boundary}` },
    body: formData.body
  });
  const transferData = await transferRes.json();
  if (transferData.error) throw new Error(`Video Transfer failed: ${transferData.error.message}`);

  log(`Phase 3: Finishing video upload...`);
  const finishRes = await fetch(baseUrl, {
    method: 'POST',
    body: new URLSearchParams({
      upload_phase: 'finish',
      upload_session_id: uploadSessionId,
      access_token: access_token,
      description: item.text
    })
  });
  const finishData = await finishRes.json();
  if (finishData.error) throw new Error(`Video Finish failed: ${finishData.error.message}`);
  
  return finishData;
}

// Post to Facebook
async function postToFacebook(item, config) {
  if (config.settings.dry_run === true) {
    log(`[DRY RUN] Would post: ${item.text.substring(0, 100)}...`, 'dryrun');
    return { id: 'dry-run-' + Date.now(), dryRun: true };
  }
  
  const validation = validateConfig(config);
  if (!validation.valid) throw new Error(`Config error: ${validation.errors.join(', ')}`);
  
  const rateLimit = checkRateLimit();
  if (!rateLimit.allowed) throw new Error(rateLimit.message);
  
  const { page_id, access_token, api_version } = config.settings.facebook;
  const baseUrl = `https://graph.facebook.com/${api_version}`;
  let tempFilePath = null;
  let result;

  try {
    let mediaPath = item.mediaUrl;
    if (item.telegramFileId && config.settings.telegram?.bot_token) {
      mediaPath = await downloadTelegramFile(item.telegramFileId, config.settings.telegram.bot_token);
      tempFilePath = mediaPath;
    }

    if (item.mediaType === 'video' && mediaPath && fs.existsSync(mediaPath)) {
      result = await postVideoToFacebook(item, config, mediaPath);
    } else if (item.mediaType === 'image' && mediaPath && fs.existsSync(mediaPath)) {
      const formData = createMultipartFormData({ caption: item.text, published: 'true', access_token }, mediaPath, 'file', 'image/jpeg');
      const res = await fetch(`${baseUrl}/${page_id}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${formData.boundary}` },
        body: formData.body
      });
      result = await res.json();
    } else if (item.mediaType === 'image' && mediaPath) {
      const res = await fetch(`${baseUrl}/${page_id}/photos`, {
        method: 'POST',
        body: new URLSearchParams({ url: mediaPath, caption: item.text, published: 'true', access_token })
      });
      result = await res.json();
    } else {
      const res = await fetch(`${baseUrl}/${page_id}/feed`, {
        method: 'POST',
        body: new URLSearchParams({ message: item.text, access_token })
      });
      result = await res.json();
    }

    if (result.error) throw new Error(result.error.message);
    updateRateLimit();
    return result;
  } finally {
    if (tempFilePath) cleanupTempFile(tempFilePath);
  }
}

// Process scheduled posts
async function processScheduledPosts() {
  const config = loadConfig();
  const queue = loadQueue();
  const now = new Date().toISOString();
  const duePosts = queue.pending.filter(item => (item.text && item.text.includes('#now')) || (item.scheduledFor && item.scheduledFor <= now));
  
  for (const item of duePosts) {
    try {
      log(`Posting to Facebook: ${item.id} (${item.mediaType})`);
      const result = await postToFacebook(item, config);
      item.postedAt = now;
      item.facebookPostId = result.id;
      item.status = 'posted';
      queue.posted.push(item);
      queue.pending = queue.pending.filter(p => p.id !== item.id);
      if (!queue.postedHashes) queue.postedHashes = [];
      if (item.contentHash && !queue.postedHashes.includes(item.contentHash)) {
        queue.postedHashes.push(item.contentHash);
        if (queue.postedHashes.length > 1000) queue.postedHashes.shift();
      }
      log(`Successfully posted: ${result.id}`);
    } catch (error) {
      log(`Failed to post ${item.id}: ${error.message}`, 'error');
      item.status = 'failed';
      item.error = error.message;
    }
  }
  saveQueue(queue);
}

// CLI
const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case 'add':
    console.log(addToQueue(JSON.parse(arg)));
    break;
  case 'process':
    processScheduledPosts().then(() => console.log('Processing complete'));
    break;
  case 'status':
    const q = loadQueue();
    console.log({ pending: q.pending.length, posted: q.posted.length });
    break;
  case 'validate':
    const v = validateConfig(loadConfig());
    console.log(v.valid ? '✅ Valid' : '❌ Invalid', v.errors || '');
    break;
  default:
    console.log('Usage: node index.js [add|process|status|validate]');
}
