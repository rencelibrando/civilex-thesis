import os
import sys
import gc
import json
import argparse
from pathlib import Path
import yaml
import torch

# Ensure real-time unbuffered output in JupyterLab and terminals
os.environ.setdefault("PYTHONUNBUFFERED", "1")

try:
    from packaging import version as pkg_version
except ImportError:
    print("Error: 'packaging' library not found. Please run: pip install packaging")
    sys.exit(1)


# 1. Critical Environment & Memory Safety on NVIDIA H100 SXM (Hopper SM90)

# Prevent CUDA memory fragmentation on Hopper GPUs during long training runs
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

# Avoid exhausting container root disk (often 20GB) by redirecting Hugging Face
# cache to the persistent /workspace network storage if present on RunPod.
if Path("/workspace").exists():
    workspace_cache = Path("/workspace/.cache/huggingface")
    try:
        workspace_cache.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("HF_HOME", str(workspace_cache))
        os.environ.setdefault("TRANSFORMERS_CACHE", str(workspace_cache / "hub"))
        os.environ.setdefault("HF_DATASETS_CACHE", str(workspace_cache / "datasets"))
    except Exception:
        pass

# Enable high-throughput TF32 matmul and cuDNN on NVIDIA H100 (Hopper Tensor Cores)
if torch.cuda.is_available():
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True


def get_safe_dataloader_workers(requested_workers: int = 2) -> int:
    """Inspects /dev/shm to prevent DataLoader worker SIGBUS crashes in Docker."""
    if not sys.platform.startswith("linux") or requested_workers <= 0:
        return 0
    try:
        shm_stat = os.statvfs("/dev/shm")
        shm_free_mb = (shm_stat.f_bavail * shm_stat.f_frsize) / (1024 * 1024)
        if shm_free_mb < 2048:
            print(f"Notice: /dev/shm is limited ({shm_free_mb:.0f} MB available).")
            print("   Setting dataloader_num_workers=0 to prevent PyTorch Bus Error (SIGBUS).")
            return 0
    except Exception:
        return 0
    return requested_workers


def safe_kwargs(cls, kwargs: dict) -> dict:
    """Returns only the kwargs that are accepted by cls.__init__, logging any dropped ones.

    This is the universal guard against TypeError: unexpected keyword argument errors
    when running across different library versions (transformers, trl, peft).
    """
    import inspect
    try:
        sig = inspect.signature(cls.__init__).parameters
    except (ValueError, TypeError):
        return kwargs  # can't introspect; pass everything and hope for the best

    # 'kwargs' and 'self' are variadic — if present, accept everything
    for param in sig.values():
        if param.kind in (inspect.Parameter.VAR_KEYWORD,):
            return kwargs

    accepted = {k: v for k, v in kwargs.items() if k in sig}
    dropped = [k for k in kwargs if k not in sig]
    if dropped:
        print(f"ℹ{cls.__name__}: skipping unsupported args {dropped}")
    return accepted


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


def find_file(filename: str, search_paths: list[str]) -> str:
    """Locates a target file across candidate search paths."""
    for p in search_paths:
        candidate = Path(p) / filename if not Path(p).is_file() else Path(p)
        if candidate.exists() and candidate.is_file():
            return str(candidate.resolve())
    raise FileNotFoundError(f"Could not locate '{filename}' in search paths: {search_paths}")


def resolve_dataset_paths(config: dict) -> tuple[str, str]:
    """Resolves train and evaluation JSONL files robustly across directories."""
    script_dir = Path(__file__).parent.resolve()
    repo_root = script_dir.parent.parent.resolve()

    candidate_train_dirs = [
        str(script_dir),
        str(Path.cwd()),
        "/workspace/finetune",
        "/workspace",
        str(script_dir.parent / "data" / "traning"),
        str(repo_root / "service-rag-python" / "data" / "traning"),
        str(repo_root / "service-rag-python" / "finetune"),
        str(repo_root / "data" / "traning"),
    ]
    candidate_eval_dirs = [
        str(script_dir),
        str(Path.cwd()),
        "/workspace/finetune",
        "/workspace",
        str(repo_root / "service-rag-python" / "finetune"),
    ]

    dataset_cfg = config.get("dataset", {}) if isinstance(config, dict) else {}
    train_filename = dataset_cfg.get("train_file", "train_clean_ragas.jsonl")
    eval_filename = dataset_cfg.get("eval_file", "eval_ragas_clean.jsonl")

    train_path = find_file(train_filename, candidate_train_dirs)
    eval_path = find_file(eval_filename, candidate_eval_dirs)
    return train_path, eval_path


