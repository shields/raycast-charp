export async function systemKeystrokes(): Promise<string> {
  throw new Error("Native keyboard lookup must be mocked outside macOS");
}
