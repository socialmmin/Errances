import { API_BASE, getAuthToken } from "./supabase";
export async function whatsappRequest<T = any>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(`${API_BASE}/api/whatsapp${path}`, {
    method: body === undefined ? "GET" : method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken() || ""}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "WhatsApp request failed");
  return data;
}
