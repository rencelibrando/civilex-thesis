"use client";

import { useState } from "react";
import { Search, Send, Paperclip, Download, Printer, Maximize2, ShieldCheck, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { userProfile } from "@/lib/mock-data";

export default function ResearchPage() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: "assistant",
      content: "I have analyzed 'Contract_Amendment_v3.pdf'. I found 2 potential issues regarding retroactive application of Republic Act No. 11642. How would you like to proceed?",
    }
  ]);
  const [inputValue, setInputValue] = useState("");

  const handleSend = () => {
    if (!inputValue.trim()) return;
    setMessages((prev) => [...prev, { id: Date.now(), role: "user", content: inputValue }]);
    setInputValue("");
    
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: "assistant",
          content: "The highlighted section states the amendment applies to all cases pending before January 2022. However, under Article 4 of the Civil Code, laws shall have no retroactive effect unless the contrary is provided. Ensure RA 11642 explicitly states retroactivity for this specific provision.",
        }
      ]);
    }, 1000);
  };

  return (
    <div className="flex h-full gap-6 animate-fade-in">
      {/* Document Viewer - Left Pane */}
      <div className="flex-1 flex flex-col bg-slate-50 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="p-3 border-b border-slate-100 bg-[#FAFAFD] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-slate-50 text-xs border-slate-200">
              Contract_Amendment_v3.pdf
            </Badge>
            <span className="text-xs text-slate-400">Page 1 of 5</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500">
              <Download className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500">
              <Printer className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500">
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Document Content */}
        <ScrollArea className="flex-1 bg-slate-100 p-8">
          <div className="max-w-2xl mx-auto bg-slate-50 shadow-md min-h-[800px] p-12 relative">
            <h1 className="text-xl font-bold text-center mb-8 uppercase">Amendment to Master Agreement</h1>
            
            <p className="text-sm leading-loose text-justify mb-4">
              This AMENDMENT TO THE MASTER AGREEMENT (this &quot;Amendment&quot;) is entered into as of September 12, 2026, by and between Alpha Corp, and Beta LLC.
            </p>
            
            <p className="text-sm leading-loose text-justify mb-4">
              WHEREAS, the Parties desire to amend the Master Agreement to reflect recent changes in the regulatory framework governing domestic adoption under Republic Act No. 11642.
            </p>
            
            <div className="relative group my-6">
              <div className="absolute -left-3 top-0 bottom-0 w-1 bg-amber-400 rounded-full"></div>
              <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg relative">
                <div className="absolute -top-3 -right-3">
                  <Badge className="bg-amber-500 hover:bg-amber-600 border-none shadow-sm flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider">
                    <AlertCircle className="w-3 h-3" /> Flagged: Retroactivity
                  </Badge>
                </div>
                <p className="text-sm font-medium text-amber-900 leading-loose">
                  [FLAGGED SECTION]
                  <br />
                  &quot;3. Applicability. The provisions of this Amendment, specifically pertaining to the streamlined administrative procedures, shall apply retroactively to all petitions and proceedings pending as of January 1, 2022, notwithstanding prior agreements.&quot;
                </p>
              </div>
            </div>
            
            <p className="text-sm leading-loose text-justify">
              IN WITNESS WHEREOF, the Parties have executed this Amendment as of the date first above written.
            </p>
          </div>
        </ScrollArea>
      </div>

      {/* AI Assistant - Right Pane */}
      <div className="hidden lg:flex flex-col w-[400px] bg-slate-50 rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
        <div className="p-4 border-b border-slate-100 bg-[#FAFAFD] flex items-center justify-between">
          <h2 className="font-bold text-[#334155] flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#100771]" />
            AI Document Analysis
          </h2>
        </div>
        
        <ScrollArea className="flex-1 p-4">
          <div className="flex flex-col gap-4">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <Avatar className="w-6 h-6 mt-1 flex-shrink-0">
                  {msg.role === 'assistant' ? (
                    <div className="bg-[#100771] w-full h-full flex items-center justify-center">
                      <ShieldCheck className="w-3 h-3 text-slate-50" />
                    </div>
                  ) : (
                    <AvatarImage src={userProfile.avatar} />
                  )}
                </Avatar>
                
                <div className={`px-3 py-2 text-sm rounded-xl ${msg.role === 'user' ? 'bg-[#100771] text-slate-50 rounded-tr-sm' : 'bg-[#F1F0FB] text-[#334155] rounded-tl-sm'}`}>
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Action Chips */}
        {messages.length === 1 && (
          <div className="px-4 pb-2 pt-2 bg-slate-50 flex flex-wrap gap-2">
             <button onClick={() => setInputValue("Explain Article 4 issue")} className="text-xs px-3 py-1.5 rounded-full bg-slate-50 text-slate-600 hover:bg-[#F1F0FB] hover:text-[#100771] border border-slate-200 transition-colors">
                Explain Article 4 issue
              </button>
              <button onClick={() => setInputValue("Suggest a revision")} className="text-xs px-3 py-1.5 rounded-full bg-slate-50 text-slate-600 hover:bg-[#F1F0FB] hover:text-[#100771] border border-slate-200 transition-colors">
                Suggest a revision
              </button>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-slate-100 bg-slate-50">
          <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:ring-1 focus-within:ring-[#100771] focus-within:border-[#100771] transition-all">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask about this document..."
              className="flex-1 border-none bg-transparent shadow-none focus-visible:ring-0 text-[#334155] px-3 h-10 text-sm"
            />
            <Button 
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className="mr-1 bg-[#100771] hover:bg-[#170073] text-slate-50 rounded-lg h-8 w-8 p-0"
            >
              <Send className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
