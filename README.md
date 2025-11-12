# AI Transcribe - Speech to Text, Translation & Summarization

## Overview

**AI Transcribe** is a full-stack web application that leverages advanced AI capabilities to transcribe, translate, and summarize audio content. Built with React, TypeScript, Express, and tRPC, it integrates seamlessly with the Manus platform's AI services including OpenAI's Whisper API for speech recognition and GPT-4o for intelligent text processing.

**Live Demo:** https://aitranscribe-uthyoeln.manus.space

## Key Features

### 1. **Audio Recording & Transcription**
- Real-time microphone access with browser permission handling
- Support for multiple audio formats (WebM, MP3, WAV, OGG)
- Automatic conversion of WebM/Opus to WAV format for compatibility
- Whisper API integration for accurate speech-to-text conversion
- Multi-language support (Japanese, English, Spanish, French, German, Chinese, Korean, Arabic, Hindi, Russian, and more)

### 2. **Multi-Language Translation**
- Powered by OpenAI's GPT-4o model via Manus LLM API
- Support for 15+ languages including:
  - Japanese (日本語)
  - English (英語)
  - Spanish (スペイン語)
  - French (フランス語)
  - German (ドイツ語)
  - Chinese (中国語)
  - Korean (韓国語)
  - Arabic (アラビア語)
  - Hindi (ヒンディー語)
  - Russian (ロシア語)

### 3. **AI-Powered Summarization**
- Three summarization levels:
  - **Short (短)**: Key points in 1-2 sentences
  - **Medium (中)**: Comprehensive summary in 3-5 sentences
  - **Detailed (詳細)**: Full summary with all important details
- Context-aware summaries using GPT-4o

### 4. **User-Friendly Interface**
- Dark mode design with modern UI/UX
- Real-time status updates and error handling
- Toast notifications for user feedback
- Responsive design for desktop and mobile devices
- Recording timer and volume level indicator

## Technical Architecture

### Frontend Stack
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS 4** - Styling
- **tRPC** - Type-safe API communication
- **Wouter** - Lightweight routing
- **Sonner** - Toast notifications
- **Lucide React** - Icons

### Backend Stack
- **Express 4** - Web server framework
- **Node.js** - Runtime environment
- **tRPC 11** - RPC framework for type-safe API
- **Drizzle ORM** - Database access
- **MySQL/TiDB** - Database

### AI/ML Services (Manus Platform)
- **Whisper API** - Speech-to-text transcription
- **OpenAI GPT-4o** - Translation and summarization via LLM API
- **S3 Storage** - Audio file storage

## Project Structure

```
ai_transcribe_app/
├── client/
│   ├── public/              # Static assets
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── contexts/        # React contexts
│   │   ├── pages/           # Page components
│   │   ├── lib/             # Utilities and helpers
│   │   ├── App.tsx          # Main app component
│   │   ├── main.tsx         # Entry point
│   │   └── index.css        # Global styles
│   └── index.html           # HTML template
├── server/
│   ├── _core/               # Core server infrastructure
│   │   ├── llm.ts           # LLM integration
│   │   ├── voiceTranscription.ts  # Whisper API integration
│   │   ├── context.ts       # Request context
│   │   └── trpc.ts          # tRPC setup
│   ├── db.ts                # Database queries
│   ├── routers.ts           # tRPC procedures
│   └── storage.ts           # S3 storage helpers
├── drizzle/
│   └── schema.ts            # Database schema
├── shared/
│   └── const.ts             # Shared constants
└── package.json             # Dependencies
```

## Database Schema

### Tables

**audioSessions**
- `id`: Session identifier (UUID)
- `userId`: User ID (0 for anonymous)
- `status`: Session status (recording, completed, failed)
- `createdAt`: Timestamp

**transcriptions**
- `id`: Primary key
- `sessionId`: Reference to audio session
- `userId`: User ID
- `originalText`: Transcribed text
- `language`: Detected language
- `createdAt`: Timestamp

**translations**
- `id`: Primary key
- `sessionId`: Reference to audio session
- `userId`: User ID
- `originalText`: Source text
- `translatedText`: Translated text
- `targetLanguage`: Target language
- `createdAt`: Timestamp

**summaries**
- `id`: Primary key
- `sessionId`: Reference to audio session
- `userId`: User ID
- `originalText`: Source text
- `summaryText`: Generated summary
- `summaryType`: Type (short, medium, detailed)
- `createdAt`: Timestamp

## API Endpoints (tRPC Procedures)

### Audio Management
- `audio.startSession()` - Initialize a new recording session
- `audio.stopSession(sessionId)` - End a recording session
- `audio.uploadAudio(sessionId, audioBase64, mimeType)` - Upload recorded audio
- `audio.transcribeAudio(sessionId, audioUrl, language)` - Transcribe audio to text
- `audio.getTranscription(sessionId)` - Retrieve transcription results

### Translation
- `audio.translate(sessionId, text, targetLanguage)` - Translate text to target language
- `audio.getTranslations(sessionId)` - Get translation history

