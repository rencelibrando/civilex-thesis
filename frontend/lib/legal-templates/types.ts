export type TemplateCategory =
  | "sales_conveyance"
  | "leases_tenancy"
  | "real_estate_offers"
  | "loans_financial"
  | "affidavits_sworn"
  | "power_of_attorney"
  | "succession_wills"
  | "contracts_agreements";

export type FieldInputType =
  | "text"
  | "textarea"
  | "date"
  | "number"
  | "currency"
  | "select";

export interface TemplateField {
  id: string;
  label: string;
  placeholder?: string;
  type: FieldInputType;
  required?: boolean;
  section: "parties" | "subject" | "financial" | "terms" | "execution" | "witnesses";
  options?: string[];
  helperText?: string;
  defaultValue?: string;
  isAmountFigures?: boolean;
  pairedWordsFieldId?: string;
}

export interface LegalTemplate {
  id: string;
  title: string;
  filename: string;
  category: TemplateCategory;
  categoryLabel: string;
  description: string;
  numPages: number;
  sections: Array<"parties" | "subject" | "financial" | "terms" | "execution" | "witnesses">;
  fields: TemplateField[];
  requiresSignature?: boolean;
  sectionLabels?: Partial<Record<"parties" | "subject" | "financial" | "terms" | "execution" | "witnesses", string>>;
}

export type TemplateValues = Record<string, string>;

export interface ExtractedFieldResult {
  fieldId: string;
  value: string;
  confidence: number;
  source: "regex_ner" | "llm";
}

