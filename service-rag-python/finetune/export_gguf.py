import yaml
from unsloth import FastLanguageModel

def main():
    # If config.yaml isn't copied over to Windows, we will fall back to defaults
    try:
        with open("config.yaml", "r") as f:
            config = yaml.safe_load(f)
        lora_dir = config["training"]["output_dir"]
        max_seq_length = config["training"]["max_seq_length"]
    except FileNotFoundError:
        print("  config.yaml not found! Using default path from the Linux workspace.")
        # If your merged model folder is located somewhere else, change this path:
        lora_dir = "output/gemma4-civil-code-qlora"
        max_seq_length = 1024

    merged_dir = f"{lora_dir}-merged"
    gguf_dir = f"{lora_dir}-gguf" # Unsloth will save the file as {gguf_dir}-unsloth.Q4_K_M.gguf or similar in this dir

    print(f"Loading merged model from: {merged_dir}")
    
    # Load the already merged model
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name = merged_dir, 
        max_seq_length = max_seq_length,
        dtype = None,
        load_in_4bit = False,
    )

    print(" Exporting to GGUF format (Q4_K_M)...")
    print("Note: This might take a few minutes as Unsloth will download llama.cpp and run the conversion.")
    
    # save_pretrained_gguf handles downloading llama.cpp, compiling, and converting
    # q4_k_m is highly recommended for LM Studio (good balance of quality and speed)
    model.save_pretrained_gguf(gguf_dir, tokenizer, quantization_method="q4_k_m")
    
    # If you want other formats, you can uncomment these:
    # print("Exporting to GGUF format (F16)...")
    # model.save_pretrained_gguf(gguf_dir, tokenizer, quantization_method="f16")
    
    # print(" Exporting to GGUF format (Q8_0)...")
    # model.save_pretrained_gguf(gguf_dir, tokenizer, quantization_method="q8_0")

    print(f"GGUF model successfully saved inside {gguf_dir}")
    print("You can now load the .gguf file from that folder directly into LM Studio!")

if __name__ == "__main__":
    main()
