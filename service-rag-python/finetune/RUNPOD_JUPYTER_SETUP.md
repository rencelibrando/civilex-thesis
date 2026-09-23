# CIVIL-LEX: RunPod NVIDIA H100 SXM (80GB) Fine-Tuning & Jupyter Guide

This guide provides complete, step-by-step instructions for deploying an **NVIDIA H100 SXM (80GB Hopper)** pod on RunPod, setting up the Python environment, configuring persistent storage to prevent disk overflows, and running the fine-tuning pipeline inside **JupyterLab / Jupyter Notebooks** with zero crashes.

---

## 1. RunPod Pod Deployment Specification

When deploying your Pod on [RunPod.io](https://www.runpod.io):

| Setting | Recommended Value | Reason |
| :--- | :--- | :--- |
| **GPU Type** | **1x NVIDIA H100 SXM (80GB)** | Hopper SM90 architecture, 3.35 TB/s HBM3 memory bandwidth. |
| **Template** | **RunPod PyTorch 2.4+ (CUDA 12.4 / Ubuntu 22.04)** | Pre-installs PyTorch built with CUDA 12.4 and cuDNN 9. |
| **Container Disk** | **40 GB - 50 GB** | Accommodates OS packages, libraries, and compiler toolchains. |
| **Volume Disk (Persistent)** | **100 GB - 150 GB** | **Crucial:** Mounted at `/workspace`. Holds datasets, base models, and checkpoints. |
| **Expose HTTP Ports** | `8888` (JupyterLab) | Web-based interactive notebook interface. |

> [!IMPORTANT]
> Always attach at least **100 GB Volume Disk**. The root filesystem (`/`) in RunPod Docker containers is ephemeral and limited. Storing model weights and Hugging Face caches in `/workspace` prevents fatal `OSError: [Errno 28] No space left on device` crashes.

---

## 2. Environment Setup (JupyterLab & Terminal)

### Option A: Direct In-Jupyter Setup (Recommended)
You can open **JupyterLab** from your RunPod Console (`Connect` -> `Connect to Web Terminal / JupyterLab`).

Create a new Jupyter Notebook (`.ipynb`) in `/workspace/finetune/` and run the following cells:

#### Cell 1: Pre-Flight GPU & Hopper Architecture Verification
```python
import torch
import os
import sys

print(f"Python Version: {sys.version}")
print(f"PyTorch Version: {torch.__version__}")
print(f"CUDA Available: {torch.cuda.is_available()}")

if torch.cuda.is_available():
    gpu_name = torch.cuda.get_device_name(0)
    capability = torch.cuda.get_device_capability(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    bf16_supported = torch.cuda.is_bf16_supported()
    print(f"✅ Active GPU: {gpu_name}")
    print(f"✅ Compute Capability: sm_{capability[0]}{capability[1]} (Hopper SM90 = sm_90)")
    print(f"✅ Total VRAM: {vram_gb:.2f} GB")
    print(f"✅ Native BF16 Support: {bf16_supported}")
    assert capability[0] >= 8, "NVIDIA Ampere/Hopper GPU is required for BF16 fine-tuning."
else:
    raise SystemError("CUDA GPU not detected! Check RunPod GPU driver configuration.")
```

#### Cell 2: Configure Environment Variables & Disk Safety
```python
import os
from pathlib import Path

# 1. Prevent PyTorch CUDA memory fragmentation on Hopper Tensor Cores
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

# 2. Redirect Hugging Face cache to persistent /workspace volume to avoid root disk overflow
workspace_cache = Path("/workspace/.cache/huggingface")
workspace_cache.mkdir(parents=True, exist_ok=True)
os.environ["HF_HOME"] = str(workspace_cache)
os.environ["TRANSFORMERS_CACHE"] = str(workspace_cache / "hub")
os.environ["HF_DATASETS_CACHE"] = str(workspace_cache / "datasets")

# 3. Ensure unbuffered Python output for real-time streaming in Jupyter
os.environ["PYTHONUNBUFFERED"] = "1"

print(f"✅ HF_HOME redirected to: {os.environ['HF_HOME']}")
```

#### Cell 3: Hugging Face Authentication (Programmatic)
Gemma models require agreeing to license terms on Hugging Face.
```python
# Replace with your Hugging Face User Access Token (read permissions)
HF_TOKEN = "hf_your_token_here"

import os
os.environ["HF_TOKEN"] = HF_TOKEN

from huggingface_hub import login
login(token=HF_TOKEN, add_to_git_credential=False)
print("✅ Hugging Face authentication active.")
```

#### Cell 4: Install Dependencies
```python
# RunPod containers already have PyTorch + CUDA pre-installed.
# Install the fine-tuning stack into the container:
!pip install --no-cache-dir \
    "transformers>=4.48.0" \
    "trl>=0.12.0" \
    "peft>=0.13.0" \
    "accelerate>=1.0.0" \
    "datasets>=3.0.0" \
    "safetensors>=0.4.5" \
    "pyyaml>=6.0.0" \
    "sentencepiece>=0.2.0" \
    "protobuf>=4.25.0" \
    "huggingface_hub>=0.26.0" \
    "scipy>=1.11.0" \
    "bitsandbytes>=0.44.0" \
    "packaging" "ninja"

# Optional: Attempt to install FlashAttention-2 (finetune script automatically falls back to native SDPA if skipped)
!pip install flash-attn --no-build-isolation || echo "Proceeding with PyTorch native SDPA (equally fast on H100)"
```

---

### Option B: Terminal Setup (RunPod Web Terminal or SSH)

If you prefer using the RunPod Web Terminal:

```bash
# 1. Navigate to your workspace directory
cd /workspace
git clone https://github.com/your-username/civilex-thesis.git  # or upload your code
cd civilex-thesis/service-rag-python/finetune

# 2. Configure Environment Variables in your session
export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"
export HF_HOME="/workspace/.cache/huggingface"
export PYTHONUNBUFFERED=1

# 3. Authenticate with Hugging Face
huggingface-cli login
# Or export: export HF_TOKEN="hf_your_token_here"

# 4. Install Dependencies
pip install --no-cache-dir -r requirements.txt
```

> [!TIP]
> **Virtual Environments on RunPod**: The default Docker container is already an isolated environment with PyTorch pre-installed. If you want an isolated `venv`, you **must** use `--system-site-packages` so PyTorch and CUDA binaries are shared:
> ```bash
> python3 -m venv venv --system-site-packages
> source venv/bin/activate
> pip install -r requirements.txt
> ```

---

## 3. Running the Fine-Tuning Pipeline

### In a Jupyter Notebook Cell:
```python
# Launch training directly from Jupyter cell (note the leading exclamation mark '!'):
!python finetune_gemma4.py
```

### In RunPod Bash Terminal (Web Terminal / SSH):
```bash
# In standard terminal, run WITHOUT the exclamation mark:
python finetune_gemma4.py
```
*(Note: Typing `!python` in a bash shell triggers bash history expansion error `!python: event not found`. Use `!` only inside Jupyter notebook cells!)*

Or with custom parameter overrides if needed:
```bash
python finetune_gemma4.py --batch-size 8 --grad-accum 2 --epochs 3
```

### What the Hardened Script Guarantees:
1. **Zero Input Gradient Crashes**: Calls `model.enable_input_require_grads()` so PEFT LoRA + gradient checkpointing recomputes activations cleanly without `RuntimeError: element 0 of tensors does not require grad`.
2. **Zero Attention Crashes**: Checks for `flash_attn`. If missing or if CUDA kernel compilation errors occur, it seamlessly falls back to PyTorch native `sdpa` (Scaled Dot-Product Attention) which natively executes FlashAttention-2 kernels on Hopper SM90.
3. **Zero Bus Errors (`SIGBUS`)**: Automatically detects available `/dev/shm`. If limited in Docker, it disables multi-worker IPC queues (`dataloader_num_workers=0`), preventing container aborts.
4. **Zero Disk Overflow**: Automatically redirects model cache to `/workspace/.cache/huggingface` and enforces `save_total_limit=2` to keep only the best and latest checkpoints.
5. **Loss-Only on Assistant Responses**: Configures `DataCollatorForCompletionOnlyLM` to compute cross-entropy loss strictly on the legal answers, keeping prompt instructions unpenalized.

---

## 4. Post-Training: Merging LoRA Weights

After fine-tuning completes, merge the LoRA delta matrices directly into the base 16-bit BF16 weights:

```python
!python merge_lora.py
```

Output is saved to:
`/workspace/finetune/output/gemma-4-e4b-civil-code-lora-merged`

This merged model can now be:
- Served directly on RunPod via **vLLM** (`vllm serve output/gemma-4-e4b-civil-code-lora-merged --dtype bfloat16 --port 1234`).
- Converted to **GGUF** via `python export_gguf.py` for local inference in LM Studio or Ollama.

---

## 5. Troubleshooting & Crash Recovery

### Issue 1: `CUDA Out of Memory (OOM)`
- **Symptom**: `torch.cuda.OutOfMemoryError: CUDA out of memory.`
- **Cause**: Sequence length exceeded 2048 with too large batch size.
- **Resolution**:
  In `config.yaml` or CLI arguments:
  ```bash
  python finetune_gemma4.py --batch-size 4 --grad-accum 4
  ```
  This cuts activation memory in half while preserving the effective batch size of 16.

### Issue 2: Jupyter Kernel Retaining GPU Memory
- **Symptom**: GPU VRAM shows 30GB+ occupied before training even starts.
- **Cause**: A previous cell or interrupted training run did not release PyTorch memory from the Jupyter kernel process.
- **Resolution**:
  Run this cleanup cell:
  ```python
  import gc
  import torch
  gc.collect()
  torch.cuda.empty_cache()
  print(f"Allocated VRAM: {torch.cuda.memory_allocated(0) / (1024**2):.1f} MB")
  ```
  Or in JupyterLab: **Kernel -> Restart Kernel**.

### Issue 3: `401 Client Error / GatedRepoError`
- **Symptom**: `Cannot access gated repo for google/gemma-4-E4B-it`
- **Resolution**:
  1. Visit the model card on Hugging Face (e.g., `google/gemma-2-9b-it` or your designated Gemma repo) and accept the license terms.
  2. Provide your HF User Access Token via `login(token="...")` or `export HF_TOKEN="hf_..."`.

### Issue 4: `OSError: [Errno 28] No space left on device`
- **Symptom**: Disk full during base model download or saving checkpoint.
- **Resolution**:
  Ensure `HF_HOME` is set to `/workspace/.cache/huggingface` before importing transformers:
  ```bash
  df -h / /workspace
  ```
  Verify `/workspace` has 50GB+ free space.
