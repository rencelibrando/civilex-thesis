import os
import sys
from pathlib import Path
import yaml
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

def main():
    # 1. Resolve Config Path
    config_candidates = [
        Path(__file__).parent / "config.yaml",
        Path.cwd() / "config.yaml",
        Path.cwd() / "service-rag-python" / "finetune" / "config.yaml",
    ]
    config_path = next((p for p in config_candidates if p.exists()), None)
    if not config_path:
        print(" Error: config.yaml not found!")
        sys.exit(1)

    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    lora_dir = config["training"]["output_dir"]
    if not Path(lora_dir).is_absolute():
        lora_dir = str((config_path.parent / lora_dir).resolve())

    merged_dir = f"{lora_dir}-merged"
    base_model_name = config["model"]["name_or_path"]

    if not os.path.exists(lora_dir):
        print(f" Error: LoRA adapter directory '{lora_dir}' does not exist.")
        print("Please run 'python finetune_gemma4.py' first to produce fine-tuned LoRA weights.")
        sys.exit(1)

    print("==================================================================")
    print(" CIVIL-LEX: Merging LoRA Adapters into Pure 16-Bit Base Model")
    print(f" Base Model: {base_model_name}")
    print(f"LoRA Adapters: {lora_dir}")
    print(f"Destination: {merged_dir}")
    print("==================================================================")

    # 2. Load Base Model in Pure BF16
    print(" Loading base model weights in native BF16...")
    base_model = AutoModelForCausalLM.from_pretrained(
        base_model_name,
        torch_dtype=torch.bfloat16 if config["training"].get("bf16", True) else torch.float32,
        device_map="auto",
        trust_remote_code=True,
    )

    print("Loading tokenizer and chat template...")
    tokenizer = AutoTokenizer.from_pretrained(lora_dir, trust_remote_code=True)

    # 3. Attach LoRA Adapter and Merge Losslessly
    print(" Attaching fine-tuned LoRA adapter...")
    peft_model = PeftModel.from_pretrained(base_model, lora_dir)

    print("Merging LoRA deltas into base weights (lossless 16-bit operation)...")
    merged_model = peft_model.merge_and_unload()

    # 4. Save Standalone Model & Tokenizer
    os.makedirs(merged_dir, exist_ok=True)
    print(f" Saving merged standalone model to '{merged_dir}'...")
    merged_model.save_pretrained(merged_dir, safe_serialization=True)
    tokenizer.save_pretrained(merged_dir)

    print(f"Successfully exported merged model to {merged_dir}!")
    print("\nNext steps:")
    print("  • To serve via vLLM directly on RunPod/server (recommended for production):")
    print(f"      vllm serve {merged_dir} --dtype bfloat16 --port 1234")
    print("  • To export to GGUF for LM Studio / llama.cpp:")
    print("      python export_gguf.py")

if __name__ == "__main__":
    main()