def parse_args():
    parser = argparse.ArgumentParser(description="CIVIL-LEX Fine-Tuning Pipeline (H100 Optimized)")
    parser.add_argument("--config", type=str, default=None, help="Path to custom config.yaml")
    parser.add_argument("--model", type=str, default=None, help="Override model name or HuggingFace ID")
    parser.add_argument("--batch-size", type=int, default=None, help="Override per-device train batch size")
    parser.add_argument("--grad-accum", type=int, default=None, help="Override gradient accumulation steps")
    parser.add_argument("--epochs", type=int, default=None, help="Override number of train epochs")
    return parser.parse_args()



# Standalone Completion-Only Data Collator (Immune to TRL Version Differences)

def get_completion_collator_class():
    """Dynamically resolves DataCollatorForCompletionOnlyLM across all TRL versions."""
    # 1. Try trl top-level import
    try:
        from trl import DataCollatorForCompletionOnlyLM as _DC
        return _DC
    except (ImportError, AttributeError):
        pass

    # 2. Try trl.trainer import
    try:
        from trl.trainer import DataCollatorForCompletionOnlyLM as _DC
        return _DC
    except (ImportError, AttributeError):
        pass

    # 3. Try trl.trainer.utils import
    try:
        from trl.trainer.utils import DataCollatorForCompletionOnlyLM as _DC
        return _DC
    except (ImportError, AttributeError):
        pass

    # 4. Standalone implementation (guarantees zero crashes on any Python/TRL version)
    from transformers import DataCollatorForLanguageModeling

    class StandaloneCompletionOnlyCollator(DataCollatorForLanguageModeling):
        """Native loss-masking collator computing loss only on assistant completion."""
        def __init__(self, response_template, tokenizer, *args, mlm=False, **kwargs):
            super().__init__(tokenizer=tokenizer, mlm=mlm, *args, **kwargs)
            self.tokenizer = tokenizer
            self.response_template = response_template
            if isinstance(response_template, str):
                self.response_token_ids = self.tokenizer.encode(response_template, add_special_tokens=False)
            else:
                self.response_token_ids = list(response_template)

        def torch_call(self, examples):
            batch = super().torch_call(examples)
            labels = batch["labels"].clone()
            target_ids = self.response_token_ids
            target_len = len(target_ids)

            for i in range(len(examples)):
                input_ids_list = batch["input_ids"][i].tolist()
                response_start_idx = None
                for idx in range(len(input_ids_list) - target_len + 1):
                    if input_ids_list[idx : idx + target_len] == target_ids:
                        response_start_idx = idx
                        break

                if response_start_idx is not None:
                    # Mask everything before the assistant completion with -100
                    labels[i, : response_start_idx + target_len] = -100

            batch["labels"] = labels
            return batch

    return StandaloneCompletionOnlyCollator



# Robust LoRA Target Module Scoping for Gemma 4 & Multimodal Models
def resolve_target_modules(model, requested_targets: list[str]) -> list[str]:
    """
    Intelligently discovers and scopes LoRA target modules to supported nn.Linear layers.
    Specifically handles Gemma 4 and multimodal architectures where vision/audio towers
    use custom wrappers (like Gemma4ClippableLinear) that are unsupported by PEFT.
    """
    multimodal_keywords = ("vision", "visual", "image", "audio", "sound", "modalities")
    has_language_model = any(name.startswith("language_model.") for name, _ in model.named_modules())

    valid_targets = []
    for name, module in model.named_modules():
        # If the model has a dedicated language_model submodule (e.g. Gemma 4 multimodal), focus strictly on it
        if has_language_model and not name.startswith("language_model."):
            continue
        # Otherwise, exclude any modules inside vision/audio towers
        elif not has_language_model and any(kw in name.lower() for kw in multimodal_keywords):
            continue

        name_parts = name.split(".")
        if any(t in name_parts for t in requested_targets):
            # CRITICAL: Must be a supported PyTorch Linear layer (not a custom module wrapper)
            if isinstance(module, torch.nn.Linear):
                valid_targets.append(name)

    if valid_targets:
        print(f"Resolved {len(valid_targets)} valid nn.Linear target modules in language model.")
        return valid_targets

    print(f"Automatic target discovery returned 0 specific modules; using configured: {requested_targets}")
    return requested_targets


