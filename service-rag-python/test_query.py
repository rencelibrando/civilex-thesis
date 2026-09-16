import asyncio
from typing import Optional
from main import embed_and_search

async def main():
    print("Testing with 'Identify key legal risks'")
    results = await asyncio.to_thread(embed_and_search, "Identify key legal risks", "test_doc_id")
    print(f"Results: {len(results)}")

if __name__ == "__main__":
    asyncio.run(main())
