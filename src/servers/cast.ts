import type { ServerProfile } from "./types.js";
import { streamServer } from "./stream.js";

export const castServer: ServerProfile = {
  ...streamServer,
  id: "cast",
  label: "PLAYER 2",
};
