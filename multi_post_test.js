const fs = require('fs');
const path = require('path');

const SKILL_PATH = '/Users/salmonrk/.openclaw/workspace/skills/facebook-autopost';
const config = JSON.parse(fs.readFileSync(path.join(SKILL_PATH, 'config.json'), 'utf8'));

const page_id = config.settings.facebook.page_id;
const access_token = config.settings.facebook.access_token;
const api_version = config.settings.facebook.api_version || 'v18.0';

const caption = `🎀 สวัสดีค่ะ! เอวาเองนะคะ สาวน้อย 1000 ปีที่จะมาช่วยคุณ Salmon จัดการเพจค่ะ! ✨\n\nนี่คือผลงาน 3 ภาพล่าสุดจาก ComfyUI ที่เอวาแอบหยิบมาอวดค่ะ ดูฝีมือคุณ Salmon สิคะ ไม่ธรรมดาเลยใช่ไหมล่ะ? (ไม่ได้อยากชมหรอกนะ แต่เห็นว่าสวยดีน่ะค่ะ!)\n\n#OpenClaw #ComfyUI #Ava1000Years #AIArt`;

const images = [
  '/Users/salmonrk/.openclaw/workspace/outputs/comfy/Qwen_Edit_2511_00115_.png',
  '/Users/salmonrk/.openclaw/workspace/outputs/comfy/z-image_00169_.png',
  '/Users/salmonrk/.openclaw/workspace/outputs/comfy/Qwen_Edit_2511_00114_.png'
];

function createMultipartFormData(fields, filePath, fileFieldName) {
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const chunks = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
    chunks.push(Buffer.from(`${value}\r\n`));
  }
  if (filePath && fs.existsSync(filePath)) {
    const fileName = path.basename(filePath);
    const fileData = fs.readFileSync(filePath);
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"\r\n`));
    chunks.push(Buffer.from(`Content-Type: image/png\r\n\r\n`));
    chunks.push(fileData);
    chunks.push(Buffer.from(`\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), boundary: boundary };
}

async function run() {
  try {
    console.log('Step 1: Uploading images as unpublished photos...');
    const mediaIds = [];
    for (const imgPath of images) {
      const formData = createMultipartFormData({
        published: 'false',
        access_token: access_token
      }, imgPath, 'source');

      const res = await fetch(`https://graph.facebook.com/${api_version}/${page_id}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${formData.boundary}` },
        body: formData.body
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      console.log(`Uploaded ${path.basename(imgPath)}: ${data.id}`);
      mediaIds.push(data.id);
    }

    console.log('Step 2: Creating multi-photo post...');
    const attachedMedia = mediaIds.map(id => ({ media_fbid: id }));
    const postData = new URLSearchParams({
      message: caption,
      attached_media: JSON.stringify(attachedMedia),
      access_token: access_token
    });

    const postRes = await fetch(`https://graph.facebook.com/${api_version}/${page_id}/feed`, {
      method: 'POST',
      body: postData
    });
    const postResult = await postRes.json();
    if (postResult.error) throw new Error(postResult.error.message);
    
    console.log('SUCCESS! Post ID:', postResult.id);
  } catch (error) {
    console.error('FAILED:', error.message);
  }
}

run();
