import { requirePlatform } from "./context";

// Which workspace a request works on: always the one in the verified platform session, never anything the request says.
export const activeWorkspaceId = (): string => requirePlatform().workspaceId;
