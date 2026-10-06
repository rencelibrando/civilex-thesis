"""
Script to upload fine-tuned model artifacts (Merged BF16 base weights and GGUF files)
directly to Hugging Face Hub from RunPod or local machine.
"""
import os
import sys
import argparse
from pathlib import Path
from huggingface_hub import HfApi, create_repo


def parse_args():
    parser = argparse.ArgumentParser(description="Upload CIVIL-LEX Model artifacts to Hugging Face Hub")
    parser.add_argument(
        "--repo-id",
        type=str,
        default="renzzyyy1028/civilex-gemma-4-e4b",
        help="Target Hugging Face repository ID (default: renzzyyy1028/civilex-gemma-4-e4b)",
    )
    parser.add_argument(
        "--token",
        type=str,
        default=os.environ.get("HF_TOKEN"),
        help="Hugging Face Write Token (defaults to HF_TOKEN env variable)",
    )
    parser.add_argument(
        "--folder",
        type=str,
        default=None,
        help="Specific folder to upload. If omitted, uploads merged model, GGUFs, and LoRA adapters.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Upload the entire 'output/' directory as-is preserving original folder structure.",
    )
    parser.add_argument(
        "--path-in-repo",
        type=str,
        default=None,
        help="Destination path in repo when using --folder (e.g. 'gguf' or root if omitted)",
    )
    parser.add_argument(
        "--private",
        action="store_true",
        help="Make repository private if creating a new one",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    token = args.token
    if not token:
        print(" Error: No Hugging Face token found.")
        print("Please export HF_TOKEN=\"your_write_token\" or pass --token <your_token>.")
        sys.exit(1)

    api = HfApi(token=token)

    # 1. Ensure target repo exists
    print(f" Verifying repository '{args.repo_id}' on Hugging Face...")
    try:
        create_repo(
            repo_id=args.repo_id,
            token=token,
            private=args.private,
            exist_ok=True,
            repo_type="model",
        )
        print(f" Repository ready: https://huggingface.co/{args.repo_id}")
    except Exception as e:
        print(f"Notice: Repo verification/creation note: {e}")

    # Determine output base directory
    script_dir = Path(__file__).resolve().parent
    candidates = [
        script_dir / "output",
        Path.cwd() / "output",
        Path("/workspace/finetune/output"),
        Path("/workspace/output"),
    ]
    output_dir = next((c for c in candidates if c.exists()), script_dir / "output")

    # Option: Upload entire output folder preserving exact structure
    if args.all:
        print(f"\nUploading entire output directory '{output_dir}' to '{args.repo_id}'...")
        api.upload_folder(
            folder_path=str(output_dir),
            repo_id=args.repo_id,
            repo_type="model",
            token=token,
        )
        print(f"✓ Entire output directory uploaded! https://huggingface.co/{args.repo_id}")
        return

    # Option: User provided a specific folder to upload
    if args.folder:
        folder_path = Path(args.folder).resolve()
        if not folder_path.exists():
            print(f"Error: Folder '{folder_path}' does not exist.")
            sys.exit(1)
        dest_msg = f"/{args.path_in_repo}" if args.path_in_repo else "root"
        print(f"\nUploading folder '{folder_path}' to '{args.repo_id}' ({dest_msg})...")
        api.upload_folder(
            folder_path=str(folder_path),
            path_in_repo=args.path_in_repo,
            repo_id=args.repo_id,
            repo_type="model",
            token=token,
        )
        print(f" Upload finished! https://huggingface.co/{args.repo_id}")
        return

    merged_dir = output_dir / "gemma-4-e4b-civil-code-lora-merged"
    gguf_dir = output_dir / "gemma-4-e4b-civil-code-lora-gguf"
    lora_dir = output_dir / "gemma-4-e4b-civil-code-lora"

    uploaded_anything = False

    # 1. Upload Merged Base Weights (Transformers format) to ROOT
    if merged_dir.exists():
        print(f"\n[1/3] Uploading Merged BF16 Model to root of '{args.repo_id}'...")
        api.upload_folder(
            folder_path=str(merged_dir),
            repo_id=args.repo_id,
            repo_type="model",
            token=token,
        )
        print("✓ Merged model uploaded successfully (Hugging Face Transformers compatible).")
        uploaded_anything = True
    else:
        print(f" Merged model not found at '{merged_dir}', skipping.")

    # 2. Upload GGUF models into 'gguf/' subfolder
    if gguf_dir.exists():
        print(f"\n [2/3] Uploading GGUF Quantizations to '{args.repo_id}/gguf'...")
        api.upload_folder(
            folder_path=str(gguf_dir),
            path_in_repo="gguf",
            repo_id=args.repo_id,
            repo_type="model",
            token=token,
        )
        print("✓ GGUF models uploaded successfully to /gguf (LM Studio & Ollama ready).")
        uploaded_anything = True
    else:
        print(f" GGUF models not found at '{gguf_dir}', skipping.")

    # 3. Upload LoRA Adapter weights into 'lora/' subfolder
    if lora_dir.exists():
        print(f"\n [3/3] Uploading LoRA Adapters to '{args.repo_id}/lora'...")
        api.upload_folder(
            folder_path=str(lora_dir),
            path_in_repo="lora",
            repo_id=args.repo_id,
            repo_type="model",
            token=token,
            ignore_patterns=["checkpoint-*"],  # Ignore intermediate checkpoints to save time
        )
        print(" LoRA adapters uploaded successfully to /lora.")
        uploaded_anything = True
    else:
        print(f" LoRA adapter directory not found at '{lora_dir}', skipping.")

    if not uploaded_anything:
        print(f"\n No models found in '{output_dir}'. Available items:")
        if output_dir.exists():
            for item in output_dir.glob("*"):
                print(f"  - {item}")
        else:
            print(f"  Directory '{output_dir}' does not exist.")
        sys.exit(1)

    print("\n All uploads completed successfully!")
    print(f" View your model on Hugging Face: https://huggingface.co/{args.repo_id}")


if __name__ == "__main__":
    main()