def main():
    args = parse_args()

    # 1. Load Configuration
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
        print("Error: config.yaml not found! Please check working directory or provide --config.")
        sys.exit(1)

    print(f" Loading configuration from: {config_path.resolve()}")
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    # CLI Overrides if provided
    if args.model:
        config["model"]["name_or_path"] = args.model
    if args.batch_size:
        config["training"]["per_device_train_batch_size"] = args.batch_size
    if args.grad_accum:
        config["training"]["gradient_accumulation_steps"] = args.grad_accum
    if args.epochs:
        config["training"]["num_train_epochs"] = args.epochs

    model_name = config["model"]["name_or_path"]
    max_seq_length = config["training"]["max_seq_length"]
    output_dir = config["training"]["output_dir"]

    # Ensure output_dir resolves nicely
    if not Path(output_dir).is_absolute() and Path("/workspace").exists():
        if not output_dir.startswith("/workspace"):
            output_dir = str(Path(output_dir).resolve())

    os.makedirs(output_dir, exist_ok=True)

    print("==================================================================")
    print(" CIVIL-LEX: Pure Hugging Face Fine-Tuning Pipeline (H100 SXM)")
    print(f" Model:               {model_name}")
    print(" Precision:           Pure BF16 (No 4-bit Quantization)")
    print(f" Max Sequence Length: {max_seq_length}")
    print(f" Output Directory:    {output_dir}")
    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        print(f" Active Accelerator:  {gpu_name} ({vram_gb:.1f} GB VRAM)")
    else:
        print(" Active Accelerator:  CPU (Warning: Fine-tuning requires NVIDIA GPU)")
    print("==================================================================")

    # 2. Imports with Graceful Fallbacks
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model, TaskType
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, DataCollatorForLanguageModeling
    from trl import SFTTrainer

    # TRL >= 0.13 moved SFT-specific args (max_seq_length, packing, etc.) into SFTConfig.
    # We try to import it; graceful fallback to None means we use the old API path.
    try:
        from trl import SFTConfig
        _has_sft_config = True
        print("ℹFTConfig detected — using TRL >= 0.13 API path.")
    except ImportError:
        SFTConfig = None
        _has_sft_config = False
        print("ℹSFTConfig not found — using TRL < 0.13 API path.")

    DataCollatorForCompletionOnlyLM = get_completion_collator_class()

    # Check for Hugging Face authentication token (required for gated Gemma models)
    hf_token = (
        os.environ.get("HF_TOKEN")
        or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        or os.environ.get("HUGGINGFACE_TOKEN")
    )
    if not hf_token:
        print(" Warning: HF_TOKEN is not set in environment. If downloading gated models")
        print("    like Google Gemma, run 'huggingface-cli login' or export HF_TOKEN='your_token'.")

    # 3. Load Tokenizer
    print(" Loading tokenizer...")
    try:
        tokenizer = AutoTokenizer.from_pretrained(
            model_name,
            token=hf_token,
            trust_remote_code=True,
        )
    except Exception as e:
        print(f" Failed to load tokenizer for '{model_name}': {e}")
        print(" Tip: Verify your internet connection, model ID, and HF_TOKEN permission.")
        sys.exit(1)

    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    # 4. Resolve Attention Backend Safely (FlashAttention-2 vs PyTorch SDPA)
    requested_attn = config["model"].get("attn_implementation", "flash_attention_2")
    if not torch.cuda.is_available():
        attn_impl = "sdpa"
    elif requested_attn == "flash_attention_2":
        try:
            import flash_attn  # noqa: F401
            attn_impl = "flash_attention_2"
            print(" FlashAttention-2 package detected and active.")
        except ImportError:
            print(" FlashAttention-2 package not installed. Falling back to PyTorch native SDPA.")
            print("   (PyTorch SDPA executes optimized FlashAttention-2 kernels natively on Hopper H100).")
            attn_impl = "sdpa"
    else:
        attn_impl = requested_attn

    # 5. Load Model in Native BF16 with Crash-Proof Device Placement
    device_map = {"": torch.cuda.current_device()} if torch.cuda.is_available() else None
    target_dtype = torch.bfloat16 if config["training"].get("bf16", True) else torch.float32

    # Support modern transformers 'dtype' parameter while maintaining backward compatibility
    load_kwargs = {
        "device_map": device_map,
        "attn_implementation": attn_impl,
        "token": hf_token,
        "trust_remote_code": True,
    }
    try:
        # Newer transformers uses dtype
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            dtype=target_dtype,
            **load_kwargs,
        )
    except TypeError:
        # Older transformers uses torch_dtype
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=target_dtype,
            **load_kwargs,
        )
    except Exception as e:
        if attn_impl == "flash_attention_2":
            print(f" Loading with flash_attention_2 failed ({e}). Retrying with native 'sdpa'...")
            load_kwargs["attn_implementation"] = "sdpa"
            try:
                model = AutoModelForCausalLM.from_pretrained(
                    model_name,
                    dtype=target_dtype,
                    **load_kwargs,
                )
            except TypeError:
                model = AutoModelForCausalLM.from_pretrained(
                    model_name,
                    torch_dtype=target_dtype,
                    **load_kwargs,
                )
        else:
            print(f" Failed to load model '{model_name}': {e}")
            sys.exit(1)

    # 6. CRITICAL: Gradient Checkpointing & Input Gradients Setup for LoRA
    # When base model weights are frozen, PyTorch will crash with:
    # 'RuntimeError: element 0 of tensors does not require grad and does not have a grad_fn'
    # unless enable_input_require_grads() is explicitly called!
    model.config.use_cache = False
    if hasattr(model, "enable_input_require_grads"):
        model.enable_input_require_grads()
    else:
        def make_inputs_require_grad(module, input, output):
            output.requires_grad_(True)
        model.get_input_embeddings().register_forward_hook(make_inputs_require_grad)

    # 7. Attach LoRA Adapters with Multimodal Scoping
    print("Configuring and attaching PEFT LoRA adapters...")
    configured_targets = config["lora"]["target_modules"]
    scoped_targets = resolve_target_modules(model, configured_targets)

    lora_cfg = LoraConfig(
        r=config["lora"]["r"],
        lora_alpha=config["lora"]["lora_alpha"],
        target_modules=scoped_targets,
        lora_dropout=config["lora"]["lora_dropout"],
        bias=config["lora"]["bias"],
        task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()

    # 8. Load and Format Datasets
    train_path, eval_path = resolve_dataset_paths(config)
    print(f"Datasets resolved:\n  - Train: {train_path}\n  - Eval:  {eval_path}")

    def load_jsonl_messages(file_path: str) -> Dataset:
        """Robustly loads JSONL extracting strictly the 'messages' field to prevent Arrow CastErrors."""
        records = []
        with open(file_path, "r", encoding="utf-8") as f:
            for line_idx, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    if "messages" in obj:
                        records.append({"messages": obj["messages"]})
                except Exception as parse_err:
                    print(f" Warning: Skipped corrupted line {line_idx} in {file_path}: {parse_err}")
        return Dataset.from_list(records)

    train_dataset = load_jsonl_messages(train_path)
    eval_dataset = load_jsonl_messages(eval_path)

    def format_prompts(examples):
        formatted_texts = [
            tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
            for messages in examples["messages"]
        ]
        return {"text": formatted_texts}

    # Prune non-text columns after formatting so SFTTrainer collator doesn't hit dictionary/type errors
    cols_to_remove_train = [c for c in train_dataset.column_names if c != "text"]
    cols_to_remove_eval = [c for c in eval_dataset.column_names if c != "text"]

    train_dataset = train_dataset.map(format_prompts, batched=True, remove_columns=cols_to_remove_train)
    eval_dataset = eval_dataset.map(format_prompts, batched=True, remove_columns=cols_to_remove_eval)

    print(f"Formatted {len(train_dataset)} train samples | {len(eval_dataset)} eval samples")

    # 9. Response-Only Completion Masking Setup
    sample_text = train_dataset[0]["text"]
    if "<|turn>model\n" in sample_text:
        response_template = "<|turn>model\n"
        print("Configured response template: '<|turn>model\\n' (Gemma 4 native)")
    elif "<start_of_turn>model\n" in sample_text:
        response_template = "<start_of_turn>model\n"
        print("Configured response template: '<start_of_turn>model\\n' (Gemma 2/3 fallback)")
    elif "<|im_start|>assistant\n" in sample_text:
        response_template = "<|im_start|>assistant\n"
        print("Configured response template: '<|im_start|>assistant\\n' (ChatML format)")
    else:
        response_template = "model\n"
        print(f"Using generic response template: '{response_template}'")

    try:
        data_collator = DataCollatorForCompletionOnlyLM(
            response_template=response_template,
            tokenizer=tokenizer,
        )
    except Exception as collator_err:
        print(f"DataCollator notice ({collator_err}). Falling back to standard language modeling collator.")
        data_collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)

    # 10. Training Arguments for NVIDIA H100 SXM
    import transformers
    import inspect

    ta_sig = inspect.signature(transformers.TrainingArguments.__init__).parameters

    
    # Guard 'optim': some pods ship transformers < 4.19 without fused Adam
    
    optim_choice = config["training"].get("optim", "adamw_torch_fused")
    if "fused" in optim_choice:
        if not torch.cuda.is_available() or "optim" not in ta_sig:
            optim_choice = "adamw_torch"
            print("Fused optimizer not available in this transformers version; using adamw_torch.")

    
    # eval_strategy (>= 4.41.0) vs evaluation_strategy (< 4.41.0)
    
    eval_arg_key = (
        "eval_strategy"
        if pkg_version.parse(transformers.__version__) >= pkg_version.parse("4.41.0")
        else "evaluation_strategy"
    )

    safe_num_workers = get_safe_dataloader_workers(config["training"].get("dataloader_num_workers", 2))
    save_limit = config["training"].get("save_total_limit", 2)

    
    # warmup_ratio (>= 4.6.0 but sometimes missing in custom builds)
    # Fall back to warmup_steps computed from total training steps.
    
    warmup_ratio = float(config["training"].get("warmup_ratio", 0.05))
    if "warmup_ratio" in ta_sig:
        warmup_kwarg = {"warmup_ratio": warmup_ratio}
        print(f"ℹUsing warmup_ratio={warmup_ratio} (modern transformers).")
    else:
        # Estimate total steps: dataset_size / (batch_size * grad_accum) * epochs
        n_samples = len(train_dataset)
        batch = config["training"]["per_device_train_batch_size"]
        grad_accum = config["training"]["gradient_accumulation_steps"]
        epochs = config["training"]["num_train_epochs"]
        total_steps = max(1, (n_samples // (batch * grad_accum)) * epochs)
        warmup_steps = max(1, int(total_steps * warmup_ratio))
        warmup_kwarg = {"warmup_steps": warmup_steps}
        print(f"'warmup_ratio' unsupported in this transformers build; using warmup_steps={warmup_steps} (≈{warmup_ratio:.0%} of {total_steps} steps).")

    
    # gradient_checkpointing_kwargs added in transformers >= 4.36.0
    
    gc_kwargs = {}
    if "gradient_checkpointing_kwargs" in ta_sig:
        gc_kwargs = {"gradient_checkpointing_kwargs": {"use_reentrant": False}}
    else:
        print("ℹ'gradient_checkpointing_kwargs' not available in this transformers version; skipping.")

    training_kwargs = {
        "output_dir": output_dir,
        "per_device_train_batch_size": config["training"]["per_device_train_batch_size"],
        "gradient_accumulation_steps": config["training"]["gradient_accumulation_steps"],
        "learning_rate": float(config["training"]["learning_rate"]),
        **warmup_kwarg,
        "num_train_epochs": config["training"]["num_train_epochs"],
        "lr_scheduler_type": config["training"]["lr_scheduler_type"],
        "bf16": config["training"].get("bf16", True),
        "fp16": False,
        "optim": optim_choice,
        "weight_decay": 0.01,
        "logging_steps": config["training"]["logging_steps"],
        eval_arg_key: config["training"].get("eval_strategy", "epoch"),
        "save_strategy": config["training"].get("save_strategy", "epoch"),
        "load_best_model_at_end": config["training"].get("load_best_model_at_end", True),
        "metric_for_best_model": config["training"].get("metric_for_best_model", "eval_loss"),
        "greater_is_better": False,
        "save_total_limit": save_limit,  # Prevents disk quota exhaustion on RunPod
        "seed": config["training"]["seed"],
        "report_to": "none",
        "dataloader_num_workers": safe_num_workers,
        "dataloader_pin_memory": bool(torch.cuda.is_available()),
        "gradient_checkpointing": True,
        **gc_kwargs,
    }

    
    import inspect  # noqa: F811
    sft_sig = inspect.signature(SFTTrainer.__init__).parameters

    # --- Candidate pool of ALL possible SFT-specific args ----------------------
    sft_specific_candidates = {
        "max_seq_length": max_seq_length,       # TRL 0.13-0.15
        "max_length": max_seq_length,            # Some TRL 0.16+ builds renamed it
        "packing": False,                        # Must be False with completion-only collator
        "dataset_text_field": "text",            # TRL 0.13+: which column holds the text
        "completion_only_labels": True,          # TRL 0.16+: mask prompt tokens natively
    }

    if _has_sft_config:
        sft_config_all = {**training_kwargs, **sft_specific_candidates}
        sft_config_filtered = safe_kwargs(SFTConfig, sft_config_all)
        training_args = SFTConfig(**sft_config_filtered)

        has_completion_only = getattr(training_args, "completion_only_labels", None)
        print(f"SFTConfig built (completion_only_labels={has_completion_only}): {list(sft_config_filtered.keys())}")

        # SFTTrainer in TRL >= 0.13 mode — no custom data_collator
        base_trainer_candidates = {
            "model": model,
            "train_dataset": train_dataset,
            "eval_dataset": eval_dataset,
            # ← data_collator intentionally omitted: TRL handles it natively
            "args": training_args,
            "processing_class": tokenizer,
            "tokenizer": tokenizer,
        }
        if "processing_class" in sft_sig:
            base_trainer_candidates.pop("tokenizer", None)
        else:
            base_trainer_candidates.pop("processing_class", None)

        trainer_kwargs = safe_kwargs(SFTTrainer, base_trainer_candidates)

    else:
        # -----
        # TRL < 0.13: TrainingArguments + SFTTrainer accepts SFT args directly.
        # Here the dataset is NOT pre-tokenized, so our custom
        # DataCollatorForCompletionOnlyLM is still needed and works correctly.
        # -----
        training_args = TrainingArguments(**safe_kwargs(TrainingArguments, training_kwargs))

        all_trainer_candidates = {
            "model": model,
            "train_dataset": train_dataset,
            "eval_dataset": eval_dataset,
            "data_collator": data_collator,   # ← needed in TRL < 0.13
            "args": training_args,
            "processing_class": tokenizer,
            "tokenizer": tokenizer,
            **sft_specific_candidates,
        }
        if "processing_class" in sft_sig:
            all_trainer_candidates.pop("tokenizer", None)
        else:
            all_trainer_candidates.pop("processing_class", None)

        trainer_kwargs = safe_kwargs(SFTTrainer, all_trainer_candidates)

    # Fallback: if no seq-length arg landed in the trainer/config, cap tokenizer
    seq_length_args = {"max_seq_length", "max_length"}
    if not seq_length_args.intersection(set(trainer_kwargs.keys())) and \
       not (hasattr(training_args, "max_seq_length") or hasattr(training_args, "max_length")):
        tokenizer.model_max_length = max_seq_length
        print(f"ℹSequence length capped via tokenizer.model_max_length={max_seq_length}")

    print(f" SFTTrainer built with: {[k for k in trainer_kwargs if k != 'model']}")
    trainer = SFTTrainer(**trainer_kwargs)

    # 12. Train Model with Graceful OOM Handling
    print("\nCommencing fine-tuning on NVIDIA H100 SXM...")
    try:
        trainer.train()
    except torch.cuda.OutOfMemoryError as oom_err:
        print("\n CUDA Out Of Memory Error encountered during training:")
        print(f"   {oom_err}")
        print("\n Recommended Fixes for H100 SXM:")
        print("   1. Reduce 'per_device_train_batch_size' in config.yaml (e.g., from 8 to 4).")
        print("   2. Increase 'gradient_accumulation_steps' (e.g., from 2 to 4) to maintain effective batch size.")
        print("   3. Keep max_seq_length at 2048.")
        gc.collect()
        torch.cuda.empty_cache()
        sys.exit(1)
    except Exception as general_err:
        print(f"\nTraining interrupted by unexpected error: {general_err}")
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise general_err

    # 13. Save LoRA Adapters and Tokenizer Safely
    print(f"\n Fine-tuning complete. Saving LoRA adapters to {output_dir}...")
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)
    sanitize_tokenizer_config(Path(output_dir))
    print(" All LoRA adapters and tokenizer configuration saved successfully.")
    print(" Next step: Run 'python merge_lora.py' to merge adapters into full 16-bit model.")


if __name__ == "__main__":
    main()
