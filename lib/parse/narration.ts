export type Mode =
  | "UPI"
  | "NEFT"
  | "IMPS"
  | "RTGS"
  | "CARD"
  | "ATM"
  | "CHEQUE"
  | "AUTO_DEBIT"
  | "INTEREST"
  | "CHARGE"
  | "OTHER";

export type ParsedNarration = {
  mode: Mode;
  payeeName: string;
  upiId: string | null;
  reference: string | null;
  note: string | null;
};

// A UPI ID has a handle with no dot after the @ (which is what separates it from an email address).
// Hyphens are left out of the local part because HDFC separates narration fields with them.
const VPA = /([a-z0-9][a-z0-9._]{1,})@([a-z][a-z0-9]{1,})(?![a-z0-9]*\.[a-z])/i;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const STOP = new Set([
  "UPI", "UPIAR", "P2A", "P2M", "P2P", "P2V", "DR", "CR", "PAY", "PAYMENT", "PAYMENTS", "PAID", "NA", "NIL", "MB", "IB", "INB",
  "NEFT", "IMPS", "RTGS", "MMT", "BIL", "INF", "INFT", "NETBANKING", "ONL", "ONLINE", "TRANSFER", "TRF", "TO", "FROM", "BY",
  "MOB", "MOBILE", "BANKING", "FUND", "FUNDS", "SENT", "USING", "VIA", "COLLECT", "REQUEST", "OTHERS", "OTH", "MERCHANT", "UPIINTENT",
  "PHONEPE", "GPAY", "GOOGLEPAY", "PAYTM", "BHIM", "AMAZONPAY", "CRED", "OK", "OID", "TXN", "REF", "NO",
]);

const BANK_WORDS =
  /^(HDFC|ICICI|SBI|SBIN|AXIS|KOTAK|KKBK|YES|YESB|IDFC|IDFB|RBL|RATN|BOB|BARB|BARODA|PNB|PUNB|CANARA|CNRB|UNION|UBIN|INDUSIND|INDB|FEDERAL|FDRL|AU|AUBL|IDBI|IBKL|BOI|BKID|CITI|HSBC|SCBL|DBS|PAYTM|PYTM|AIRTEL|AIRP|FINO|JIO|UTIB|UTBI|STATE BANK OF INDIA|BANK OF BARODA|PUNJAB NATIONAL)( ?BANK| ?BK)?( ?LTD| ?LIMITED)?( OF INDIA)?$/i;

