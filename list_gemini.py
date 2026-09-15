import os
import requests
from dotenv import load_dotenv

load_dotenv('service-rag-python/.env')
key = os.getenv('GEMINI_API_KEY')

response = requests.get(f"https://generativelanguage.googleapis.com/v1beta/models?key={key}")
for m in response.json().get('models', []):
    print(m['name'])
