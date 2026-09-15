#!/bin/bash

# CIVIL-LEX RAG Python Service Runner

echo "Starting CIVIL-LEX Python RAG Service..."

# Navigate to the correct directory
cd "$(dirname "$0")"

# Activate the virtual environment
if [ -d ".venv" ]; then
    source .venv/bin/activate
    echo "Virtual environment activated."
else
    echo "Error: Virtual environment (.venv) not found!"
    exit 1
fi

# Make sure we have the latest environment variables loaded
if [ ! -f ".env" ]; then
    echo "Warning: .env file not found. Make sure your GEMINI_API_KEY is set!"
fi

# Run the uvicorn server
echo "Starting Uvicorn server on port 8000..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
