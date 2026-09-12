"use client";

import { useState } from "react";
import { Send, Paperclip, ChevronRight, Scale, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { userProfile, chatPrompts } from "@/lib/mock-data";

export default function ChatPage() {
  const [messages, setMessages] = useState<{id: number; role: string; content: string; reasoning?: string}[]>([
    {
      id: 1,
      role: "assistant",
      content: "Hello. I am CIVIL-LEX, your AI Legal Assistant. How can I help you with Philippine Civil Law today?",
    }
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const handleSend = () => {
    if (!inputValue.trim()) return;
    
    // Add user message
    const newUserMsg = { id: Date.now(), role: "user", content: inputValue };
    setMessages((prev) => [...prev, newUserMsg]);
    setInputValue("");
    
    // Simulate AI response
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: "assistant",
          content: "Based on the Civil Code of the Philippines, an annulment of marriage (Article 45, Family Code) may be granted on grounds such as lack of parental consent, psychological incapacity, fraud, force, or physical incapability. Would you like me to elaborate on a specific ground?",
          reasoning: "Analyzed query against Title I of the Family Code. Identified Article 45 as the primary statutory basis for annulment grounds."
        }
      ]);
    }, 1000);
  };

  const handlePromptClick = (prompt: string) => {
    setInputValue(prompt);
  };

  return (
    <div className="flex h-full gap-6 animate-fade-in">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        {/* Chat Messages */}
        <ScrollArea className="flex-1 p-6">
          <div className="flex flex-col gap-6 max-w-3xl mx-auto">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <Avatar className="w-8 h-8 mt-1 border border-border">
                  {msg.role === 'assistant' ? (
                    <>
                      <div className="bg-primary w-full h-full flex items-center justify-center">
                        <Scale className="w-4 h-4 text-primary-foreground" />
                      </div>
                    </>
                  ) : (
                    <AvatarImage src={userProfile.avatar} />
                  )}
                </Avatar>
                
                <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`px-4 py-3 rounded-2xl ${msg.role === 'user' ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-accent/40 border border-primary/10 text-foreground rounded-tl-sm'}`}>
                    {msg.content}
                  </div>
                  
                  {msg.reasoning && (
                    <div className="mt-2 w-full">
                      <Accordion className="w-full">
                        <AccordionItem value="reasoning" className="border-none">
                          <AccordionTrigger className="py-2 text-xs text-primary hover:no-underline hover:opacity-80 rounded-md focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
                            View Legal Reasoning Process
                          </AccordionTrigger>
                          <AccordionContent className="text-xs text-muted-foreground bg-accent/20 p-3 rounded-lg border border-border">
                            {msg.reasoning}
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {isTyping && (
              <div className="flex gap-4">
                <Avatar className="w-8 h-8 mt-1 border border-border animate-pulse">
                  <div className="bg-primary w-full h-full flex items-center justify-center">
                    <Scale className="w-4 h-4 text-primary-foreground" />
                  </div>
                </Avatar>
                <div className="flex flex-col items-start max-w-[80%]">
                  <div className="px-4 py-3 rounded-2xl bg-accent/40 border border-primary/10 rounded-tl-sm flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                      <div className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                      <div className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce"></div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs font-medium text-primary animate-pulse bg-accent px-2 py-1 rounded-md border border-primary/10">
                    CIVIL-LEX is searching statutory provisions...
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Chat Input Area */}
        <div className="p-4 border-t border-border bg-card">
          <div className="max-w-3xl mx-auto">
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {chatPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handlePromptClick(prompt)}
                    className="text-xs px-3 py-1.5 rounded-full bg-accent/50 text-muted-foreground hover:bg-accent hover:text-primary transition-colors border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
            
            <div className="relative flex items-center bg-background border border-border rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all">
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground ml-1">
                <Paperclip className="w-5 h-5" />
              </Button>
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Message CIVIL-LEX..."
                className="flex-1 border-none bg-transparent shadow-none focus-visible:ring-0 text-foreground px-2 h-12"
              />
              <Button 
                onClick={handleSend}
                disabled={!inputValue.trim() || isTyping}
                className="mr-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg h-9 w-9 p-0 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary focus-visible:outline-none"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Side Panel for Citations */}
      <div className="hidden lg:flex flex-col w-80 bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border bg-card flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm text-foreground">Sources & Citations</h3>
        </div>
        <ScrollArea className="flex-1 p-4">
          {messages.length > 1 ? (
            <div className="space-y-4">
              <div className="p-3 bg-accent/30 rounded-xl border border-primary/10">
                <h4 className="text-xs font-bold text-primary mb-1">Article 45, Family Code</h4>
                <p className="text-xs text-muted-foreground">A marriage may be annulled for any of the following causes, existing at the time of the marriage: (1) That the party in whose behalf it is sought to have the marriage annulled was eighteen years of age or over but below twenty-one...</p>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-2 mt-20">
              <BookOpen className="w-8 h-8 opacity-20" />
              <p className="text-sm">Statutory sources and jurisprudence will appear here as you chat.</p>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
