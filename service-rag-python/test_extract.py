import sys
import os

# Append the service-rag-python directory to sys.path so we can import services
sys.path.append(os.path.abspath('/home/rence/Documents/github_repos/github-repositories-NS/civilex-thesis/service-rag-python'))

from services.document import extract_and_process_document

# Just test with a dummy image file URL
extract_and_process_document("https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/React-icon.svg/1200px-React-icon.svg.png", "test-doc-id", "test.png")
