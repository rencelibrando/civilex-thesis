import os
import requests
from dotenv import load_dotenv

load_dotenv('service-rag-python/.env')
key = os.getenv('GEMINI_API_KEY')

gemini_payload = {
    "contents": [{"role": "user", "parts": [{"text": "Hello"}]}],
}
url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key={key}"
r = requests.post(url, json=gemini_payload)
print(r.status_code, r.text)

url2 = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:streamGenerateContent?key={key}"
r2 = requests.post(url2, json=gemini_payload)
print(r2.status_code, r2.text)
