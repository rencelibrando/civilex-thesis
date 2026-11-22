import { TemplateField, TemplateValues } from "./types";

export interface SavedPartyProfile {
  id: string;
  label: string;
  fullName: string;
  civilStatus?: string;
  spouseName?: string;
  address: string;
  idDetails?: string;
  updatedAt: string;
}

export interface SavedSignatureProfile {
  id: string;
  label: string;
  dataUrl: string;
  updatedAt: string;
}

export interface PartyRoleGroup {
  prefix: string;
  roleLabel: string;
  nameFieldId: string;
  civilStatusFieldId?: string;
  spouseFieldId?: string;
  addressFieldId?: string;
  idFieldId?: string;
}

const PARTY_PREFIX_LABELS: Record<string, string> = {
  seller: "Seller",
  buyer: "Buyer",
  lessor: "Lessor",
  lessee: "Lessee",
  lessor_seller: "Lessor / Seller",
  lessee_buyer: "Lessee / Buyer",
  donor: "Donor",
  donee: "Donee",
  assignor: "Assignor",
  assignee: "Assignee",
  principal: "Principal",
  agent: "Attorney-in-Fact",
  affiant: "Affiant",
  debtor: "Debtor",
  creditor: "Creditor",
  maker: "Maker / Borrower",
  payee: "Payee / Lender",
  mortgagor: "Mortgagor",
  mortgagee: "Mortgagee",
  testator: "Testator",
  owner: "Owner",
  complainant: "Complainant",
  contractor: "Contractor",
  client: "Client",
  party_a: "Party A",
  party_b: "Party B",
};

function getPartyStorageKey(userId?: string): string {
  return `civilex_builder_party_profiles_${userId || "local"}`;
}

function getSignatureStorageKey(userId?: string): string {
  return `civilex_builder_saved_signatures_${userId || "local"}`;
}

function safeReadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as unknown as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors silently
  }
}

export function loadPartyProfiles(userId?: string): SavedPartyProfile[] {
  return safeReadJson<SavedPartyProfile[]>(getPartyStorageKey(userId), []);
}

export function savePartyProfile(
  profile: Omit<SavedPartyProfile, "id" | "updatedAt">,
  userId?: string
): SavedPartyProfile[] {
  const existing = loadPartyProfiles(userId);
  const normalizedName = profile.fullName.trim().toLowerCase();
  const existingIdx = existing.findIndex(
    (p) => p.fullName.trim().toLowerCase() === normalizedName
  );
  const entry: SavedPartyProfile = {
    ...profile,
    id: existingIdx >= 0 ? existing[existingIdx].id : `party_${Date.now()}`,
    updatedAt: new Date().toISOString(),
  };

  const next =
    existingIdx >= 0
      ? [entry, ...existing.filter((_, i) => i !== existingIdx)]
      : [entry, ...existing].slice(0, 15);
  safeWriteJson(getPartyStorageKey(userId), next);
  return next;
}

export function deletePartyProfile(profileId: string, userId?: string): SavedPartyProfile[] {
  const next = loadPartyProfiles(userId).filter((p) => p.id !== profileId);
  safeWriteJson(getPartyStorageKey(userId), next);
  return next;
}

export function loadSavedSignatures(userId?: string): SavedSignatureProfile[] {
  return safeReadJson<SavedSignatureProfile[]>(getSignatureStorageKey(userId), []);
}

export function saveSignatureProfile(
  label: string,
  dataUrl: string,
  userId?: string
): SavedSignatureProfile[] {
  const existing = loadSavedSignatures(userId);
  const cleanLabel = label.trim() || "My Signature";
  const deduped = existing.filter(
    (s) => s.label.toLowerCase() !== cleanLabel.toLowerCase() && s.dataUrl !== dataUrl
  );
  const entry: SavedSignatureProfile = {
    id: `sig_${Date.now()}`,
    label: cleanLabel,
    dataUrl,
    updatedAt: new Date().toISOString(),
  };
  const next = [entry, ...deduped].slice(0, 8);
  safeWriteJson(getSignatureStorageKey(userId), next);
  return next;
}

export function deleteSavedSignature(sigId: string, userId?: string): SavedSignatureProfile[] {
  const next = loadSavedSignatures(userId).filter((s) => s.id !== sigId);
  safeWriteJson(getSignatureStorageKey(userId), next);
  return next;
}

// Detect fillable party role groups from a template's fields
export function detectPartyRoleGroups(fields: TemplateField[]): PartyRoleGroup[] {
  const fieldIds = new Set(fields.map((f) => f.id));
  const groups: PartyRoleGroup[] = [];

  for (const [prefix, roleLabel] of Object.entries(PARTY_PREFIX_LABELS)) {
    const nameFieldId = `${prefix}_name`;
    if (!fieldIds.has(nameFieldId)) continue;

    const civilStatusFieldId = fieldIds.has(`${prefix}_marital_status`)
      ? `${prefix}_marital_status`
      : fieldIds.has(`${prefix}_civil_status`)
        ? `${prefix}_civil_status`
        : undefined;

    const spouseFieldId = fieldIds.has(`${prefix}_spouse`) ? `${prefix}_spouse` : undefined;
    const addressFieldId = fieldIds.has(`${prefix}_address`) ? `${prefix}_address` : undefined;

    const idFieldId = fieldIds.has(`${prefix}_id_details`)
      ? `${prefix}_id_details`
      : fieldIds.has(`${prefix}_id_info`)
        ? `${prefix}_id_info`
        : undefined;

    groups.push({
      prefix,
      roleLabel,
      nameFieldId,
      civilStatusFieldId,
      spouseFieldId,
      addressFieldId,
      idFieldId,
    });
  }

  return groups;
}

export function buildValuesFromPartyProfile(
  group: PartyRoleGroup,
  profile: SavedPartyProfile
): TemplateValues {
  const patch: TemplateValues = {
    [group.nameFieldId]: profile.fullName,
  };
  if (group.addressFieldId && profile.address) {
    patch[group.addressFieldId] = profile.address;
  }
  if (group.civilStatusFieldId && profile.civilStatus) {
    patch[group.civilStatusFieldId] = profile.civilStatus;
  }
  if (group.spouseFieldId && profile.spouseName && profile.civilStatus === "married") {
    patch[group.spouseFieldId] = profile.spouseName;
  }
  if (group.idFieldId && profile.idDetails) {
    patch[group.idFieldId] = profile.idDetails;
  }
  return patch;
}
