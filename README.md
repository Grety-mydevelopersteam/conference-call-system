# Conference Call & Recording System 📞🎙️

Enterprise-grade conference calling solution with recording, transcription, and moderation capabilities built on Twilio Voice API.

## ✨ Features

- **PIN-based Access**: Separate PINs for hosts and participants
- **Conference Recording**: Automatic recording with cloud storage
- **Live Moderation**: Mute, hold, and kick participants
- **Scheduled Conferences**: Plan and schedule future conferences
- **Participant Management**: Track attendance and speaking time
- **Voice Transcription**: Optional transcription service
- **Analytics Dashboard**: Conference metrics and reporting
- **Reminder System**: Automated call reminders before meetings
- **Multi-conference Support**: Handle multiple simultaneous conferences

## 🏢 Use Cases

- **Business Meetings**: Team calls and client conferences
- **Webinars**: Educational sessions with Q&A
- **Board Meetings**: Secure recorded sessions
- **Training Sessions**: Interactive learning calls
- **Support Groups**: Community conference calls

## 🔧 Technology Stack

- **Backend**: Node.js, Express.js
- **Voice**: Twilio Programmable Voice
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT tokens
- **Scheduling**: Node-cron
- **Security**: Helmet, bcrypt
- **Real-time**: WebSockets (optional)

## 📋 Prerequisites

- Node.js 16.0+
- MongoDB 5.0+
- Twilio Account with Voice
- SSL Certificate (production)
- ngrok (development)

## 🚀 Quick Start

### 1. Clone Repository
```bash
git clone https://github.com/yourusername/conference-call-system.git
cd conference-call-system
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
```bash
cp .env.example .env
# Edit .env with your credentials
```

### 4. Start MongoDB
```bash
mongod --dbpath ./data/db
```

### 5. Run Application
```bash
npm start
```

### 6. Setup Twilio Webhook
```bash
# For development
ngrok http 3000

# Configure in Twilio Console:
# Voice URL: https://[ngrok-id].ngrok.io/conference/join
```

## 📞 How It Works

### Conference Flow
```
1. Participant calls conference number
2. System prompts for conference PIN
3. Verify PIN (Host or Participant)
4. Collect participant name
5. Join conference room
6. Conference features:
   - Host controls
   - Recording (if enabled)
   - Participant notifications
7. End conference when host leaves
```

### PIN Structure
- **Host PIN**: 6 digits (can start/end conference)
- **Participant PIN**: 6 digits (regular access)

## 🔐 API Documentation

### Create Conference
```http
POST /api/conferences/create
Content-Type: application/json

{
  "title": "Q4 Planning Meeting",
  "scheduledTime": "2024-12-01T14:00:00Z",
  "duration": 60,
  "maxParticipants": 10,
  "recordingEnabled": true,
  "transcriptionEnabled": false
}

Response:
{
  "conferenceId": "abc123",
  "hostPin": "123456",
  "participantPin": "654321",
  "dialInNumber": "+1234567890"
}
```

### Get Conference Status
```http
GET /api/conferences/{conferenceId}

Response:
{
  "conference": {...},
  "liveParticipants": [...],
  "isActive": true
}
```

### Moderate Conference
```http
POST /api/conferences/{conferenceId}/moderate
Content-Type: application/json

{
  "action": "mute",  // mute, unmute, hold, unhold, kick, end
  "participantCallSid": "CA..."
}
```

### Get Recordings
```http
GET /api/conferences/{conferenceId}/recordings

Response:
{
  "recordings": [
    {
      "sid": "RE...",
      "duration": 3600,
      "url": "https://...",
      "dateCreated": "2024-01-01T..."
    }
  ]
}
```

## 📊 Conference Analytics

### Metrics Tracked
- Total conferences held
- Average conference duration
- Peak participant count
- Recording storage used
- Cost per conference
- Participant engagement

### Analytics Endpoint
```http
GET /api/analytics/conferences?startDate=2024-01-01&endDate=2024-12-31
```

## 🛡️ Security Features

- **PIN Protection**: Unique PINs for each conference
- **Role-based Access**: Host vs participant permissions
- **Encrypted Storage**: Sensitive data encryption
- **Rate Limiting**: Prevent abuse
- **Input Validation**: Sanitize all inputs
- **GDPR Compliance**: Data privacy controls

## 🎛️ Moderator Controls

| Action | Description | Host Only |
|--------|-------------|-----------|
| Mute All | Mute all participants | ✅ |
| Lock Conference | Prevent new joins | ✅ |
| Recording Toggle | Start/stop recording | ✅ |
| Kick Participant | Remove from call | ✅ |
| End Conference | Terminate for all | ✅ |

## 📈 Performance

- Supports 250+ participants per conference
- 99.9% uptime SLA
- <100ms audio latency
- Automatic failover
- Global infrastructure

## 🧪 Testing

### Run Tests
```bash
npm test
```

### Test Conference Locally
```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Start ngrok
ngrok http 3000

# Use ngrok URL in Twilio console
```

## 📝 Environment Variables

```env
# Twilio
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_PHONE_NUMBER=+1234567890

# MongoDB
MONGODB_URI=mongodb://localhost/conference

# Server
PORT=3000
BASE_URL=https://your-domain.com

# Security
JWT_SECRET=your-secret-key
BCRYPT_ROUNDS=10

# Features
MAX_CONFERENCE_DURATION=7200  # seconds
DEFAULT_MAX_PARTICIPANTS=10
RECORDING_ENABLED=true
```

## 🚦 Monitoring

- Real-time participant count
- Conference health checks
- Recording status
- Cost tracking
- Error logging

## 🤝 Contributing

1. Fork repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Open pull request

## 📄 License

MIT License - see LICENSE file

## 📞 Support

For issues or questions, please open a GitHub issue.

---

**Built with ❤️ using Twilio Voice API**
