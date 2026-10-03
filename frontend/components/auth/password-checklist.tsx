"use client";

import { Check, X } from "lucide-react";
import {
  PASSWORD_RULES,
  getPasswordStrength,
} from "@/lib/password-policy";

const STRENGTH_COLORS = [
  "bg-border",
  "bg-destructive",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-500",
];

interface PasswordChecklistProps {
  password: string;
  id?: string;
}

/** Live password requirements list with a strength meter. */
export function PasswordChecklist({ password, id }: PasswordChecklistProps) {
  const { score, label } = getPasswordStrength(password);

  return (
    <div id={id} className="space-y-2 rounded-xl border border-border bg-muted/30 p-3" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((segment) => (
            <div
              key={segment}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                score >= segment ? STRENGTH_COLORS[score] : "bg-border"
              }`}
            />
          ))}
        </div>
        <span className="w-12 text-right text-[10px] font-semibold text-muted-foreground">
          {label}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(password);
          return (
            <li
              key={rule.id}
              className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                met ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
              }`}
            >
              {met ? (
                <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
              ) : (
                <X className="h-3 w-3 shrink-0" aria-hidden="true" />
              )}
              <span>{rule.label}</span>
              <span className="sr-only">{met ? "(met)" : "(not met)"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
