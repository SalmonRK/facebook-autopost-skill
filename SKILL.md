# Facebook Auto-Poster - OpenClaw Skill

Cross-post content from Telegram groups to Facebook Page with intelligent scheduling.

## Features

- 📱 Monitor Telegram groups/channels for new content
- 📅 Schedule posts (default: 2 per day at 09:00 & 18:00)
- 🖼️ Support text and image posts
- 📊 Queue management with status tracking
- 🔄 Automatic retry on failure
- 🇹🇭 Full Thai language support
- 🧪 DRY_RUN mode for testing
- 🛡️ Duplicate content detection (SHA-256)
- ⏱️ Rate limiting (1 post / 60s)
- ✅ Input validation
- 🏥 Health check endpoint
- 📋 Separate error logging

## Installation

```bash
openclaw skill install facebook-autopost-skill
```

## Configuration

Edit `config.json`:

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
    "telegram_sources": ["AI-Media", "-1001234567890"],
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

## Getting Credentials

### Facebook
1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Create App → Business type
3. Add Facebook Login + Graph API
4. Get Page Access Token from [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
5. Required permissions: `pages_manage_posts`, `pages_read_engagement`

### Telegram
1. Message [@BotFather](https://t.me/botfather)
2. Create new bot
3. Copy the bot token

## Usage

### From Telegram
- **Schedule**: Send text/image normally → queued for next slot
- **Post Now**: Add `#now` hashtag → posts immediately
- **Skip**: Add `#skip` hashtag → won't be posted

### Manual Operations
```bash
cd skills/facebook-autopost-skill

# Check queue status
node index.js status

# Process scheduled posts immediately
node index.js process

# Add test content
node index.js add '{"source":"manual","text":"Test post","mediaType":"text"}'
```

## Automation

Add to crontab:
```bash
# Process posts every 10 minutes
*/10 * * * * cd /path/to/skill && node index.js process

# Schedule new items hourly
0 * * * * cd /path/to/skill && node index.js schedule
```

## Files

- `config.json` - Configuration (credentials excluded)
- `index.js` - Core queue and posting logic
- `telegram-integration.js` - Telegram message handler
- `telegram-webhook.js` - Webhook handler
- `queue.json` - Content queue (auto-generated)
- `posts.log` - Activity log (auto-generated)
- `temp/` - Temporary files (auto-cleaned)

## Notes

- Image files are downloaded from Telegram and uploaded to Facebook
- Temporary files are automatically cleaned up after posting
- Facebook API rate limit: max 25 posts per 24 hours per Page
- Access tokens may expire and need periodic refresh

## License

MIT License - see [LICENSE](../LICENSE) for details
