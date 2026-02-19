# Facebook Auto-Poster Skill

Your Telegram content, automatically on Facebook. Schedule posts, handle images, zero manual work.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenClaw Skill](https://img.shields.io/badge/OpenClaw-Skill-blue.svg)](https://openclaw.ai)

## ✨ Features

### Core Features
- ✅ **Auto-Schedule**: Customizable posting schedule (default: 2 posts/day at 09:00, 18:00)
- ✅ **Image Support**: Automatically download and post images from Telegram
- ✅ **Queue Management**: Smart queue system prevents spam posting
- ✅ **Thai Language**: Full Thai language support

### Advanced Features
- 🧪 **DRY_RUN Mode**: Test without actually posting to Facebook
- 🛡️ **Duplicate Guard**: SHA-256 hash prevents posting same content twice
- ⏱️ **Rate Limiting**: Minimum 60 seconds between posts (configurable)
- ✅ **Input Validation**: Validates content length, URLs, tokens, and configuration
- 🏥 **Health Check**: `/health` endpoint for monitoring and status
- 📋 **Error Logging**: Separate error log at `logs/error.log`

### Convenience Features
- ⚡ **#now Hashtag**: Post immediately without waiting for schedule
- ⚡ **#skip Hashtag**: Skip posts you don't want to publish
- ⚡ **Multi-source**: Support multiple Telegram groups/channels
- ⚡ **Error Handling**: Auto-retry on failed posts

### Security Features
- 🔒 **Environment Variables**: No hardcoded credentials
- 🔒 **Auto-cleanup**: Temp files deleted after posting
- 🔒 **Rate Limiting**: Respects Facebook API limits

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Facebook Page with admin access
- Telegram Bot Token

### Installation

#### Option 1: As OpenClaw Skill
```bash
openclaw skill install facebook-autopost-skill
```

#### Option 2: Standalone Node.js Project
```bash
git clone https://github.com/chatgptonmarketing/facebook-autopost-skill.git
cd facebook-autopost-skill
npm install
```

### Configuration

1. **Copy config template:**
```bash
cp config.template.json config.json
```

2. **Set environment variables:**
```bash
export FACEBOOK_PAGE_ID="your_page_id"
export FACEBOOK_ACCESS_TOKEN="your_token"
export TELEGRAM_BOT_TOKEN="your_bot_token"
export DRY_RUN="false"  # Set to "true" for testing (no actual posts)
```

Or use `.env` file (see `.env.example`)

3. **Edit config.json:**
```json
{
  "telegram_sources": ["your-telegram-group"],
  "schedule": {
    "posts_per_day": 2,
    "post_times": ["09:00", "18:00"]
  }
}
```

### Usage

#### Send content from Telegram:
```
# Schedule for next slot (09:00 or 18:00)
Just send text or image with caption

# Post immediately
Add #now to your message

# Skip posting
Add #skip to your message
```

#### Manual operations:
```bash
# Check queue status
node index.js status

# Process scheduled posts
node index.js process

# Add content manually
node index.js add '{"source":"manual","text":"Hello","mediaType":"text"}'

# Validate configuration
node index.js validate

# Start health check server
node index.js health 3000
```

### DRY_RUN Mode (Testing)
Test your setup without actually posting to Facebook:

```bash
# Set environment variable
export DRY_RUN="true"

# Or add to config.json
{
  "settings": {
    "dry_run": true
  }
}
```

In DRY_RUN mode, the system will:
- Process queue normally
- Log what would be posted
- Skip actual Facebook API calls
- Return mock post IDs

### Health Check Endpoint
Monitor system health via HTTP endpoint:

```bash
# Start health server
node index.js health 3000

# Check status
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "checks": {
    "config": true,
    "queue": {
      "pending": 5,
      "scheduled": 2,
      "posted": 10
    },
    "dryRun": false
  }
}
```

## 📁 Project Structure

```
facebook-autopost-skill/
├── index.js                 # Main logic
├── telegram-webhook.js      # Telegram webhook handler
├── telegram-integration.js  # Telegram message processor
├── auto-post-handler.sh     # Shell script handler
├── config.template.json     # Configuration template
├── .env.example            # Environment variables example
├── temp/                   # Temporary files (auto-cleaned)
└── logs/                   # Log files
```

## 🔧 Configuration Options

### config.json
```json
{
  "settings": {
    "facebook": {
      "page_id": "YOUR_PAGE_ID",
      "access_token": "${FACEBOOK_ACCESS_TOKEN}",
      "api_version": "v18.0"
    },
    "telegram": {
      "bot_token": "${TELEGRAM_BOT_TOKEN}"
    },
    "telegram_sources": ["group-name", "-1001234567890"],
    "schedule": {
      "posts_per_day": 2,
      "post_times": ["09:00", "18:00"],
      "timezone": "Asia/Bangkok"
    },
    "content_filter": {
      "min_text_length": 10,
      "allowed_media_types": ["text", "image"],
      "skip_patterns": ["#skip", "#draft"]
    }
  }
}
```

## 🛡️ Security

- Never commit `config.json` with real credentials
- Use environment variables for sensitive data
- Bot Token and Facebook Access Token are kept secure
- Automatic cleanup of temporary files

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👤 Author

**chatgptonmarketing** - chatgptonmarketing@gmail.com

## 🙏 Acknowledgments

- Built for OpenClaw ecosystem
- Inspired by the need for seamless Telegram to Facebook automation
- Special thanks to the OpenClaw community
