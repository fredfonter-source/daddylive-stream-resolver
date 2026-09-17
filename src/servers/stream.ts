import type { ServerProfile } from "./types.js";

export const streamServer: ServerProfile = {
  id: "stream",
  label: "PLAYER 1",
  transport: {
    refererMode: "required",
    refererOrigin: "https://tiestep.top/",
    toolsDirectPlayable: true,
    toolsUserAgent: true,
  },
};
