# D365FO Label Explorer

🏷️ **Ultra-fast label file explorer for Microsoft Dynamics 365 Finance & Operations**

A 100% client-side web application for searching and exploring label files (`.label.txt`) from D365FO. All processing happens locally in your browser - no data is ever sent to a server.

**No build tools required** - runs directly in the browser with vanilla JavaScript.

## Features

- ⚡ **Blazing Fast Search** - Under 200ms even with 100k+ labels using FlexSearch
- 🔍 **Fuzzy Search** - Find labels even with typos
- 📋 **One-Click Copy** - Copy `@Prefix:LabelId` format instantly
- 🌍 **Multi-Culture Support** - Browse labels across all cultures (en-US, pt-BR, etc.)
- 💾 **Persistent Sessions** - Your folder selection is remembered
- 🔒 **100% Private** - All processing happens locally in your browser
- 📦 **Zero Build Dependencies** - No npm, no bundler, just HTML/CSS/JS

## Quick Start

### Option 1: GitHub Pages (Recommended)
Just open the hosted version - it works immediately!

### Option 2: Local Development
Due to browser security restrictions (CORS), you need a local server for ES modules:

1. Install the **Live Server** extension in VS Code
2. Open the `src` folder
3. Right-click `index.html` → "Open with Live Server"

Or use any static server:
```bash
# Python
python -m http.server 3000 --directory src

# Node.js (npx, no install needed)
npx http-server src -p 3000
```

Then open `http://localhost:3000` in your browser.

## Usage

1. Open the application in Chrome or Edge (86+)
2. Click "Select D365FO Folder"
3. Navigate to your `PackagesLocalDirectory` folder (typically `K:\AosService\PackagesLocalDirectory\`)
4. Wait for indexing to complete
5. Start searching!

## Browser Requirements

| Browser | Supported | Notes |
|---------|-----------|-------|
| Chrome | ✅ 86+ | Full support |
| Edge | ✅ 86+ | Full support |
| Firefox | ❌ | No File System Access API |
| Safari | ❌ | No File System Access API |

## Project Structure

```
src/
├── index.html          # Main HTML file
├── styles.css          # Dark theme styles
├── app.js              # Main application (ES Module)
├── favicon.svg         # App icon
├── libs/
│   └── flexsearch.bundle.min.js  # Search library
├── core/
│   ├── db.js           # IndexedDB wrapper
│   ├── file-access.js  # File System Access API
│   └── search.js       # FlexSearch integration
├── workers/
│   └── parser.worker.js # Label file parser
└── utils/
    ├── clipboard.js    # Copy functionality
    ├── debounce.js     # Performance utilities
    ├── highlight.js    # Search highlighting
    └── toast.js        # Notifications
```

## How It Works

1. **Folder Selection** - Uses the File System Access API to read your local D365FO installation
2. **Discovery** - Automatically finds all `AxLabelFile/LabelResources` folders
3. **Parsing** - Web Workers parse `.label.txt` files without blocking the UI
4. **Indexing** - Labels are indexed with FlexSearch for instant search
5. **Storage** - IndexedDB stores parsed labels for instant reload

## Label File Format

The application parses D365FO label files with this structure:

```
LabelId=Translated text content
 ;Optional help text for the label
 ;Can span multiple lines
AnotherLabel=Another translation
```

## Deployment

The `src/` folder can be deployed directly to any static hosting:

- **GitHub Pages** - Just point to the `src/` folder
- **Netlify** - Deploy `src/` folder
- **Vercel** - Deploy `src/` folder  
- **Any web server** - Serve the `src/` folder

No build step needed!

## Technical Stack

- **Vanilla JavaScript** - ES Modules, no frameworks
- **FlexSearch** - Full-text search engine (bundled locally)
- **Web Workers** - Non-blocking file parsing
- **IndexedDB** - Persistent local storage
- **File System Access API** - Local folder access

## Privacy

This application:
- ✅ Processes all data locally in your browser
- ✅ Never uploads any files or data
- ✅ Works completely offline after first load
- ✅ Stores data only in your browser's IndexedDB

## License

MIT License - See [LICENSE](LICENSE) for details.

---

Made with ❤️ for D365FO developers
