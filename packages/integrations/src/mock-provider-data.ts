import { type NormalizedProvider, type CareCategory } from "@kkd/contracts";

const NAIROBI_PROVIDERS: NormalizedProvider[] = [
  {
    id: "nairobi-emg-001",
    name: "Nairobi Hospital Emergency",
    facilityType: "Hospital",
    careCategories: ["emergency_department"],
    latitude: -1.2921,
    longitude: 36.8219,
    address: "Upper Hill, Nairobi",
    phone: "+254-20-2845000",
    openingStatus: "open_24h",
    source: "mock",
    sourceRecordId: "mock-nairobi-emg-001",
    lastVerifiedAt: new Date("2026-08-15").toISOString(),
  },
  {
    id: "nairobi-emg-002",
    name: "Aga Khan Hospital Emergency",
    facilityType: "Hospital",
    careCategories: ["emergency_department"],
    latitude: -1.3078,
    longitude: 36.8138,
    address: "3rd Parklands Avenue, Nairobi",
    phone: "+254-20-3662000",
    openingStatus: "open_24h",
    source: "mock",
    sourceRecordId: "mock-nairobi-emg-002",
    lastVerifiedAt: new Date("2026-08-14").toISOString(),
  },
  {
    id: "nairobi-primary-001",
    name: "Nairobi Primary Care Clinic",
    facilityType: "Clinic",
    careCategories: ["primary_care"],
    latitude: -1.3032,
    longitude: 36.7469,
    address: "Westlands, Nairobi",
    phone: "+254-20-4445555",
    openingStatus: "open",
    source: "mock",
    sourceRecordId: "mock-nairobi-primary-001",
    lastVerifiedAt: new Date("2026-08-10").toISOString(),
  },
  {
    id: "nairobi-primary-002",
    name: "Karen Medical Center",
    facilityType: "Clinic",
    careCategories: ["primary_care"],
    latitude: -1.3521,
    longitude: 36.7065,
    address: "Karen, Nairobi",
    phone: "+254-20-3876666",
    openingStatus: "open",
    source: "mock",
    sourceRecordId: "mock-nairobi-primary-002",
    lastVerifiedAt: new Date("2026-08-20").toISOString(),
  },
  {
    id: "nairobi-eye-001",
    name: "Kenya Eye Institute",
    facilityType: "Specialty",
    careCategories: ["eye_care"],
    latitude: -1.2913,
    longitude: 36.8054,
    address: "Muthaiga, Nairobi",
    phone: "+254-20-2712444",
    openingStatus: "open",
    source: "mock",
    sourceRecordId: "mock-nairobi-eye-001",
    lastVerifiedAt: new Date("2026-08-18").toISOString(),
  },
  {
    id: "nairobi-dental-001",
    name: "Nairobi Dental Clinic",
    facilityType: "Specialty",
    careCategories: ["dental_care"],
    latitude: -1.2886,
    longitude: 36.8245,
    address: "CBD, Nairobi",
    phone: "+254-20-2222333",
    openingStatus: "open",
    source: "mock",
    sourceRecordId: "mock-nairobi-dental-001",
    lastVerifiedAt: new Date("2026-08-19").toISOString(),
  },
];

const MOMBASA_PROVIDERS: NormalizedProvider[] = [
  {
    id: "mombasa-emg-001",
    name: "Mombasa Hospital Emergency",
    facilityType: "Hospital",
    careCategories: ["emergency_department"],
    latitude: -4.043,
    longitude: 39.668,
    address: "Fort Jesus Road, Mombasa",
    phone: "+254-41-222222",
    openingStatus: "open_24h",
    source: "mock",
    sourceRecordId: "mock-mombasa-emg-001",
    lastVerifiedAt: new Date("2026-08-17").toISOString(),
  },
  {
    id: "mombasa-primary-001",
    name: "Mombasa Primary Care",
    facilityType: "Clinic",
    careCategories: ["primary_care"],
    latitude: -4.0492,
    longitude: 39.6589,
    address: "Nyali, Mombasa",
    phone: "+254-41-344444",
    openingStatus: "open",
    source: "mock",
    sourceRecordId: "mock-mombasa-primary-001",
    lastVerifiedAt: new Date("2026-08-16").toISOString(),
  },
];

const KISUMU_PROVIDERS: NormalizedProvider[] = [
  {
    id: "kisumu-emg-001",
    name: "Kisumu Teaching Hospital",
    facilityType: "Hospital",
    careCategories: ["emergency_department"],
    latitude: -0.1019,
    longitude: 34.7617,
    address: "Kisumu Central, Kisumu",
    phone: "+254-57-22222",
    openingStatus: "open_24h",
    source: "mock",
    sourceRecordId: "mock-kisumu-emg-001",
    lastVerifiedAt: new Date("2026-08-15").toISOString(),
  },
  {
    id: "kisumu-primary-001",
    name: "Kisumu Medical Center",
    facilityType: "Clinic",
    careCategories: ["primary_care"],
    latitude: -0.1035,
    longitude: 34.7689,
    address: "Kisumu Town, Kisumu",
    phone: "+254-57-33333",
    openingStatus: "open",
    source: "mock",
    sourceRecordId: "mock-kisumu-primary-001",
    lastVerifiedAt: new Date("2026-08-12").toISOString(),
  },
];

export const MOCK_PROVIDERS_BY_LOCATION: Record<string, NormalizedProvider[]> = {
  nairobi: NAIROBI_PROVIDERS,
  mombasa: MOMBASA_PROVIDERS,
  kisumu: KISUMU_PROVIDERS,
};

export const ALL_MOCK_PROVIDERS: NormalizedProvider[] = [
  ...NAIROBI_PROVIDERS,
  ...MOMBASA_PROVIDERS,
  ...KISUMU_PROVIDERS,
];

/**
 * Get mock providers for a given care category.
 * Distribute across all locations, preferring current location.
 */
export function getMockProvidersByCategory(
  careCategory: CareCategory,
  preferredLocation?: string
): NormalizedProvider[] {
  const filtered = ALL_MOCK_PROVIDERS.filter((p) =>
    p.careCategories.includes(careCategory)
  );

  // Match the city token anywhere in the query ("Westlands, Nairobi" -> nairobi).
  const cityKey = preferredLocation
    ? Object.keys(MOCK_PROVIDERS_BY_LOCATION).find((city) =>
        preferredLocation.toLowerCase().split(/[\s,]+/).includes(city)
      )
    : undefined;

  if (cityKey) {
    const locationSpecific = filtered.filter((p) => {
      // address is optional on NormalizedProvider - guard before splitting.
      const pLocation = p.address?.split(",").pop()?.toLowerCase().trim();
      return pLocation === cityKey;
    });
    if (locationSpecific.length > 0) {
      return locationSpecific;
    }
  }

  return filtered;
}
