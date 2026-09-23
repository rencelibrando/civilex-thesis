import sys
import json
import subprocess
from pathlib import Path
import yaml

# Guard against broken torchvision/torchaudio extensions crashing imports
sys.modules["torchvision"] = None
sys.modules["torchvision.io"] = None
sys.modules["torchvision.ops"] = None
sys.modules["torchaudio"] = None
sys.modules["torchaudio._extension"] = None


def sanitize_tokenizer_config(model_dir: Path) -> None:
    """Sanitizes tokenizer_config.json to prevent AttributeError on extra_special_tokens."""
    tok_cfg_path = model_dir / "tokenizer_config.json"
    if not tok_cfg_path.exists():
        return
    try:
        with open(tok_cfg_path, "r", encoding="utf-8") as f:
            tok_cfg = json.load(f)
        if "extra_special_tokens" in tok_cfg and isinstance(tok_cfg["extra_special_tokens"], list):
            print(f"🔧 Sanitizing {tok_cfg_path.name}: removing 'extra_special_tokens' list...")
            tok_cfg.pop("extra_special_tokens", None)
            with open(tok_cfg_path, "w", encoding="utf-8") as f:
                json.dump(tok_cfg, f, indent=2)
            print("Tokenizer config sanitized.")
    except Exception as e:
        print(f"Warning: Could not check/sanitize tokenizer_config.json: {e}")


def patch_preprocessor_config(model_dir: Path) -> None:
    """Ensures preprocessor_config.json contains image_mean and image_std to prevent KeyError."""
    prep_path = model_dir / "preprocessor_config.json"
    cfg = {}
    if prep_path.exists():
        try:
            with open(prep_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception:
            cfg = {}

    cfg.setdefault("image_mean", [0.5, 0.5, 0.5])
    cfg.setdefault("image_std", [0.5, 0.5, 0.5])
    cfg.setdefault("size", {"height": 896, "width": 896})

    with open(prep_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    print("✓ Patched preprocessor_config.json with vision normalization parameters.")


def main():
    config_candidates = [
        Path(__file__).parent / "config.yaml",
        Path.cwd() / "config.yaml",
        Path("/workspace/finetune/config.yaml"),
        Path("/workspace/config.yaml"),
    ]
    config_path = next((p for p in config_candidates if p.exists()), None)

    if config_path:
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        lora_dir = config["training"]["output_dir"]
        if not Path(lora_dir).is_absolute():
            lora_dir = str((config_path.parent / lora_dir).resolve())
    else:
        lora_dir = "./output/gemma-4-e4b-civil-code-lora"

    merged_dir = Path(f"{lora_dir}-merged")
    gguf_dir = Path(f"{lora_dir}-gguf")

    if not merged_dir.exists():
        print(f"❌ Error: Merged model directory '{merged_dir}' not found.")
        print("Please run 'python merge_lora.py' first.")
        sys.exit(1)

    print("==================================================================")
    print(" CIVIL-LEX: Full Pipeline (Text-Only GGUF + Separated mmproj)")
    print(f" Source Merged Model: {merged_dir}")
    print(f" Destination GGUF:    {gguf_dir}")
    print("==================================================================")

    gguf_dir.mkdir(parents=True, exist_ok=True)

    text_bf16_file = gguf_dir / "gemma-4-e4b-civil-code-bf16.gguf"
    text_q4_file   = gguf_dir / "gemma-4-e4b-civil-code-q4_k_m.gguf"
    mmproj_file    = gguf_dir / "mmproj-gemma-4-e4b-civil-code-f16.gguf"

    llama_cpp_dir = Path(__file__).parent / "llama.cpp"
    convert_script = llama_cpp_dir / "convert_hf_to_gguf.py"

    # Pre-conversion metadata patches
    sanitize_tokenizer_config(merged_dir)
    patch_preprocessor_config(merged_dir)

    # -------------------------------------------------------------------------
    # PASS 1: Extract Multimodal Projector (mmproj) GGUF
    # -------------------------------------------------------------------------
    print(f"\n⚡ [1/3] Extracting Multimodal Projector: {mmproj_file.name}...")
    mmproj_cmd = [
        sys.executable,
        str(convert_script),
        str(merged_dir),
        "--outfile",
        str(mmproj_file),
        "--mmproj",
        "--outtype",
        "f16",
    ]
    subprocess.run(mmproj_cmd, check=True)
    print(f"✓ Multimodal projector created: {mmproj_file.name}")

    # -------------------------------------------------------------------------
    # PASS 2: Convert Language Model to Text-Only BF16 GGUF
    # -------------------------------------------------------------------------
    print("\n⚡ [2/3] Converting Text Model weights to GGUF (BF16)...")
    text_cmd = [
        sys.executable,
        str(convert_script),
        str(merged_dir),
        "--outfile",
        str(text_bf16_file),
        "--outtype",
        "bf16",
    ]
    subprocess.run(text_cmd, check=True)
    print(f"✓ Full-precision text model created: {text_bf16_file.name}")

    # -------------------------------------------------------------------------
    # PASS 3: Quantize Text Model to Q4_K_M
    # -------------------------------------------------------------------------
    quant_bin_candidates = [
        llama_cpp_dir / "build" / "bin" / "llama-quantize",
        llama_cpp_dir / "llama-quantize",
    ]
    quant_bin = next((p for p in quant_bin_candidates if p.exists()), None)

    if not quant_bin:
        print("\n🔧 Building llama-quantize binary...")
        build_dir = llama_cpp_dir / "build"
        subprocess.run(["cmake", "-B", str(build_dir), str(llama_cpp_dir)], check=True)
        subprocess.run(["cmake", "--build", str(build_dir), "--target", "llama-quantize", "-j"], check=True)
        quant_bin = build_dir / "bin" / "llama-quantize"

    print(f"\n⚡ [3/3] Quantizing Text Model to Q4_K_M: {text_q4_file.name}...")
    subprocess.run([str(quant_bin), str(text_bf16_file), str(text_q4_file), "q4_k_m"], check=True)
    print(f"✓ Quantized text model created: {text_q4_file.name}")

    print("\n==================================================================")
    print(" Export Summary (All 3 Files Present):")
    print(f"  1. Text Model (BF16 Full):        {text_bf16_file.name}")
    print(f"  2. Text Model (Q4_K_M Quantized): {text_q4_file.name}")
    print(f"  3. Vision Projector (mmproj):     {mmproj_file.name}")
    print(f" Target Folder: {gguf_dir}")
    print("==================================================================")


if __name__ == "__main__":
    main()