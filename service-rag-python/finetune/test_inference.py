import os
os.environ["TORCH_COMPILE_DISABLE"] = "1"
os.environ["TRITON_DISABLE"] = "1"

from unsloth import FastLanguageModel, get_chat_template
import yaml

def main():
    try:
        with open("config.yaml", "r") as f:
            config = yaml.safe_load(f)
        lora_dir = config["training"]["output_dir"]
        max_seq_length = config["training"]["max_seq_length"]
    except FileNotFoundError:
        print("⚠️ config.yaml not found!")
        lora_dir = "./output/gemma4-civil-code-qlora"
        max_seq_length = 1024

    # We are testing the MERGED model directly to bypass GGUF completely
    merged_dir = f"{lora_dir}-merged"
    
    print(f"📦 Loading merged model from: {merged_dir}...")
    
    # Load model using Unsloth (loading in 4bit to fit in your 6GB VRAM)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name = merged_dir,
        max_seq_length = max_seq_length,
        dtype = None,
        load_in_4bit = True,
    )
    
    # Enable native 2x faster inference
    FastLanguageModel.for_inference(model)

    # The merged tokenizer already has the Gemma chat template saved inside it.
    # Calling get_chat_template again causes an AssertionError in Unsloth.
    # tokenizer = get_chat_template(
    #     tokenizer,
    #     chat_template = "gemma",
    # )

    print("\nModel loaded successfully! Preparing your prompt...\n")

    # This is the exact prompt that was giving you word salad
    prompt_text = "Anong batas ang pwede kong i kaso sa isang corporation dahil sa hinde pag papasahod ng tama based on the philippine civil code and cite related jurisprudence. Please provide your answer in JSON format according to the schema."

    messages = [
        {"role": "user", "content": prompt_text}
    ]

    # Apply the template and tokenize
    inputs = tokenizer.apply_chat_template(
        messages,
        tokenize = True,
        add_generation_prompt = True, # Must be True for inference
        return_tensors = "pt",
    ).to("cuda")

    print("Generating answer... (This might take a moment)\n")
    print("-" * 50)
    
    # Generate the output
    outputs = model.generate(
        input_ids = inputs,
        max_new_tokens = 512,
        use_cache = True,
        temperature = 0.3,     # Kept low for JSON output
        repetition_penalty = 1.1 # Standard repetition penalty
    )

    # Decode and print the response
    # We slice off the prompt length so we only print the generated answer
    generated_ids = outputs[0][inputs.shape[1]:]
    response = tokenizer.decode(generated_ids, skip_special_tokens=True)
    
    print(response)
    print("-" * 50)
    print("\nAnalysis:")
    if "was. from. of." in response or response.count(".") > 10 in response[:100]:
        print("The model still output word salad! This means the FINE-TUNING itself failed (loss likely spiked to NaN). You must lower the learning rate and train again.")
    else:
        print("the model output coherent text! This means your training was SUCCESSFUL, and the word salad was 100% caused by a bad GGUF conversion or an outdated LM Studio version.")

if __name__ == "__main__":
    main()
