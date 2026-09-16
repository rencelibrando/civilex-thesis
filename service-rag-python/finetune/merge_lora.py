import yaml
from unsloth import FastLanguageModel

def main():
    with open("config.yaml", "r") as f:
        config = yaml.safe_load(f)

    # Output directory where LoRA weights are saved
    lora_dir = config["training"]["output_dir"]
    merged_dir = f"{lora_dir}-merged"

    print(f"📦 Loading LoRA model from: {lora_dir}")
    
    # FastLanguageModel automatically detects PEFT/LoRA adapters
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name = lora_dir, 
        max_seq_length = config["training"]["max_seq_length"],
        dtype = None,
        load_in_4bit = False, # We must load in 16-bit to merge properly
    )

    print("🔄 Merging LoRA adapters into base model...")
    # This actually merges the adapters into the base weights in RAM
    model.save_pretrained_merged(merged_dir, tokenizer, save_method="merged_16bit")
    
    print(f"✅ Merged model successfully saved to {merged_dir}")
    print("Next step: Convert this merged model to GGUF using llama.cpp if you want to use it in LM Studio.")

if __name__ == "__main__":
    main()
