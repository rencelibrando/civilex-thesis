import sys
import subprocess
from pathlib import Path
import yaml

def main():
    # 1. Resolve Config Path
    config_candidates = [
        Path(__file__).parent / "config.yaml",
        Path.cwd() / "config.yaml",
        Path.cwd() / "service-rag-python" / "finetune" / "config.yaml",
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
        print(f" Error: Merged model directory '{merged_dir}' not found.")
        print("Please run 'python merge_lora.py' first to merge your LoRA adapters.")
        sys.exit(1)

    print("==================================================================")
    print(" CIVIL-LEX: Standard GGUF Export for LM Studio / llama.cpp")
    print(f" Source Merged Model: {merged_dir}")
    print(f" Destination GGUF:   {gguf_dir}")
    print("==================================================================")

    gguf_dir.mkdir(parents=True, exist_ok=True)
    out_file = gguf_dir / "gemma-4-e4b-civil-code-f16.gguf"
    quant_file = gguf_dir / "gemma-4-e4b-civil-code-q4_k_m.gguf"

    # Check if llama.cpp converter is available locally
    llama_cpp_dir = Path(__file__).parent / "llama.cpp"
    convert_script = llama_cpp_dir / "convert_hf_to_gguf.py"

    if not convert_script.exists():
        print("⬇Cloning official llama.cpp for GGUF conversion...")
        try:
            subprocess.run(
                ["git", "clone", "--depth", "1", "https://github.com/ggerganov/llama.cpp.git", str(llama_cpp_dir)],
                check=True,
            )
        except Exception as e:
            print(f"Could not automatically clone llama.cpp: {e}")
            print("\nManual conversion instructions:")
            print("  1. git clone https://github.com/ggerganov/llama.cpp.git")
            print("  2. pip install -r llama.cpp/requirements.txt")
            print(f"  3. python llama.cpp/convert_hf_to_gguf.py {merged_dir} --outfile {out_file} --outtype bf16")
            print(f"  4. ./llama.cpp/build/bin/llama-quantize {out_file} {quant_file} q4_k_m")
            return

    # Run conversion to GGUF
    print(f"⚡ Converting Hugging Face BF16 weights to GGUF: {out_file}...")
    try:
        subprocess.run(
            [
                sys.executable,
                str(convert_script),
                str(merged_dir),
                "--outfile",
                str(out_file),
                "--outtype",
                "bf16",
            ],
            check=True,
        )
        print(f"Full precision GGUF created at: {out_file}")
    except subprocess.CalledProcessError as e:
        print(f" Conversion failed: {e}")
        return

    # Check for llama-quantize binary to create Q4_K_M
    quant_bin_candidates = [
        llama_cpp_dir / "build" / "bin" / "llama-quantize",
        llama_cpp_dir / "llama-quantize",
    ]
    quant_bin = next((p for p in quant_bin_candidates if p.exists()), None)
    if quant_bin:
        print(f"Quantizing GGUF to Q4_K_M for LM Studio: {quant_file}...")
        try:
            subprocess.run([str(quant_bin), str(out_file), str(quant_file), "q4_k_m"], check=True)
            print(f"Quantized GGUF created at: {quant_file}")
            print(f"Drag '{quant_file}' directly into LM Studio to run!")
        except Exception as e:
            print(f"Quantization step skipped: {e}")
    else:
        print("\nNote: To create 4-bit (Q4_K_M) GGUF for LM Studio:")
        print(f"  cd {llama_cpp_dir} && cmake -B build && cmake --build build --target llama-quantize -j")
        print(f"  ./build/bin/llama-quantize {out_file} {quant_file} q4_k_m")

if __name__ == "__main__":
    main()
