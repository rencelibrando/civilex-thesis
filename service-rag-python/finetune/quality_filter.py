import os
import sys
import json
import random
from collections import OrderedDict

RAW_DATASET_PATH = "train.jsonl" # from generate_deepseek_lima.py
TRAIN_OUTPUT_PATH = "train_clean.jsonl"
EVAL_OUTPUT_PATH = "eval.jsonl"
TRAIN_SPLIT_RATIO = 0.90

# We use a simple word count multiplier to estimate tokens (1 word ≈ 1.3 tokens)
MIN_TOKENS = 60 # relaxed minimum
MAX_TOKENS = 900

def estimate_tokens(text):
    return int(len(text.split()) * 1.3)

def is_quality_sample(sample):
    messages = sample.get("messages", [])
    if len(messages) < 3:
        return False, "Missing messages"

    user_msg = next((m for m in messages if m["role"] == "user"), None)
    assistant_msg = next((m for m in messages if m["role"] == "assistant"), None)
    
    if not user_msg or not assistant_msg:
        return False, "Missing user/assistant turn"
        
    content = assistant_msg.get("content", "").strip()
    if not content:
        return False, "Empty assistant response"
        
    # 1. Length Check
    tokens = estimate_tokens(content)
    if tokens < MIN_TOKENS or tokens > MAX_TOKENS:
        return False, f"Length out of bounds ({tokens} tokens)"
        
    # 2. Citation Check (T2 RAG Grounded)
    track = sample.get("track", "")
    if track == "rag_grounded":
        if "Sources:" not in content and "Sources**" not in content:
            return False, "Missing Sources section (T2)"
        if "This is for general information only" not in content:
            return False, "Missing disclaimer (T2)"
            
    # 3. Filipino Coherence (Basic Heuristic)
    if sample.get("language") == "fil":
        words = content.lower().split()
        # Common English stop words that shouldn't dominate a Filipino text
        eng_words = {"the", "and", "is", "in", "to", "of", "it", "that", "this", "for", "with", "as"}
        eng_count = sum(1 for w in words if w in eng_words)
        if len(words) > 0 and (eng_count / len(words)) > 0.40:
            return False, "Too many English stopwords in FIL response"

    return True, "Pass"


def main():
    if not os.path.exists(RAW_DATASET_PATH):
        print(f"❌ Error: {RAW_DATASET_PATH} not found.")
        sys.exit(1)
        
    unique_samples = OrderedDict()
    passed_count = 0
    rejected_count = 0
    rejection_reasons = {}

    print("🔍 Starting Quality Filter...")
    
    with open(RAW_DATASET_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try:
                sample = json.loads(line)
                
                # 4. Duplicate Check
                # Use user prompt + assistant response as unique signature
                user_msg = next((m for m in sample.get("messages", []) if m["role"] == "user"), {}).get("content", "")
                asst_msg = next((m for m in sample.get("messages", []) if m["role"] == "assistant"), {}).get("content", "")
                signature = hash(user_msg + asst_msg)
                
                if signature in unique_samples:
                    rejected_count += 1
                    rejection_reasons["Duplicate"] = rejection_reasons.get("Duplicate", 0) + 1
                    continue
                
                is_valid, reason = is_quality_sample(sample)
                if is_valid:
                    unique_samples[signature] = sample
                    passed_count += 1
                else:
                    rejected_count += 1
                    rejection_reasons[reason] = rejection_reasons.get(reason, 0) + 1
                    
            except json.JSONDecodeError:
                rejected_count += 1
                rejection_reasons["JSON Error"] = rejection_reasons.get("JSON Error", 0) + 1

    print("\n📊 Quality Filter Results:")
    print(f"Total Processed: {passed_count + rejected_count}")
    print(f"Passed: {passed_count} ({passed_count/(passed_count+rejected_count)*100:.1f}%)")
    print(f"Rejected: {rejected_count}")
    
    if rejected_count > 0:
        print("\nRejection Breakdown:")
        for reason, count in rejection_reasons.items():
            print(f"  - {reason}: {count}")

    # Shuffle and Split
    final_samples = list(unique_samples.values())
    random.seed(42) # For reproducibility
    random.shuffle(final_samples)
    
    train_size = int(len(final_samples) * TRAIN_SPLIT_RATIO)
    train_set = final_samples[:train_size]
    eval_set = final_samples[train_size:]
    
    with open(TRAIN_OUTPUT_PATH, "w", encoding="utf-8") as f:
        for sample in train_set:
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")
            
    with open(EVAL_OUTPUT_PATH, "w", encoding="utf-8") as f:
        for sample in eval_set:
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")

    print(f"\n💾 Saved {len(train_set)} samples to {TRAIN_OUTPUT_PATH}")
    print(f"💾 Saved {len(eval_set)} samples to {EVAL_OUTPUT_PATH}")
    print("✅ Quality filtering complete!")

if __name__ == "__main__":
    main()