function isNoise(token: string): boolean {
  const t = token.trim().toUpperCase();
  if (t.length < 3) return true;
  if (/^(NEFT|IMPS|RTGS|UPI|MMT|INB|BIL|ONL)( ?(DR|CR|IN|OUT))?$/.test(t)) return true;
  if (STOP.has(t.replace(/\s+/g, ""))) return true;
  if (IFSC.test(t.replace(/\s+/g, ""))) return true;
  if (BANK_WORDS.test(t)) return true;
  if (/^[\dX*#:.\s]+$/.test(t)) return true; // numbers, masked numbers, times
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return true;
  const letters = t.replace(/[^A-Z]/g, "").length;
  const digits = t.replace(/[^0-9]/g, "").length;
  if (letters < 3) return true;
  if (digits > letters) return true; // reference-like
  return false;
}

function tidy(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .replace(/^[\s\-/*.:,]+|[\s\-/*.:,]+$/g, "")
    .trim();
}

export function normaliseName(name: string): string {
  return name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|INDIA|IND|CO|COMPANY|THE)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectMode(raw: string, upiId: string | null, accountType: string): Mode {
  const s = raw.toUpperCase();
  if (/\bUPI\b|^UPI|\/UPI\//.test(s) || upiId) return "UPI";
  if (/\bNEFT\b|^NEFT/.test(s)) return "NEFT";
  if (/\bIMPS\b|^IMPS|^MMT\//.test(s)) return "IMPS";
  if (/\bRTGS\b|^RTGS/.test(s)) return "RTGS";
  if (/\b(ATW|ATM|NWD|CASH ?WDL|CASH WITHDRAWAL|EAW|AWB)\b/.test(s)) return "ATM";
  if (/\b(INT\.? ?PD|INTEREST (PAID|CREDIT)|CREDIT INTEREST|INT\.?CR|SB ?INT)\b/.test(s)) return "INTEREST";
  if (
    /\b(CHARGES?|CHGS?|CHRG|ANNUAL FEE|LATE FEE|FINANCE CHARGE|\bFEE\b|IGST|CGST|SGST|GST ON|SMS ALERT|AMC|MIN BAL|DEBIT CARD FEE|MARKUP)\b/.test(s) &&
    !/\b(GST ?(PAYMENT|PMT)|GSTN)\b/.test(s)
  )
    return "CHARGE";
  if (/\b(ACH|NACH|ECS|SI[- ]|AUTOPAY|AUTO ?DEBIT|MANDATE|EMI)\b/.test(s)) return "AUTO_DEBIT";
  if (/\b(CHQ|CHEQUE|CLG|CLEARING)\b/.test(s)) return "CHEQUE";
  if (/^(POS|ECOM|PUR|VPS|IPS|VIN|MIN)\b|\bPOS\b/.test(s) || accountType === "credit_card") return "CARD";
  return "OTHER";
}

function cardMerchant(raw: string): string {
  let s = raw
    .replace(/^(POS|ECOM|PUR|VPS|IPS|VIN|MIN)[\s/:-]+/i, "")
    .replace(/\b\d{4,6}[X*]{4,}\d{2,4}\b/gi, " ") // masked card number
    .replace(/\b(POS DEBIT|ECOM PUR|PURCHASE|TXN|REF ?NO\.?)\b/gi, " ")
    .replace(/\b\d{6,}\b/g, " ")
    .replace(/\(?Ref#?[^)]*\)?/gi, " ");
  s = s.split(/\s{2,}|\s+IN\s*$|,/)[0] || s;
  return tidy(s).slice(0, 60);
}

export function parseNarration(rawInput: string, accountType = "savings"): ParsedNarration {
  const raw = (rawInput || "").replace(/\s+/g, " ").trim();
  const vpaMatch = raw.match(VPA);
  const upiId = vpaMatch ? vpaMatch[0].toLowerCase() : null;
  const mode = detectMode(raw, upiId, accountType);

  const refMatch = raw.match(/(?<![\dA-Z])\d{12}(?![\dA-Z])/) || raw.match(/(?<![\dA-Z])[A-Z]{4}[A-Z0-9]\d{10,17}(?![\dA-Z])/);
  let reference = refMatch ? refMatch[0] : null;

  let payeeName = "";
  let note: string | null = null;

  if (mode === "UPI" || mode === "NEFT" || mode === "IMPS" || mode === "RTGS") {
    const MARK = "\u0001";
    const withoutVpa = upiId ? raw.replace(VPA, ` ${MARK} `) : raw;
    const tokens = withoutVpa
      .split(/[-/|]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const named = tokens.filter((t) => t !== MARK && !isNoise(t));
    payeeName = named[0] || "";
    if (named.length > 1) {
      const last = named[named.length - 1];
      if (last !== payeeName) note = tidy(last).slice(0, 80);
    }
    // Some banks (ICICI among them) write "UPI/<reference>/<your remark>/<UPI ID>/<bank>", with no payee name at all.
    // When a reference comes first and the only text before the UPI ID is one field, that field is the remark.
    if (upiId && payeeName && raw.includes("/")) {
      const iName = tokens.indexOf(payeeName);
      const iVpa = tokens.indexOf(MARK);
      const iRef = tokens.findIndex((t) => /^\d{9,}$/.test(t));
      const namedBeforeVpa = tokens.slice(0, iVpa).filter((t) => !isNoise(t)).length;
      if (iRef >= 0 && iRef < iName && iName === iVpa - 1 && namedBeforeVpa === 1) {
        note = tidy(payeeName).slice(0, 80);
        payeeName = "";
      }
    }
    if (!payeeName && upiId) payeeName = upiId.split("@")[0];
  } else if (mode === "CARD") {
    payeeName = cardMerchant(raw);
  } else if (mode === "ATM") {
    payeeName = "ATM cash withdrawal";
  } else if (mode === "INTEREST") {
    payeeName = "Bank interest";
  } else if (mode === "CHARGE") {
    payeeName = "Bank charges";
  } else {
    const tokens = raw.split(/[-/|]+/).map((t) => t.trim()).filter(Boolean);
    payeeName = tokens.find((t) => !isNoise(t)) || raw;
  }

  payeeName = tidy(payeeName).slice(0, 60) || tidy(raw).slice(0, 60) || "Unknown";
  if (!reference) {
    const chq = raw.match(/\b(?:CHQ|CHEQUE|REF)\.? ?(?:NO\.?)? ?[:#-]? ?(\d{5,})\b/i);
    if (chq) reference = chq[1];
  }
  return { mode, payeeName, upiId, reference, note };
}
