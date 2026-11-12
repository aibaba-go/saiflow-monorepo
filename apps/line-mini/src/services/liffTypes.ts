/** The part of the LIFF SDK the app uses. Only services/liff.ts talks to @line/liff;
 * everything else receives this interface, so tests can pass a fake. */
export interface Liff {
  init(): Promise<void>;
  isLoggedIn(): boolean;
  isInClient(): boolean;
  /** Device OS for LINE's native downloader; optional adapters fall back to user agent. */
  getOS?(): string | undefined;
  login(redirectUri: string): void;
  logout(): void;
  getIDToken(): string | null;
  isApiAvailable(api: string): boolean;
  shareTargetPicker(messages: { type: "text"; text: string }[]): Promise<unknown>;
  /** Opens a URL; external: true hands it to the system browser (export downloads). */
  openWindow(params: { url: string; external: boolean }): void;
}
