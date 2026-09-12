"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Share2, Download, CheckCircle, Scale, User, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { caseHistory, userProfile } from "@/lib/mock-data";

export default function HistoryDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  
  const historyItem = caseHistory.find((item) => item.id === id) || caseHistory[0];

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in-up">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <Link href="/history" className="inline-flex items-center justify-center font-medium text-slate-500 hover:text-[#100771] -ml-2 hover:bg-slate-100 rounded-lg h-9 px-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to History
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-lg h-9">
            <Share2 className="w-4 h-4 mr-2" /> Share
          </Button>
          <Button variant="outline" size="sm" className="rounded-lg h-9">
            <Download className="w-4 h-4 mr-2" /> Export
          </Button>
        </div>
      </div>

      {/* Title & Metadata */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Badge variant="secondary" className="bg-[#F1F0FB] text-[#100771] hover:bg-[#F1F0FB]">
            {historyItem.type}
          </Badge>
          <span className="text-sm text-slate-500">{historyItem.date}</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#334155] leading-tight">
          {historyItem.query}
        </h1>
      </div>

      {/* Chat Thread Representation */}
      <div className="space-y-6 mt-8">
        {/* User Query */}
        <div className="flex gap-4">
          <Avatar className="w-10 h-10 border border-slate-200 shadow-sm">
            <AvatarImage src={userProfile.avatar} />
            <AvatarFallback>
              <User className="w-5 h-5 text-slate-400" />
            </AvatarFallback>
          </Avatar>
          <Card className="flex-1 bg-slate-50 border-slate-200 shadow-sm rounded-2xl rounded-tl-sm">
            <CardContent className="p-4 sm:p-5 text-[#334155]">
              {historyItem.query}
            </CardContent>
          </Card>
        </div>

        {/* AI Response */}
        <div className="flex gap-4">
          <Avatar className="w-10 h-10 shadow-sm">
            <div className="bg-[#100771] w-full h-full flex items-center justify-center">
              <Scale className="w-5 h-5 text-slate-50" />
            </div>
          </Avatar>
          <div className="flex-1 space-y-4">
            <Card className="bg-[#FAFAFD] border-[#100771]/10 shadow-sm rounded-2xl rounded-tl-sm overflow-hidden">
              <div className="bg-slate-50 px-5 py-3 border-b border-[#100771]/10 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium text-green-700">Analysis Complete</span>
              </div>
              <CardContent className="p-5 text-[#334155] space-y-4 text-sm sm:text-base leading-relaxed">
                <p>Based on the provisions of the New Civil Code of the Philippines, the requisites for a valid contract of sale are:</p>
                <ol className="list-decimal pl-5 space-y-2">
                  <li><strong>Consent or meeting of the minds:</strong> The parties must agree on the transfer of ownership of the thing sold and the price certain in money or its equivalent (Art. 1475).</li>
                  <li><strong>Object or subject matter:</strong> The thing must be determinate or at least determinable, lawful, and within the commerce of men (Art. 1458, 1459).</li>
                  <li><strong>Cause or consideration:</strong> There must be a price certain in money or its equivalent (Art. 1458).</li>
                </ol>
                <p>If any of these essential requisites is absent, the contract is generally void and inexistent from the beginning (Art. 1409).</p>
              </CardContent>
            </Card>

            {/* Source Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-2">Sources:</span>
              <Badge variant="outline" className="bg-slate-50 text-[#100771] border-[#100771]/20 py-1 flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" /> Art. 1458, Civil Code
              </Badge>
              <Badge variant="outline" className="bg-slate-50 text-[#100771] border-[#100771]/20 py-1 flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" /> Art. 1475, Civil Code
              </Badge>
              <Badge variant="outline" className="bg-slate-50 text-[#100771] border-[#100771]/20 py-1 flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" /> Art. 1409, Civil Code
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
