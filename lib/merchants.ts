import type { Owner } from "./seed";

/**
 * Seed list of common merchants. `owner` is set only where the merchant is
 * almost always one or the other; `null` means it is used both ways and the
 * owner has to come from the model or from you.
 */
export type Merchant = { pattern: RegExp; name: string; category: string; owner: Owner | null };

const m = (pattern: RegExp, name: string, category: string, owner: Owner | null = null): Merchant => ({
  pattern,
  name,
  category,
  owner,
});

export const MERCHANTS: Merchant[] = [
  // Food
  m(/\bSWIGGY\b(?!.*INSTAMART)/i, "Swiggy", "Food and dining"),
  m(/\bZOMATO\b/i, "Zomato", "Food and dining"),
  m(/\bEATCLUB|EAT ?SURE|BOX8|FAASOS|REBEL FOODS\b/i, "Rebel Foods", "Food and dining"),
  m(/\bDOMINO'?S?\b|JUBILANT FOOD/i, "Domino's", "Food and dining"),
  m(/\bMC ?DONALD'?S?\b|HARDCASTLE/i, "McDonald's", "Food and dining"),
  m(/\bSTARBUCKS\b|TATA STARBUCKS/i, "Starbucks", "Food and dining"),
  m(/\bKFC\b|\bBURGER KING\b|\bPIZZA HUT\b|\bSUBWAY\b/i, "Fast food", "Food and dining"),
  m(/\bTHIRD WAVE|BLUE TOKAI|CHAAYOS|CAFE COFFEE DAY\b/i, "Cafe", "Food and dining"),
  // Groceries
  m(/\bBLINKIT|GROFERS\b/i, "Blinkit", "Groceries", "personal"),
  m(/\bZEPTO\b/i, "Zepto", "Groceries", "personal"),
  m(/INSTAMART/i, "Swiggy Instamart", "Groceries", "personal"),
  m(/\bBIG ?BASKET|BBNOW|BB DAILY\b/i, "BigBasket", "Groceries", "personal"),
  m(/\bD ?MART\b|AVENUE SUPERMART/i, "DMart", "Groceries", "personal"),
  m(/\bRELIANCE (FRESH|SMART|RETAIL)|JIOMART\b/i, "Reliance Retail", "Groceries", "personal"),
  m(/\bMORE RETAIL|SPENCER'?S|NATURE'?S BASKET|STAR BAZAAR\b/i, "Supermarket", "Groceries", "personal"),
  // Shopping
  m(/\bAMAZON(?!.*(WEB SERVICES|AWS|PRIME))/i, "Amazon", "Shopping"),
  m(/\bFLIPKART\b/i, "Flipkart", "Shopping"),
  m(/\bMYNTRA\b/i, "Myntra", "Shopping", "personal"),
  m(/\bAJIO\b/i, "Ajio", "Shopping", "personal"),
  m(/\bNYKAA\b/i, "Nykaa", "Shopping", "personal"),
  m(/\bMEESHO\b/i, "Meesho", "Shopping", "personal"),
  m(/\bCROMA\b|RELIANCE DIGITAL|VIJAY SALES/i, "Electronics store", "Shopping"),
  m(/\bIKEA\b|PEPPERFRY|URBAN LADDER/i, "Furniture", "Shopping"),
  m(/\bDECATHLON\b/i, "Decathlon", "Shopping", "personal"),
  m(/\bAPPLE\.COM|APPLE INDIA|APPLE SERVICES|ITUNES\b/i, "Apple", "Entertainment and subscriptions"),
  // Travel and transport
  m(/\bUBER\b(?!.*EATS)/i, "Uber", "Travel and transport"),
  m(/\bOLA ?(CABS|MONEY)?\b|ANI TECHNOLOGIES/i, "Ola", "Travel and transport"),
  m(/\bRAPIDO\b/i, "Rapido", "Travel and transport"),
  m(/\bIRCTC\b/i, "IRCTC", "Travel and transport"),
  m(/\bMAKE ?MY ?TRIP|MMT\b/i, "MakeMyTrip", "Travel and transport"),
  m(/\bGOIBIBO|CLEARTRIP|EASEMYTRIP|IXIGO|YATRA\b/i, "Travel booking", "Travel and transport"),
  m(/\bINDIGO|INTERGLOBE AVIATION|AIR ?INDIA|VISTARA|AKASA|SPICEJET\b/i, "Airline", "Travel and transport"),
  m(/\bREDBUS|ABHIBUS\b/i, "Bus booking", "Travel and transport"),
  m(/\bOYO\b|AIRBNB|BOOKING\.COM|AGODA|TAJ HOTELS|MARRIOTT|\bITC HOTELS/i, "Hotel", "Travel and transport"),
  m(/\bFASTAG|NHAI|NETC\b/i, "FASTag", "Travel and transport"),
  m(/\bMETRO RAIL|DMRC|BMRCL|GMRC\b/i, "Metro", "Travel and transport", "personal"),
  // Fuel
  m(/\bHPCL|HINDUSTAN PETROLEUM|\bHP PAY\b|BPCL|BHARAT PETROLEUM|IOCL|INDIAN ?OIL|PETROL|FUEL|SHELL INDIA|NAYARA\b/i, "Fuel station", "Fuel"),
  // Utilities
  m(/\bAIRTEL\b/i, "Airtel", "Utilities and bills"),
  m(/\bJIO\b(?!MART)|RELIANCE JIO/i, "Jio", "Utilities and bills"),
  m(/\bVODAFONE|\bVI\b.*(POSTPAID|PREPAID)|BSNL\b/i, "Mobile operator", "Utilities and bills"),
  m(/\bACT FIBERNET|ATRIA CONVERGENCE|HATHWAY|EXCITEL|GTPL|YOU BROADBAND\b/i, "Broadband", "Utilities and bills"),
  m(/\bTORRENT POWER|ADANI ELECTRICITY|TATA POWER|BESCOM|MSEDCL|MAHAVITARAN|DGVCL|PGVCL|UGVCL|MGVCL|BSES|ELECTRICITY\b/i, "Electricity", "Utilities and bills"),
  m(/\bADANI (TOTAL )?GAS|GUJARAT GAS|MAHANAGAR GAS|INDRAPRASTHA GAS|\bIGL\b|INDANE|HP GAS|BHARAT GAS\b/i, "Gas", "Utilities and bills"),
  m(/\bTATA ?PLAY|TATA ?SKY|DISH ?TV|D2H\b/i, "DTH", "Utilities and bills", "personal"),
  // Entertainment
  m(/\bNETFLIX\b/i, "Netflix", "Entertainment and subscriptions", "personal"),
  m(/\bSPOTIFY\b/i, "Spotify", "Entertainment and subscriptions", "personal"),
  m(/\bHOTSTAR|JIOCINEMA|JIOHOTSTAR|SONY ?LIV|ZEE5|PRIME VIDEO|AMAZON PRIME\b/i, "Streaming", "Entertainment and subscriptions", "personal"),
  m(/\bYOUTUBE ?(PREMIUM)?\b|GOOGLE ?PLAY/i, "Google Play / YouTube", "Entertainment and subscriptions"),
  m(/\bBOOK ?MY ?SHOW|PVR|INOX\b/i, "Movies and events", "Entertainment and subscriptions", "personal"),
  // Health and personal care
  m(/\bAPOLLO (PHARMACY|247|HOSP)|PHARMEASY|NETMEDS|TATA ?1MG|\b1MG\b|MEDPLUS|PHARMACY|CHEMIST|MEDICAL STORE\b/i, "Pharmacy", "Health and medical", "personal"),
  m(/\bHOSPITAL|CLINIC|DIAGNOSTIC|PATHOLOGY|PRACTO|THYROCARE|DR ?LAL\b/i, "Healthcare", "Health and medical", "personal"),
  m(/\bCULT ?FIT|CUREFIT|GOLD'?S GYM|ANYTIME FITNESS\b/i, "Gym", "Personal care", "personal"),
  m(/\bURBAN ?COMPANY|URBANCLAP\b/i, "Urban Company", "Personal care", "personal"),
  // Software and cloud
  m(/\bAMAZON WEB SERVICES|\bAWS\b/i, "AWS", "Software and cloud", "business"),
  m(/\bGOOGLE ?(CLOUD|WORKSPACE|GSUITE)|GOOGLE\s?\*\s?(CLOUD|WORKSPACE|GSUITE)/i, "Google Cloud / Workspace", "Software and cloud", "business"),
  m(/\bMICROSOFT|AZURE|MSFT\b/i, "Microsoft", "Software and cloud", "business"),
  m(/\bANTHROPIC|CLAUDE\.AI|OPENAI|CHATGPT|TYPESAFE|ELEVENLABS|HIGGSFIELD|MIDJOURNEY|RUNWAY|REPLICATE|PERPLEXITY|CURSOR\b/i, "AI tools", "Software and cloud", "business"),
  m(/\bVERCEL|SUPABASE|NETLIFY|HEROKU|DIGITALOCEAN|DIGITAL OCEAN|LINODE|HETZNER|CLOUDFLARE|RENDER\.COM|RAILWAY\b/i, "Hosting", "Software and cloud", "business"),
  m(/\bGITHUB|GITLAB|ATLASSIAN|JIRA|BITBUCKET|JETBRAINS|POSTMAN|SENTRY|POSTHOG|DATADOG\b/i, "Developer tools", "Software and cloud", "business"),
  m(/\bNOTION|SLACK|ZOOM|FIGMA|CANVA|ADOBE|MIRO|LOOM|CALENDLY|DROPBOX|AIRTABLE|ZAPIER|MAKE\.COM\b/i, "SaaS tools", "Software and cloud", "business"),
  m(/\bZOHO|FRESHWORKS|HUBSPOT|APOLLO\.IO|INSTANTLY|LEMLIST|SMARTLEAD|APIFY|FIRECRAWL|TWILIO|SENDGRID|MAILCHIMP\b/i, "Sales and CRM tools", "Software and cloud", "business"),
  m(/\bGODADDY|NAMECHEAP|HOSTINGER|BIGROCK|PORKBUN\b/i, "Domains and hosting", "Software and cloud", "business"),
  m(/\bUPWORK\b/i, "Upwork", "Salaries and contractors", "business"),
  // Marketing
  m(/\bFACEBK|FACEBOOK|META ?PLATFORMS|META ADS|INSTAGRAM\b/i, "Meta Ads", "Marketing and ads", "business"),
  m(/\bGOOGLE ?ADS|GOOGLE\s?\*\s?ADS|ADWORDS\b/i, "Google Ads", "Marketing and ads", "business"),
  m(/\bLINKEDIN\b/i, "LinkedIn", "Marketing and ads", "business"),
  // Money
  m(/\bLIC\b|LIFE INSURANCE|HDFC LIFE|ICICI PRU|SBI LIFE|MAX LIFE|STAR HEALTH|NIVA BUPA|CARE HEALTH|ACKO|DIGIT INSURANCE|POLICY ?BAZAAR|TATA AIG|BAJAJ ALLIANZ|ICICI LOMBARD|HDFC ERGO\b/i, "Insurance", "Insurance"),
  m(/\bZERODHA|GROWW|UPSTOX|KUVERA|INDMONEY|COIN BY|BSE STAR|\bNSE CLEARING|ICCL|MUTUAL FUND|\bSIP\b|\bNPS\b|\bPPF\b/i, "Investments", "Investments", "personal"),
  m(/\bINCOME TAX|\bCBDT\b|\bTDS\b|\bGST ?(PAYMENT|PMT)|GSTN|ADVANCE TAX|PROPERTY TAX|PROFESSIONAL TAX\b/i, "Taxes", "Taxes"),
  m(/\bEMI\b|LOAN (REPAY|INST)|BAJAJ FINANCE|HDB FINANCIAL|TATA CAPITAL\b/i, "Loan EMI", "Loan EMI"),
  // Income
  m(/\bRAZORPAY|CASHFREE|PAYU|STRIPE|PAYPAL|WISE PAYMENTS|PAYONEER|SKYDO|INSTAMOJO\b/i, "Payment gateway", "Client revenue", "business"),
];

export function matchMerchant(text: string): Merchant | null {
  for (const merchant of MERCHANTS) if (merchant.pattern.test(text)) return merchant;
  return null;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const BY_NAME = new Map(MERCHANTS.map((x) => [norm(x.name), x]));

/** Looks a merchant up by the canonical name stored on the payee, falling back to pattern matching. */
export function merchantForPayee(normalisedName: string, displayName: string): Merchant | null {
  return BY_NAME.get(norm(normalisedName)) || BY_NAME.get(norm(displayName)) || matchMerchant(displayName);
}