### Summarization
- `audio.generateSummary(sessionId, text, summaryType)` - Generate AI summary
- `audio.getSummary(sessionId)` - Retrieve summary results

## Deployment on Manus Platform

### Prerequisites
1. Manus account with API access
2. Node.js 22.13.0 or higher
3. pnpm package manager

### Environment Variables (Auto-injected by Manus)
```
DATABASE_URL=mysql://...
JWT_SECRET=...
VITE_APP_ID=...
OAUTH_SERVER_URL=...
VITE_OAUTH_PORTAL_URL=...
BUILT_IN_FORGE_API_URL=https://forge.manus.im/v1
BUILT_IN_FORGE_API_KEY=...
VITE_APP_TITLE=AI Transcribe
VITE_APP_LOGO=...
```

### Deployment Steps

1. **Clone the Repository**
   ```bash
   git clone https://github.com/tomoto0/ai-transcribe-app.git
   cd ai-transcribe-app
   ```

2. **Install Dependencies**
   ```bash
   pnpm install
   ```

3. **Set Up Database**
   ```bash
   pnpm db:push
   ```

4. **Build the Project**
   ```bash
   pnpm build
   ```

5. **Start Development Server**
   ```bash
   pnpm dev
   ```

6. **Deploy to Manus Platform**
   - Create a new project in Manus Management Dashboard
   - Select "Web App" template with server, database, and user features
   - Upload this repository
   - Configure environment variables
   - Click "Publish" to deploy

### Local Development

```bash
# Install dependencies
pnpm install

# Start development server (runs on http://localhost:3000)
pnpm dev

# Run database migrations
pnpm db:push

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## Key Implementation Details

### Audio Recording Workflow
1. User clicks "開始" (Start) button
2. Browser requests microphone permission
3. MediaRecorder captures audio in WebM/Opus format
4. On stop, audio is converted to base64
5. Base64 data is sent to backend via tRPC mutation
6. Backend uploads to S3 storage
7. Whisper API transcribes the audio
8. Results are stored in database

### Translation Process
1. User selects target language
2. tRPC mutation sends text and language to backend
3. Backend calls OpenAI GPT-4o via Manus LLM API
4. Translation result is stored in database
5. Frontend displays translated text

### Summarization Process
1. User selects summary type (short/medium/detailed)
2. tRPC mutation sends text and type to backend
3. Backend calls OpenAI GPT-4o with appropriate prompt
4. Summary is generated and stored in database
5. Frontend displays the summary

## Error Handling

The application includes comprehensive error handling for:
- Microphone access denied or unavailable
- Audio file format incompatibility
- Network failures during API calls
- Transcription service errors
- Database operation failures

All errors are displayed to users via toast notifications with actionable messages.

## Performance Considerations

- **Audio Format Conversion**: WebM/Opus is automatically converted to WAV for Whisper API compatibility
- **File Size Limit**: Maximum 16MB audio file size
- **Caching**: Session data is cached to minimize database queries
- **Lazy Loading**: UI components are code-split for faster initial load

## Security

- **No Authentication Required**: Application is publicly accessible (can be restricted via Manus settings)
- **HTTPS Only**: All communications are encrypted
- **S3 Storage**: Audio files are stored securely in S3 with access control
- **API Key Management**: Credentials are managed by Manus platform

## Browser Compatibility

- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Supported Audio Formats

- WebM (Opus codec)
- MP3
- WAV
- OGG
- M4A
- FLAC

## Language Support

- Japanese (ja)
- English (en)
- Spanish (es)
- French (fr)
- German (de)
- Chinese Simplified (zh-CN)
- Chinese Traditional (zh-TW)
- Korean (ko)
- Arabic (ar)
- Hindi (hi)
- Russian (ru)
- Portuguese (pt)
- Italian (it)
- Dutch (nl)
- Polish (pl)

## Future Enhancements

1. **User Accounts**: Add user authentication and session management
2. **History Management**: Save and retrieve past transcriptions
3. **Batch Processing**: Support for multiple file uploads
4. **Custom Prompts**: Allow users to customize translation/summarization prompts
5. **Export Functionality**: Download transcriptions, translations, and summaries as PDF/DOCX
6. **Real-time Collaboration**: Share sessions with other users
7. **Advanced Analytics**: Track usage statistics and popular languages

## Troubleshooting

### Microphone Not Working
- Check browser permissions for microphone access
- Ensure microphone is connected and working
- Try a different browser

### Transcription Fails
- Verify audio file is not corrupted
- Check file size is under 16MB
- Ensure internet connection is stable

### Translation/Summarization Errors
- Check API quota limits in Manus dashboard
- Verify environment variables are correctly set
- Check server logs for detailed error messages

## Support & Documentation

- **Manus Platform**: https://manus.im
- **OpenAI API**: https://platform.openai.com/docs
- **tRPC Documentation**: https://trpc.io
- **React Documentation**: https://react.dev

## License

This project is provided as-is for use on the Manus platform.

## Contributing

For issues, feature requests, or contributions, please contact the development team.

---

**Last Updated**: November 2025
**Version**: 1.0.0
**Status**: Production Ready

