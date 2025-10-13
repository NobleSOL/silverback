🦍 Silverback DEX



Silverback is a high-performance AMM DEX built natively on Solana, designed for speed, transparency, and simplicity.

It features a modular on-chain router written in Rust (Anchor), a Node.js backend API, and a Next.js frontend DEX interface.



The current version runs fully on Solana localnet / devnet.

Integration for the Keeta Network (Solana-compatible Layer 1) will follow next, enabling cross-chain liquidity and routing.



⚙️ Project Structure

silverback/

├── backend/                 # Express API for on-chain interaction

│   ├── server.js            # Main backend server

│   ├── utils/               # Helpers for connection + instructions

│   └── functions/           # Route logic (initialize, createPool, swap, etc.)

│

├── programs/

│   └── silverback-router/   # On-chain AMM router program (Anchor / Rust)

│       ├── Cargo.toml

│       └── src/lib.rs

│

├── silverback-dex/          # Next.js frontend for the DEX UI

│   ├── src/

│   ├── pages/

│   └── public/

│

├── target/                  # Anchor build outputs

└── Anchor.toml              # Anchor configuration



🧠 Core Features



🧩 On-Chain Router (Anchor):



Pool creation (create\_pool)



Add / remove liquidity



Swap tokens (swap)



Initialization (initialize)



⚡ Backend API (Node / Express):



POST /api/initialize

POST /api/createPool

POST /api/addLiquidity

POST /api/removeLiquidity

POST /api/swap





💻 Frontend (Next.js):

Modern DEX interface for connecting wallets, viewing pools, and executing swaps via backend endpoints.



🧰 Setup

1️⃣ Prerequisites



Node.js ≥ 18



Rust + Solana CLI + Anchor CLI



Git + Yarn or npm



2️⃣ Clone \& Install

git clone https://github.com/NobleSOL/silverback.git

cd silverback

npm install



3️⃣ Build \& Deploy the On-Chain Program

cd silverback-router

anchor build

anchor deploy





The program ID is defined in lib.rs and backend/server.js.



4️⃣ Start the Backend API

cd backend

node server.js





Runs on http://localhost:3000



5️⃣ Launch the Frontend

cd silverback-dex

npm run dev





Runs on http://localhost:3001



🔌 API Reference

Endpoint	Description	Example

POST /api/initialize	Initializes the program	curl -X POST http://localhost:3000/api/initialize

POST /api/createPool	Creates a liquidity pool	curl -X POST http://localhost:3000/api/createPool -H "Content-Type: application/json" -d '{"tokenA":"So111...","tokenB":"9n4nb..."}'

POST /api/addLiquidity	Adds liquidity	curl -X POST http://localhost:3000/api/addLiquidity -d '{"pool":"<poolPubkey>","amountA":"1000","amountB":"1000"}'

POST /api/swap	Swaps tokens	curl -X POST http://localhost:3000/api/swap -d '{"pool":"<poolPubkey>","amountIn":"500","isAtoB":true}'

POST /api/removeLiquidity	Removes liquidity	curl -X POST http://localhost:3000/api/removeLiquidity -d '{"pool":"<poolPubkey>","amountA":"500","amountB":"500"}'

🧪 Local Dev Commands Cheat Sheet

Command	Description

anchor build	Build Anchor program

anchor deploy	Deploy to local validator

anchor test	Run Anchor tests

solana-test-validator	Start local validator

solana logs <PROGRAM\_ID>	Stream program logs

solana airdrop 2	Airdrop 2 SOL to wallet

node backend/server.js	Start backend server

npm run dev	Start frontend DEX UI

git add . \&\& git commit -m "message" \&\& git push	Commit + push changes

🔒 Security Notes



Never commit private keys or .env files.



Anchor wallet path:



const walletPath = process.env.ANCHOR\_WALLET || "/home/taylo/.config/solana/id.json";





For production, replace the local RPC with a secure Keeta or Solana RPC endpoint.



🧭 Next Steps



&nbsp;Integrate Keeta Network RPC + wallet adapter



&nbsp;Display real-time pool and swap data in frontend



&nbsp;Add token decimals, price curve logic



&nbsp;Deploy UI + API to testnet



🦍 Silverback Vision



Silverback is the first step toward a fully modular, Keeta-native AMM — an ecosystem designed for low latency, transparency, and scalability.

The Solana version forms the foundation for cross-chain vaults, staking, and volume-generating tools under the Silverback Labs umbrella.



🧑‍💻 Author



NobleSOL / Silverback Labs

🔗 https://github.com/NobleSOL

