# Zoom Recorder MVP

Chrome extension MVP that records the active tab, tracks cursor/click events, and exports a follow-cursor zoomed video.

## Getting Started

Run the web dashboard:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Load the Extension (Unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` folder from this repo.

## Record and Export

1. Open the tab you want to record.
2. Click the extension icon (this opens `recorder.html` in a new tab).
3. Click **Select screen** and choose what to capture.
4. Press **Start recording**.
5. Press **Stop recording**.
6. Download **Raw** or **Render Zoomed Export**.

## Current MVP Limitations

- Recorder runs in an extension tab.
- Export format is WebM.
- Zoom rendering is local and real-time in browser, so longer recordings may take time.

## Project Structure

- `extension/manifest.json`: MV3 manifest
- `extension/background.js`: session state and cursor-event aggregation
- `extension/content.js`: in-page cursor and click tracking
- `extension/recorder.*`: full-page recorder UI and zoom export pipeline
- `app/`: Next.js dashboard page with setup instructions

## Next Steps

- Move recording lifecycle to an offscreen document for robust long recordings.
- Add trimming and keyframe editing UI.
- Add MP4 export via backend or companion desktop renderer.
