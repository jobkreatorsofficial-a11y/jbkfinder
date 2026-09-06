// Single source of truth for the sourcing platforms this console drives.
// Everything else (form fields, payload keys, webhook lookup, sheet tab)
// reads from here, so adding a fourth platform is one object literal.

export type PlatformId = "shine" | "foundit" | "apna";

export interface CredentialField {
  name: string; // payload key sent to n8n
  label: string;
  placeholder?: string;
  helpText?: string;
  type: "text" | "textarea" | "password";
  required: boolean;
  defaultValue?: string;
}

export interface PlatformSupports {
  experienceRange: boolean;
  salaryRange: boolean;
  ageRange: boolean;
  strictLocation: boolean;
  keywordOverride: boolean;
  // Workflow takes a `page` key, so successive runs can walk deeper into the
  // result set instead of re-fetching the first block.
  pagination: boolean;
  // Workflow takes an `excludeIds` key: the Candidate IDs already pulled this
  // session, so a repeat run never returns the same person twice.
  excludeIds: boolean;
  // Workflow reveals the top N numbers itself, spending credits.
  revealCount: boolean;
}

export interface Platform {
  id: PlatformId;
  label: string;
  webhookEnv: string; // env var holding the webhook URL
  sheetTab: string; // Google Sheet tab results are read from
  supports: PlatformSupports;
  phoneAvailability: "direct" | "unlock_required" | "masked";
  credentials: CredentialField[];
  notes: string; // shown as a small info line under the tab
  // Payload key for the optional keyword override. Present only when
  // supports.keywordOverride is true, because each workflow names it
  // differently.
  keywordKey?: string;
  // Extra webhook env vars checked in order before webhookEnv. Lets the
  // original single-platform deployment keep working after this ships.
  webhookEnvFallbacks?: string[];
}

export const PLATFORMS: Record<PlatformId, Platform> = {
  shine: {
    id: "shine",
    label: "Shine",
    webhookEnv: "N8N_WEBHOOK_URL_SHINE",
    webhookEnvFallbacks: ["N8N_WEBHOOK_URL"],
    sheetTab: "Shine.csv",
    supports: {
      experienceRange: true,
      salaryRange: true,
      ageRange: true,
      strictLocation: true,
      keywordOverride: true,
      pagination: false,
      excludeIds: false,
      revealCount: false,
    },
    phoneAvailability: "direct",
    keywordKey: "shineKeywordOverride",
    credentials: [
      {
        name: "shineCookie",
        label: "Shine Cookie",
        placeholder: "csrftoken=X; sessionid=Y",
        helpText:
          "DevTools > Application > Cookies > recruiter.shine.com. Paste as csrftoken=VALUE; sessionid=VALUE",
        type: "textarea",
        required: true,
      },
      {
        name: "shineCsrf",
        label: "CSRF Token",
        placeholder: "csrftoken value only",
        helpText: "Auto-filled from the cookie",
        type: "text",
        required: false,
      },
    ],
    notes:
      "Returns direct phone numbers. Session expires within hours, so grab a fresh cookie per batch. Experience and salary filter at source; location filters after fetch.",
  },

  foundit: {
    id: "foundit",
    label: "Foundit",
    webhookEnv: "N8N_WEBHOOK_URL_FOUNDIT",
    sheetTab: "Foundit",
    supports: {
      experienceRange: true,
      salaryRange: true,
      ageRange: true,
      strictLocation: true,
      keywordOverride: false,
      pagination: true,
      excludeIds: true,
      revealCount: true,
    },
    phoneAvailability: "masked",
    credentials: [
      {
        name: "founditCookie",
        label: "Foundit Cookie",
        placeholder: "Paste the full cookie string",
        type: "textarea",
        required: true,
      },
    ],
    notes:
      "Top candidates get their numbers revealed automatically using credits. Set reveal count to 0 to search for free.",
  },

  apna: {
    id: "apna",
    label: "Apna",
    webhookEnv: "N8N_WEBHOOK_URL_APNA",
    sheetTab: "Apna",
    supports: {
      experienceRange: true,
      salaryRange: true,
      ageRange: true,
      strictLocation: true,
      keywordOverride: true,
      pagination: true,
      excludeIds: true,
      revealCount: true,
    },
    phoneAvailability: "masked",
    keywordKey: "apnaKeyword",
    credentials: [
      {
        name: "apnaAuth",
        label: "Apna Auth Token",
        placeholder: "Token eyJ...",
        helpText:
          "DevTools > Network > any white-collar-search request > Request Headers > authorization. Starts with Token eyJ...",
        type: "textarea",
        required: true,
      },
      {
        name: "apnaOrgId",
        label: "Org ID",
        type: "text",
        required: true,
        defaultValue: "1954756",
      },
      {
        name: "apnaWorkspaceId",
        label: "Workspace ID",
        type: "text",
        required: true,
        defaultValue: "6a3bd9bf21d89d2fd628341b",
      },
    ],
    notes:
      "Rich profiles (salary, skills, education). Phone numbers are unlocked with credits — the top candidates (up to your reveal count) get their numbers revealed automatically; set reveal count to 0 to search for free. Auth token expires.",
  },
};

export const PLATFORM_IDS: PlatformId[] = ["shine", "foundit", "apna"];

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && (PLATFORM_IDS as string[]).includes(value);
}

export function getPlatform(value: unknown): Platform {
  return isPlatformId(value) ? PLATFORMS[value] : PLATFORMS.shine;
}

// Copy shown above the results table when numbers will not be plainly present.
export const PHONE_NOTICE: Record<Platform["phoneAvailability"], string> = {
  direct: "",
  unlock_required:
    "Apna does not return phone numbers in search results. Profiles are complete otherwise; contact details need a paid unlock.",
  masked:
    "The top-ranked numbers (up to your reveal count) are unlocked automatically, spending credits. The rest stay masked until revealed.",
};
