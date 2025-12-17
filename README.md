# Papercuts V2

A Vite React TypeScript app for searching academic papers, retrieving PDFs, summarizing papers, and text-to-speech. Backend and database integration will be added for user authentication and summary storage.

## Features
- Search academic papers on Google Scholar
- Retrieve PDF of selected papers
- Summarize papers to 2000 words
- Text-to-speech for summaries
- Modal audio playback
- (Planned) User authentication and summary storage
- (Planned) Payment functionality

## Getting Started
1. Install dependencies:
   ```sh
   npm install
   ```
2. Start the development server:
   ```sh
   npm run dev
   ```

## Project Structure
- Frontend: React + Vite + TypeScript
- Backend: (Planned) Node.js/Express
- Database: (Planned) MongoDB or PostgreSQL

## Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License
[MIT](LICENSE)

## Quickstart
```sh
nvm use 24.6.0 && node -v && npm -v && npm run dev
cd server && nvm use 24.6.0 && npm start
```

## Development ideas
- add login functionality
- make a queue that users can continue adding papers to
- add payment functionality

## Setup (with Supabase)
1. Create a Supabase project at https://supabase.com/
2. Enable authentication (email/password recommended)
3. Create tables for users, payment details, and audio recordings
4. Enable Supabase Storage for audio files
5. Add your Supabase URL and Service Role Key to `.env`:
   ```
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```
6. Install Supabase client:
   ```
   npm install @supabase/supabase-js
   ```

## Next Steps
- Add login/signup UI to frontend
- Store/retrieve audio recordings for users
- Save payment details securely
- Check for existing audio before regenerating