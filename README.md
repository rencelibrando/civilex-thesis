# Civilex Thesis Project

Welcome to the **Civilex** project repository! This project is a comprehensive thesis application designed with a modern web architecture, featuring a React frontend, an Express Node.js backend, and a specialized Python RAG (Retrieval-Augmented Generation) service.

## Project Structure

This repository acts as the main hub for the project's source code, which is organized into distinct branches and services:

### 1. Frontend (`frontend` branch)
The user interface is built using modern web technologies to ensure a fast, responsive, and aesthetically pleasing experience.
- **Framework**: Next.js (v16+)
- **UI Library**: React (v19+)
- **Styling**: Tailwind CSS (v4)
- **Features**: App Router, optimized fonts via `next/font`, and interactive components (using `lucide-react`).

### 2. Backend (`backend` branch)
The core business logic and API routing are handled by a lightweight Node.js server.
- **Framework**: Express.js
- **Features**: RESTful API architecture, CORS enabled for cross-origin requests, environment variable management via `dotenv`.

### 3. Service RAG (Hugging Face)
The Python-based RAG (Retrieval-Augmented Generation) service handles AI capabilities and large vector datasets. Due to file size constraints, this service is hosted separately on Hugging Face.
- **Branch Reference**: See the `service-rag-hf-link` branch.
- **Repository**: [View on Hugging Face](https://huggingface.co/spaces/renzzyyy1028/civilex-RAG)

---

## Branching Strategy

To keep the repository clean and manageable, the code is split into specific branches:
- `main` - Main hub and overall project documentation (you are here).
- `frontend` - Contains only the Next.js frontend code and UI assets.
- `backend` - Contains only the Express Node.js backend code.
- `service-rag-hf-link` - Contains a reference README pointing to the Hugging Face repository for the AI/RAG service.

## Getting Started

To run any part of this project locally, switch to the respective branch and follow the setup instructions located in that branch's directory.

**Example for Frontend:**
```bash
git checkout frontend
cd frontend
npm install
npm run dev
```

**Example for Backend:**
```bash
git checkout backend
cd backend-node
npm install
npm run dev
```
