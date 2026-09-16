import os
os.environ["TORCH_COMPILE_DISABLE"] = "1"
os.environ["TRITON_DISABLE"] = "1"
import yaml
from unsloth import FastLanguageModel, get_chat_template
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

def main():
    # Load Config
    with open("config.yaml", "r") as f:
        config = yaml.safe_load(f)

    print(f"📦 Loading Model: {config['model']['name_or_path']}")
    # 1. Load Model
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name = config["model"]["name_or_path"],
        max_seq_length = config["training"]["max_seq_length"],
        dtype = None, # Auto detect
        load_in_4bit = config["model"]["load_in_4bit"],
    )

    # 2. Add LoRA Adapters
    model = FastLanguageModel.get_peft_model(
        model,
        r = config["lora"]["r"],
        target_modules = config["lora"]["target_modules"],
        lora_alpha = config["lora"]["lora_alpha"],
        lora_dropout = config["lora"]["lora_dropout"],
        bias = config["lora"]["bias"],
        use_gradient_checkpointing = True, # Changed from "unsloth" to avoid Triton compilation on Windows
        random_state = 3407,
    )

    # 3. Format Dataset
    # Gemma template is native to unsloth
    tokenizer = get_chat_template(
        tokenizer,
        chat_template = "gemma",
    )

    def format_chat_template(examples):
        texts = [tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False) for messages in examples["messages"]]
        return {"text": texts}

    print("📄 Loading Datasets...")
    train_dataset = load_dataset("json", data_files=config["dataset"]["train_file"])["train"]
    eval_dataset = load_dataset("json", data_files=config["dataset"]["eval_file"])["train"]

    train_dataset = train_dataset.map(format_chat_template, batched=True)
    eval_dataset = eval_dataset.map(format_chat_template, batched=True)

    print(f"Train size: {len(train_dataset)} | Eval size: {len(eval_dataset)}")

    # 4. Train
    trainer = SFTTrainer(
        model = model,
        tokenizer = tokenizer,
        train_dataset = train_dataset,
        eval_dataset = eval_dataset,
        dataset_text_field = "text",
        max_seq_length = config["training"]["max_seq_length"],
        dataset_num_proc = 2,
        packing = config["training"]["packing"], 
        args = TrainingArguments(
            per_device_train_batch_size = config["training"]["per_device_train_batch_size"],
            gradient_accumulation_steps = config["training"]["gradient_accumulation_steps"],
            warmup_ratio = config["training"]["warmup_ratio"],
            num_train_epochs = config["training"]["num_train_epochs"],
            learning_rate = float(config["training"]["learning_rate"]),
            fp16 = not config["training"]["bf16"],
            bf16 = config["training"]["bf16"],
            logging_steps = config["training"]["logging_steps"],
            optim = "adamw_8bit",
            weight_decay = 0.01,
            lr_scheduler_type = config["training"]["lr_scheduler_type"],
            seed = config["training"]["seed"],
            output_dir = config["training"]["output_dir"],
            eval_strategy = config["training"]["eval_strategy"],
            save_strategy = config["training"]["save_strategy"],
            load_best_model_at_end = config["training"]["load_best_model_at_end"],
            metric_for_best_model = config["training"]["metric_for_best_model"],
        ),
    )

    print("🚀 Starting Fine-Tuning...")
    trainer.train()

    print(f"✅ Training complete. Saving LoRA adapters to {config['training']['output_dir']}")
    model.save_pretrained(config["training"]["output_dir"])
    tokenizer.save_pretrained(config["training"]["output_dir"])

if __name__ == "__main__":
    main()
