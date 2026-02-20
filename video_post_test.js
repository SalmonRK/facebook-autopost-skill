const fs = require('fs');
const path = require('path');

const SKILL_PATH = '/Users/salmonrk/.openclaw/workspace/skills/facebook-autopost';
const config = JSON.parse(fs.readFileSync(path.join(SKILL_PATH, 'config.json'), 'utf8'));

const PAGE_ID = config.settings.facebook.page_id;
const ACCESS_TOKEN = config.settings.facebook.access_token;
const VIDEO_PATH = '/Volumes/MacDrive/WanVideoWrapper_SteadyDancer_00012.mp4';
const DESCRIPTION = '🎀 ทดสอบการโพสต์วิดีโอจาก OpenClaw ค่ะ! ✨\n\nวิดีโอสวยๆ จาก WanVideoWrapper ที่คุณ Salmon สร้างขึ้น เอวาจัดการส่งตรงถึงเพจให้แล้วนะคะ! (วิดีโอนี้ดูเพลินดีเหมือนกันนะเนี่ย...)\n\n#OpenClaw #VideoAutomation #WanVideo #SteadyDancer';

async function uploadVideo() {
  try {
    console.log('Starting video upload...');
    const stats = fs.statSync(VIDEO_PATH);
    const fileSize = stats.size;

    // Phase 1: Initialize
    console.log('Phase 1: Initializing upload...');
    const initParams = new URLSearchParams({
      upload_phase: 'start',
      access_token: ACCESS_TOKEN,
      file_size: fileSize
    });
    const initRes = await fetch(`https://graph.facebook.com/v18.0/${PAGE_ID}/videos`, {
      method: 'POST',
      body: initParams
    });
    const initData = await initRes.json();
    if (initData.error) throw new Error(`Init failed: ${initData.error.message}`);
    
    const uploadSessionId = initData.upload_session_id;
    const videoId = initData.video_id;
    console.log(`Session ID: ${uploadSessionId}, Video ID: ${videoId}`);

    // Phase 2: Transfer (simplified for small/medium files)
    console.log('Phase 2: Transferring video data...');
    const videoBuffer = fs.readFileSync(VIDEO_PATH);
    
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    const chunks = [
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="upload_phase"\r\n\r\n`),
      Buffer.from(`transfer\r\n`),
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="upload_session_id"\r\n\r\n`),
      Buffer.from(`${uploadSessionId}\r\n`),
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="start_offset"\r\n\r\n`),
      Buffer.from(`0\r\n`),
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="access_token"\r\n\r\n`),
      Buffer.from(`${ACCESS_TOKEN}\r\n`),
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="video_file_chunk"; filename="video.mp4"\r\n`),
      Buffer.from(`Content-Type: video/mp4\r\n\r\n`),
      videoBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ];

    const uploadRes = await fetch(`https://graph.facebook.com/v18.0/${PAGE_ID}/videos`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat(chunks)
    });
    const uploadData = await uploadRes.json();
    if (uploadData.error) throw new Error(`Upload failed: ${uploadData.error.message}`);
    console.log('Chunk uploaded successfully.');

    // Phase 3: Finish
    console.log('Phase 3: Finishing upload...');
    const finishParams = new URLSearchParams({
      upload_phase: 'finish',
      upload_session_id: uploadSessionId,
      access_token: ACCESS_TOKEN,
      description: DESCRIPTION
    });
    const finishRes = await fetch(`https://graph.facebook.com/v18.0/${PAGE_ID}/videos`, {
      method: 'POST',
      body: finishParams
    });
    const finishData = await finishRes.json();
    if (finishData.error) throw new Error(`Finish failed: ${finishData.error.message}`);
    
    console.log('SUCCESS! Video Post ID:', finishData.id || videoId);
  } catch (error) {
    console.error('FAILED:', error.message);
  }
}

uploadVideo();
