export type TaskRoute = "visual-similarity" | "object-matching";
export type LaunchRunMode = "development" | "full";

export interface Launch {
  task: TaskRoute;
  runMode: LaunchRunMode;
}

export function runModeFromSearch(search: string): LaunchRunMode {
  const params = new URLSearchParams(search);
  const value = params.get("run") ?? params.get("mode");
  if (value === "dev" || value === "development") return "development";
  if (value === "ops") return "full";
  return "development";
}

export function parseLaunch(pathname: string, search: string): Launch {
  const task = pathname.replace(/^\/tasks\//, "");
  if (task !== "visual-similarity" && task !== "object-matching") {
    throw new Error("Unknown task route");
  }
  return { task, runMode: runModeFromSearch(search) };
}
