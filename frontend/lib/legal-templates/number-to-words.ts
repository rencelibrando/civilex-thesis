const ONES: string[] = [
  "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
  "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN",
  "SEVENTEEN", "EIGHTEEN", "NINETEEN",
];

const TENS: string[] = [
  "", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY",
];

function convertGroupToWords(num: number): string {
  let group = "";
  if (num >= 100) {
    const hundreds = Math.floor(num / 100);
    group += ONES[hundreds] + " HUNDRED ";
    num %= 100;
  }
  if (num >= 20) {
    const tens = Math.floor(num / 10);
    group += TENS[tens] + " ";
    num %= 10;
  }
  if (num > 0) {
    group += ONES[num] + " ";
  }
  return group.trim();
}

export function convertPesoToWords(amountInput: string | number): string {
  if (amountInput === null || amountInput === undefined) return "";
  const cleaned = String(amountInput).replace(/[^0-9.]/g, "");
  if (!cleaned || isNaN(Number(cleaned))) return "";

  const parts = cleaned.split(".");
  let integerPart = parseInt(parts[0], 10);
  const decimalPart = parts[1] ? parts[1].slice(0, 2) : "00";

  if (integerPart === 0 && (!parts[1] || parts[1] === "00")) {
    return "ZERO PESOS";
  }

  const units: string[] = ["", "THOUSAND", "MILLION", "BILLION", "TRILLION"];
  let wordChunks: string[] = [];
  let unitIndex = 0;

  while (integerPart > 0 && unitIndex < units.length) {
    const chunk = integerPart % 1000;
    if (chunk > 0) {
      const chunkWords = convertGroupToWords(chunk);
      const unitName = units[unitIndex];
      const chunkText = unitName ? `${chunkWords} ${unitName}` : chunkWords;
      wordChunks.unshift(chunkText);
    }
    integerPart = Math.floor(integerPart / 1000);
    unitIndex++;
  }

  let finalWords = wordChunks.join(" ").trim();
  if (!finalWords) {
    finalWords = "ZERO";
  }

  const centavosNum = parseInt(decimalPart.padEnd(2, "0"), 10);
  if (centavosNum > 0) {
    return `${finalWords} PESOS AND ${decimalPart}/100`;
  }
  return `${finalWords} PESOS`;
}

export function formatPhilippineCurrency(val: string | number): string {
  if (val === null || val === undefined) return "";
  const cleaned = String(val).replace(/[^0-9.]/g, "");
  if (!cleaned || isNaN(Number(cleaned))) return "";
  const num = parseFloat(cleaned);
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

