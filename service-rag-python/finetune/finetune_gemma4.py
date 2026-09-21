import os
import sys
from pathlib import Path
import yaml
import torch

# Enable high-throughput TF32 matmul and cuDNN on NVIDIA H100 (Hopper)
if torch.cuda.is_available():
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True

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
        str(script_dir.parent / "data" / "traning"),
        str(repo_root / "service-rag-python" / "data" / "traning"),
        str(repo_root / "service-rag-python" / "finetune"),
        str(Path.cwd()),
    ]
    candidate_eval_dirs = [
        str(script_dir),
        str(repo_root / "service-rag-python" / "finetune"),
        str(Path.cwd()),
    ]

    train_path = find_file(config["dataset"]["train_file"], candidate_train_dirs)
    eval_path = find_file(config["dataset"]["eval_file"], candidate_eval_dirs)
    return train_path, eval_path

def main():
    # 1. Load Configuration
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

    model_name = config["model"]["name_or_path"]
    max_seq_length = config["training"]["max_seq_length"]
    output_dir = config["training"]["output_dir"]
    os.makedirs(output_dir, exist_ok=True)

    print("==================================================================")
    print(" CIVIL-LEX: Pure Hugging Face Fine-Tuning Pipeline (H100 Optimized)")
    print(f" Model: {model_name}")
    print(" Precision: Pure BF16 (No 4-bit Quantization)")
    print(f" Max Sequence Length: {max_seq_length}")
    print("==================================================================")

    # 2. Imports (Hugging Face ecosystem only, no Unsloth)
    from datasets import load_dataset
    from peft import LoraConfig, get_peft_model, TaskType
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
    from trl import SFTTrainer, DataCollatorForCompletionOnlyLM

    # 3. Load Tokenizer & Model in Native BF16
    print("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(
        model_name,
        trust_remote_code=True,
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    attn_impl = config["model"].get("attn_implementation", "flash_attention_2")
    if not torch.cuda.is_available():
        attn_impl = "sdpa"

    print(f" Loading model with attention implementation: {attn_impl}...")
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.bfloat16 if config["training"].get("bf16", True) else torch.float32,
        device_map="auto",
        attn_implementation=attn_impl,
        trust_remote_code=True,
    )

    # Enable gradient checkpointing for activation memory efficiency
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})

    # 4. Attach LoRA Adapters
    lora_cfg = LoraConfig(
        r=config["lora"]["r"],
        lora_alpha=config["lora"]["lora_alpha"],
        target_modules=config["lora"]["target_modules"],
        lora_dropout=config["lora"]["lora_dropout"],
        bias=config["lora"]["bias"],
        task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()

    # 5. Load and Format Datasets
    train_path, eval_path = resolve_dataset_paths(config)
    print(f" Datasets resolved:\n  - Train: {train_path}\n  - Eval:  {eval_path}")

    train_dataset = load_dataset("json", data_files=train_path)["train"]
    eval_dataset = load_dataset("json", data_files=eval_path)["train"]

    def format_prompts(examples):
        formatted_texts = [
            tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
            for messages in examples["messages"]
        ]
        return {"text": formatted_texts}

    train_dataset = train_dataset.map(format_prompts, batched=True)
    eval_dataset = eval_dataset.map(format_prompts, batched=True)

    print(f" Formatted {len(train_dataset)} train samples | {len(eval_dataset)} eval samples")

    # 6. Response-Only Completion Masking Setup
    # Detect the exact model turn prefix to ensure loss is computed ONLY on the assistant's answer
    sample_text = train_dataset[0]["text"]
    if "<|turn>model\n" in sample_text:
        response_template = "<|turn>model\n"
        print(" Configured response template: '<|turn>model\\n' (Gemma 4 native)")
    elif "<start_of_turn>model\n" in sample_text:
        response_template = "<start_of_turn>model\n"
        print(" Configured response template: '<start_of_turn>model\\n' (Gemma 2 fallback)")
    else:
        response_template = "model\n"
        print(f" Using generic response template: '{response_template}'")

    data_collator = DataCollatorForCompletionOnlyLM(
        response_template=response_template,
        tokenizer=tokenizer,
    )

    # 7. Training Arguments for NVIDIA H100
    optim_choice = config["training"].get("optim", "adamw_torch_fused")
    if "fused" in optim_choice and not torch.cuda.is_available():
        optim_choice = "adamw_torch"

    training_args = TrainingArguments(
        output_dir=output_dir,
        per_device_train_batch_size=config["training"]["per_device_train_batch_size"],
        gradient_accumulation_steps=config["training"]["gradient_accumulation_steps"],
        learning_rate=float(config["training"]["learning_rate"]),
        warmup_ratio=float(config["training"]["warmup_ratio"]),
        num_train_epochs=config["training"]["num_train_epochs"],
        lr_scheduler_type=config["training"]["lr_scheduler_type"],
        bf16=config["training"].get("bf16", True),
        fp16=False,
        optim=optim_choice,
        weight_decay=0.01,
        logging_steps=config["training"]["logging_steps"],
        eval_strategy=config["training"]["eval_strategy"],
        save_strategy=config["training"]["save_strategy"],
        load_best_model_at_end=config["training"]["load_best_model_at_end"],
        metric_for_best_model=config["training"]["metric_for_best_model"],
        seed=config["training"]["seed"],
        report_to="none",
        dataloader_num_workers=config["training"].get("dataloader_num_workers", 4),
    )

    # 8. SFTTrainer with Response Masking
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        dataset_text_field="text",
        max_seq_length=max_seq_length,
        data_collator=data_collator,
        dataset_num_proc=4,
        packing=config["training"].get("packing", False),
        args=training_args,
    )

    # 9. Train Model
    print("\n Commencing fine-tuning on NVIDIA H100...")
    trainer.train()

    # 10. Save LoRA Adapters and Tokenizer
    print(f"\n Fine-tuning complete. Saving LoRA adapters to {output_dir}...")
    trainer.model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    print(" All LoRA adapters and tokenizer configuration saved successfully.")
    print("Next step: Run 'python merge_lora.py' to merge adapters into full 16-bit model.")

if __name__ == "__main__":
    main()
