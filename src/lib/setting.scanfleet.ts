const BASE_URL = process.env.SCANFLEET_BASE_URL!;
const API_KEY = process.env.SCANFLEET_API_KEY!;
const API_SECRET = process.env.SCANFLEET_API_SECRET!;

if (!BASE_URL || !API_KEY || !API_SECRET) {
  throw new Error(
    "Missing SCANFLEET_BASE_URL, SCANFLEET_API_KEY, or SCANFLEET_API_SECRET env vars",
  );
}

const authHeader =
  "Basic " + Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64");

const headers = {
  Authorization: authHeader,
  "Content-Type": "application/json",
};

async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) },
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.message || `ScanFleet API error: ${res.status}`);
  }

  return json as T;
}

export const scanfleet = {
  bindAttachCode: (payload: {
    attachCode: string;
    customerData: {
      stickerUserName: string;
      primaryPhoneNumber: string;
      emergencyContact1: string;
      emergencyContact2: string;
      vehicleDetails: {
        vehicleNumber: string;
        vehicleType: string;
        vehicleModel: string;
      };
    };
    shippingAddress: {
      street: string;
      city: string;
      district: string;
      state: string;
      pincode: string;
    };
  }) =>
    apiFetch<{
      success: boolean;
      data: {
        tokenId: string;
        qrId: string;
        maskedNumber: string;
        remainingBalance: number;
      };
    }>("/api/external/v1/orders/bind-attach-code", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
