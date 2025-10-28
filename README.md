# Solscan

A TypeScript + Node.js application for Solana blockchain operations and crypto analysis.

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create environment file:
```bash
cp .env.example .env
```

3. Edit `.env` and configure your settings (optional - defaults to public Solana RPC)

### Development

Run in development mode with auto-reload:
```bash
npm run dev
```

### Build

Compile TypeScript to JavaScript:
```bash
npm run build
```

### Production

Run the compiled application:
```bash
npm start
```

## 📁 Project Structure

```
solscan/
├── src/
│   └── index.ts          # Main application entry point
├── dist/                 # Compiled JavaScript (generated)
├── .env                  # Environment variables (create from .env.example)
├── .env.example          # Environment variables template
├── package.json          # Project dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── README.md            # This file
```

## 🛠️ Available Scripts

- `npm run dev` - Run in development mode with ts-node
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run compiled application
- `npm run watch` - Watch mode for development
- `npm run clean` - Remove build artifacts

## 📦 Dependencies

- **@solana/web3.js** - Solana JavaScript API
- **axios** - HTTP client for API requests
- **dotenv** - Environment variable management
- **TypeScript** - Type-safe JavaScript

## 🔧 Configuration

Edit `tsconfig.json` to customize TypeScript compiler options.

Edit `.env` to configure:
- Solana RPC endpoints
- API keys
- Other application settings

## 📝 Next Steps

1. Install dependencies: `npm install`
2. Start coding in `src/index.ts`
3. Add more modules in the `src/` directory
4. Run with `npm run dev` to test your changes

## 🤝 Contributing

Feel free to fork, modify, and submit pull requests!

## 📄 License

MIT

