# D365FO Label Explorer

🏷️ **Ultra-fast label file explorer for Microsoft Dynamics 365 Finance & Operations**

A 100% client-side web application for searching and exploring label files (`.label.txt`) from D365FO. Powered by **SQLite WASM** with **OPFS** for high-performance searching and storage. All processing happens locally in your browser - no data is ever sent to a server.

**No build tools required** - runs directly in the browser with vanilla JavaScript.

## Features

- ⚡ **SQLite WASM + OPFS** - Multi-threaded search and storage using SQLite's high-performance engine
- 🔍 **Full-Text Search** - Advanced SQL-based searching for labels and IDs
- 📋 **One-Click Copy** - Copy `@Prefix:LabelId` format instantly
- 🌍 **Multi-Culture Support** - Browse labels across all cultures (en-US, pt-BR, etc.)
- 💾 **Persistent Sessions** - Your folder selection and search history are remembered
- 🔒 **100% Private** - All processing happens locally in your browser
- 📦 **Zero Build Dependencies** - No npm, no bundler, just HTML/CSS/JS

## Quick Start

### Option 1: GitHub Pages / Netlify (Recommended)
Just open the hosted version - it works immediately!

### Option 2: Local Development
Due to browser security restrictions (CORS and COOP/COEP headers for SQLite WASM), you need a local server:

1. Install the **Live Server** extension in VS Code
2. Open the project folder
3. Right-click `index.html` → "Open with Live Server"

Or use the provided Python server:
```bash
python serve.py
```

Then open `http://localhost:8000` in your browser.

## Usage

1. Open the application in Chrome or Edge (86+)
2. Click "Select D365FO Folder"
3. Navigate to your `PackagesLocalDirectory` folder (typically `K:\AosService\PackagesLocalDirectory\`)
4. Wait for indexing to complete (now faster with SQLite streaming)
5. Start searching!

## Performance Baseline Telemetry

Lightweight telemetry is emitted to the DevTools console (informational only; no behavior changes).

1. Open DevTools → **Console** and filter by `[Telemetry]`
2. Run a full discovery + indexing flow (or Quick Start + background indexing)
3. Run representative searches (example buckets): `a`, `cust`, `sales order`, `@SYS12345`
4. Capture `durationMs`, counts, and throughput from:
   - `[Telemetry] discovery.scan:start/end` (model/file counts)
   - `[Telemetry] indexing.run:start/end` (files, labels, labelsPerSecond/filesPerSecond)
   - `[Telemetry] search.query:start/end` (queryLengthBucket, resultCount, durationMs)

Optional: disable telemetry with `localStorage.setItem('ff_perf_telemetry', '0')` and refresh.

## Browser Requirements

| Browser | Supported | Notes |
|---------|-----------|-------|
| Chrome | ✅ 86+ | Full support (OPFS required) |
| Edge | ✅ 86+ | Full support (OPFS required) |
| Firefox | ❌ | Restricted File System Access |
| Safari | ❌ | Restricted File System Access |

## Project Structure

```
.
├── index.html          # Main HTML entry point
├── styles.css          # Modern dark theme styles
├── app.js              # Application entry point
├── app-orchestrator.js # Central coordination logic
├── core/
│   ├── db.js           # SQLite WASM interface
│   ├── sqlite-db.js    # Database schema and low-level ops
│   ├── search.js       # Search engine orchestration
│   ├── file-access.js  # File System Access API
│   └── opfs-cache.js   # Origin Private File System cache
├── ui/                 # Decoupled UI components
│   ├── builder.js      # DB initialization UI
│   ├── discovery.js    # Folder discovery UI
│   ├── extractor.js    # Label extraction UI
│   └── ...
├── workers/            # Multi-threaded background tasks
│   ├── indexer.worker.js # SQLite indexing
│   ├── search.worker.js  # Concurrent searching
│   └── parser.worker.js  # File parsing
└── utils/              # Helper utilities
```

## How It Works

1. **Folder Selection** - Uses the File System Access API to read your local D365FO installation.
2. **Streaming Ingestion** - Label files are parsed and streamed directly into SQLite using a chunked approach.
3. **SQLite WASM + OPFS** - Uses the latest web technologies for persistent, high-performance SQL storage.
4. **Concurrent Search** - Searching is offloaded to Web Workers to keep the UI fluid.

## Privacy

This application:
- ✅ Processes all data locally in your browser
- ✅ Never uploads any files or data
- ✅ Works completely offline after first load
- ✅ Stores data only in your browser's private storage (OPFS)

## License

MIT License - See [LICENSE](LICENSE) for details.

---

Made with ❤️ for D365FO developers
