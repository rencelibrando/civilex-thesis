import sys

# 1. Guard against broken torchvision/torchaudio binary extensions
# Setting these in sys.modules before any imports prevents Hugging Face transformers/peft
# from attempting to load mismatched C++ shared libraries (.so files).
sys.modules["torchvision"] = None
sys.modules["torchvision.io"] = None
sys.modules["torchvision.ops"] = None
sys.modules["torchaudio"] = None
sys.modules["torchaudio._extension"] = None

import os
import json
import argparse
from pathlib import Path
import yaml
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

# Redirect Hugging Face cache to persistent /workspace if on RunPod
if Path("/workspace").exists():
    workspace_cache = Path("/workspace/.cache/huggingface")
    try:
        workspace_cache.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("HF_HOME", str(workspace_cache))
    except Exception:
        pass


def sanitize_tokenizer_config(model_dir: Path) -> None:
    """Sanitizes tokenizer_config.json to prevent AttributeError on extra_special_tokens list.

    In some transformers versions, if 'extra_special_tokens' is saved as a list,
    AutoTokenizer._set_model_specific_special_tokens expects a dict and crashes with:
        AttributeError: 'list' object has no attribute 'keys'
    """
    tok_cfg_path = model_dir / "tokenizer_config.json"
    if not tok_cfg_path.exists():
        return
    try:
        with open(tok_cfg_path, "r", encoding="utf-8") as f:
            tok_cfg = json.load(f)
        if "extra_special_tokens" in tok_cfg and isinstance(tok_cfg["extra_special_tokens"], list):
            tok_cfg.pop("extra_special_tokens", None)
            with open(tok_cfg_path, "w", encoding="utf-8") as f:
                json.dump(tok_cfg, f, indent=2)
            print("✓ Tokenizer config sanitized (removed incompatible 'extra_special_tokens' list).")
    except Exception as e:
        print(f"Warning: Could not check/sanitize tokenizer_config.json: {e}")


def parse_args():
    parser = argparse.ArgumentParser(description="Merge LoRA Adapters into Pure 16-Bit Base Model")
    parser.add_argument("--config", type=str, default=None, help="Path to config.yaml")
    parser.add_argument("--lora-dir", type=str, default=None, help="Override LoRA adapter directory")
    parser.add_argument("--output-dir", type=str, default=None, help="Override merged output directory")
    return parser.parse_args()


def main():
    args = parse_args()

    # 1. Resolve Config Path
    config_candidates = []
    if args.config:
        config_candidates.append(Path(args.config))
    config_candidates.extend([
        Path(__file__).parent / "config.yaml",
        Path.cwd() / "config.yaml",
        Path("/workspace/finetune/config.yaml"),
        Path("/workspace/config.yaml"),
        Path.cwd() / "service-rag-python" / "finetune" / "config.yaml",
    ])
    config_path = next((p for p in config_candidates if p.exists()), None)
    if not config_path:
        print("Error: config.yaml not found!")
        sys.exit(1)

    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    lora_dir = args.lora_dir or config["training"]["output_dir"]
    if not Path(lora_dir).is_absolute():
        candidate_lora = (config_path.parent / lora_dir).resolve()
        if candidate_lora.exists():
            lora_dir = str(candidate_lora)
        else:
            lora_dir = str(Path(lora_dir).resolve())

    merged_dir = args.output_dir or f"{lora_dir}-merged"
    base_model_name = config["model"]["name_or_path"]

    if not os.path.exists(lora_dir):
        print(f"Error: LoRA adapter directory '{lora_dir}' does not exist.")
        print(" Please run 'python finetune_gemma4.py' first to produce fine-tuned LoRA weights.")
        sys.exit(1)

    print("==================================================================")
    print(" CIVIL-LEX: Merging LoRA Adapters into Pure 16-Bit Base Model")
    print(f" Base Model:    {base_model_name}")
    print(f" LoRA Adapters: {lora_dir}")
    print(f" Destination:   {merged_dir}")
    print("==================================================================")

    hf_token = (
        os.environ.get("HF_TOKEN")
        or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        or os.environ.get("HUGGINGFACE_TOKEN")
    )

    # 2. Load Base Model in Pure BF16
    print("Loading base model weights in native BF16...")
    device_map = {"": torch.cuda.current_device()} if torch.cuda.is_available() else "auto"
    target_dtype = torch.bfloat16 if config["training"].get("bf16", True) else torch.float32
    load_kwargs = {
        "device_map": device_map,
        "token": hf_token,
        "trust_remote_code": True,
    }
    try:
        base_model = AutoModelForCausalLM.from_pretrained(
            base_model_name,
            dtype=target_dtype,
            **load_kwargs,
        )
    except TypeError:
        base_model = AutoModelForCausalLM.from_pretrained(
            base_model_name,
            torch_dtype=target_dtype,
            **load_kwargs,
        )

    print("Loading tokenizer and chat template...")
    tokenizer = AutoTokenizer.from_pretrained(
        lora_dir,
        token=hf_token,
        trust_remote_code=True,
    )

    # 3. Attach LoRA Adapter and Merge Losslessly
    print("Attaching fine-tuned LoRA adapter...")
    peft_model = PeftModel.from_pretrained(base_model, lora_dir)

    print("Merging LoRA deltas into base weights (lossless 16-bit operation)...")
    merged_model = peft_model.merge_and_unload()

    # 4. Save Standalone Model & Tokenizer
    os.makedirs(merged_dir, exist_ok=True)
    print(f"Saving merged standalone model to '{merged_dir}'...")
    merged_model.save_pretrained(merged_dir, safe_serialization=True)
    tokenizer.save_pretrained(merged_dir)
    sanitize_tokenizer_config(Path(merged_dir))

    print(f"Successfully exported merged model to {merged_dir}!")
    print("\nNext steps:")
    print("  • To serve via vLLM directly on RunPod/server (recommended for production):")
    print(f"      vllm serve {merged_dir} --dtype bfloat16 --port 1234")
    print("  • To export to GGUF for LM Studio / llama.cpp:")
    print("      python export_gguf.py")


if __name__ == "__main__":
    main()