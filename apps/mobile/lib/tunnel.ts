const TUNNEL_KEY_HEADER = "x-negroni-tunnel-key";

export function tunnelHeaders(): Record<string, string> {
  const key = process.env.EXPO_PUBLIC_TUNNEL_KEY?.trim();
  return key ? { [TUNNEL_KEY_HEADER]: key } : {};
}
