// The Job view. The shell reads one `view` from each file, so the detail in
// jobs.js gets its own file for `#/jobs/<name>`.
import { detail } from "./jobs.js";

export const view = detail;
